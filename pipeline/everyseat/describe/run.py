"""`everyseat describe`: fit a spoken description into each quiet stretch of a film.

Detectors and subtitles decide where; the writer decides what to say; the voice says it, and its
measured length decides whether the text fits.
"""

import json
import math
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from sensevtt import writer as cue_writer
from sensevtt.validate import validate_sensevtt
from sensevtt.writer import Cue

from everyseat import __version__
from everyseat.analyze import TITLE, file_sha256
from everyseat.describe import DescribeError, Rejected, shots, subtitles
from everyseat.describe.review import MIN_WORDS, SIMILARITY_LIMIT, Earlier, Review
from everyseat.describe.subtitles import Window
from everyseat.describe.voices import Speech, Voice, write_wav
from everyseat.describe.writers import MAX_ANSWERS, Request, Writer
from everyseat.detectors import proxy as proxies
from everyseat.detectors.cuts import find_cuts

MAX_SHORTENS = 3
MAX_PLOT_CHARS = 2000
NOTHING_TO_DESCRIBE = "nothing to describe"
FASTER_RATE_PERCENT = 110
PREVIEW_CHARS = 140
PROXY_WIDTH = 640  # contact sheets only: the descriptions never look at a full-size frame


@dataclass
class Fitted:
    window: Window
    text: str
    speech: Speech
    rate_percent: int
    attempts: list[dict] = field(default_factory=list)
    rejected: list[dict] = field(default_factory=list)  # answers the review turned down


@dataclass
class Skipped:
    window: Window
    reason: str
    rejected: list[dict] = field(default_factory=list)

    def log(self) -> dict:
        entry: dict = {"window": self.window.index, "reason": self.reason}
        if self.rejected:
            entry["rejected"] = self.rejected
        return entry


@dataclass(frozen=True)
class Described:
    sensevtt: Path
    log: Path
    clips: list[Path]
    skipped: list[dict]
    cue_count: int


def _words(text: str) -> int:
    return len(text.split())


def read_plot(path: Path) -> str:
    """The synopsis in a plain-text file, to give the writer as context."""
    try:
        plot = path.read_text().strip()
    except (OSError, UnicodeDecodeError) as exc:
        raise DescribeError(f"cannot read the plot file {path}: {exc}") from exc
    if not plot:
        raise DescribeError(f"the plot file {path} is empty")
    if len(plot) > MAX_PLOT_CHARS:
        raise DescribeError(
            f"the plot file {path} has {len(plot)} characters; keep it to {MAX_PLOT_CHARS} "
            "(a short synopsis)"
        )
    return plot


def _target_words(text: str, spoken_s: float, limit_s: float) -> int:
    """Words that should fit in `limit_s` at the pace the voice just showed, with a little slack."""
    scaled = int(_words(text) * limit_s / spoken_s * 0.95)
    return max(MIN_WORDS, min(scaled, _words(text) - 1))


def fit(
    request: Request,
    writer: Writer,
    voice: Voice,
    *,
    fps: int,
    progress: Callable[[str], None],
) -> Fitted | Skipped:
    """Write, voice and measure; shorten up to `MAX_SHORTENS` times, then speak faster as the
    last resort. Skipped when nothing needs saying or the writer cannot give an acceptable
    description; raises when nothing fits.
    """
    window = request.window
    limit = window.duration - 1 / fps  # the cue ends on a frame at or before the window's end
    try:
        text = writer.write(request)
        if text is None:
            return Skipped(window, NOTHING_TO_DESCRIBE)
        speech = voice.speak(text)
        attempts = [{"words": _words(text), "duration_s": round(speech.duration_s, 3), "rate": 100}]
        shortened = 0
        while speech.duration_s > limit and shortened < MAX_SHORTENS:
            target = _target_words(text, speech.duration_s, limit)
            progress(
                f"    {speech.duration_s:.1f} s is over {limit:.1f} s: shortening to {target} words"
            )
            text = writer.shorten(request, text, target)
            speech = voice.speak(text)
            shortened += 1
            attempts.append(
                {"words": _words(text), "duration_s": round(speech.duration_s, 3), "rate": 100}
            )
    except Rejected as exc:
        return Skipped(window, str(exc))
    rate = 100
    if speech.duration_s > limit:
        rate = FASTER_RATE_PERCENT
        speech = voice.speak(text, rate_percent=rate)
        attempts.append(
            {"words": _words(text), "duration_s": round(speech.duration_s, 3), "rate": rate}
        )
        if speech.duration_s > limit:
            raise DescribeError(
                f"window {window.index}: {speech.duration_s:.1f} s of speech does not fit "
                f"{limit:.1f} s even at {rate}% after {shortened} rewrites"
            )
    return Fitted(window, text, speech, rate, attempts)


def preview(text: str) -> str:
    if len(text) <= PREVIEW_CHARS:
        return text
    return text[: PREVIEW_CHARS - 1].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def _cue(title: str, number: int, fitted: Fitted, fps: int, voice: Voice) -> Cue:
    cue_id = f"{title}-ad-{number}"
    start = fitted.window.start
    frames = math.ceil(fitted.speech.duration_s * fps - 1e-6)
    # Counted in frames so the end lies exactly on the grid; adding to a rounded start can drift.
    end = round((round(start * fps) + frames) / fps, 3)
    return Cue(
        type="ad",
        start=start,
        end=end,
        anchor="approx",
        intensity=1,
        preview=preview(fitted.text),
        audio_ref={
            "uri": f"ad/{title}/{cue_id}.wav",
            "duration_s": round(fitted.speech.duration_s, 6),
        },
        evidence={
            "text": fitted.text,
            "words": _words(fitted.text),
            "voice": voice.name,
            "rate_percent": fitted.rate_percent,
            "window_end": fitted.window.end,
        },
        id=cue_id,
    )


def describe(
    video: Path,
    subtitle_file: Path,
    *,
    title: str,
    writer: Writer,
    voice: Voice,
    clips_dir: Path,
    cues_path: Path,
    work_dir: Path,
    dry_run: bool,
    cast: list[str] | None = None,
    plot: str = "",
    min_gap_s: float = subtitles.MIN_GAP_S,
    max_window_s: float = subtitles.MAX_WINDOW_S,
    progress: Callable[[str], None] | None = None,
) -> Described:
    if not TITLE.match(title):
        raise DescribeError(f"title {title!r} must use lowercase letters, digits and hyphens")
    say = progress or (lambda _line: None)

    lines = subtitles.read_srt(subtitle_file)
    say(f"{len(lines)} dialogue lines; making the contact-sheet proxy")
    proxy = proxies.build_proxy(video, work_dir, width=PROXY_WIDTH)
    cuts = find_cuts(proxy.path)
    windows = subtitles.find_windows(
        lines, proxy.duration_s, proxy.fps, min_gap_s=min_gap_s, max_window_s=max_window_s
    )
    if not windows:
        raise DescribeError(f"no dialogue-free stretch of {min_gap_s:g} s or more was found")
    say(
        f"{len(cuts)} shot cuts; {len(windows)} windows, "
        f"{sum(w.duration for w in windows):.0f} s in all (fps {proxy.fps})"
    )

    sheets_dir = work_dir / "sheets"
    sheets_dir.mkdir(parents=True, exist_ok=True)
    fitted: list[Fitted] = []
    skipped: list[Skipped] = []
    for window in windows:
        picture = shots.window_picture(proxy.path, cuts, window)
        (sheets_dir / f"window-{window.index:02d}.jpg").write_bytes(picture.jpeg)
        before, after = subtitles.around(lines, window)
        review = Review([Earlier(f.window.start, f.text) for f in fitted], say)
        request = Request(
            window=window,
            picture=picture.jpeg,
            before=before,
            after=after,
            earlier=review.earlier,
            check=review.check,
            cast=cast or [],
            plot=plot,
        )
        say(
            f"window {window.index}/{len(windows)}: {window.start:g}-{window.end:g} s "
            f"({window.duration:.1f} s, {len(picture.times)} frames, up to {request.budget} words)"
        )
        result = fit(request, writer, voice, fps=proxy.fps, progress=say)
        result.rejected = [d for d in review.decisions if not d["accepted"]]
        if isinstance(result, Skipped):
            skipped.append(result)
            if result.reason == NOTHING_TO_DESCRIBE:
                say("    nothing essential to describe")
            else:
                say(f"    left without a description: {result.reason}")
            continue
        say(
            f"    {_words(result.text)} words, {result.speech.duration_s:.2f} s "
            f"(rate {result.rate_percent}%)"
        )
        fitted.append(result)

    cues = [_cue(title, n, f, proxy.fps, voice) for n, f in enumerate(fitted, 1)]
    head = cue_writer.header(
        title=title,
        analyzer=_analyzer(writer, voice, dry_run),
        source_sha256=file_sha256(video),
        fps=proxy.fps,
        verdict="NOT_RUN",
    )
    text = cue_writer.render(head, cues)
    issues = validate_sensevtt(text)
    if issues:
        raise DescribeError("; ".join(f"line {i.line}: {i.message}" for i in issues))

    clips_dir.mkdir(parents=True, exist_ok=True)
    for stale in clips_dir.glob(f"{title}-ad-*.wav"):
        stale.unlink()
    clips = []
    for cue, item in zip(cues, fitted, strict=True):
        path = clips_dir / f"{cue.id}.wav"
        write_wav(path, item.speech)
        clips.append(path)
    cues_path.parent.mkdir(parents=True, exist_ok=True)
    cues_path.write_text(text)
    skipped_log = [s.log() for s in skipped]
    log_path = cues_path.with_suffix(".run.json")
    log_path.write_text(
        json.dumps(_log(writer, voice, fitted, skipped, cues, dry_run, plot), indent=1) + "\n"
    )
    return Described(cues_path, log_path, clips, skipped_log, len(cues))


def _analyzer(writer: Writer, voice: Voice, dry_run: bool) -> str:
    if dry_run:
        return f"everyseat {__version__} describe (dry run: {writer.name}, {voice.name})"
    return f"everyseat {__version__} describe ({writer.name}, {voice.name})"


def _log(
    writer: Writer,
    voice: Voice,
    fitted: list[Fitted],
    skipped: list[Skipped],
    cues: list[Cue],
    dry_run: bool,
    plot: str,
) -> dict:
    characters = sum(f.speech.characters for f in fitted)
    return {
        "version": 1,
        "dry_run": dry_run,
        "writer": writer.name,
        "voice": voice.name,
        "plot_chars": len(plot),
        "usage": {
            "input_tokens": writer.usage.input_tokens,
            "output_tokens": writer.usage.output_tokens,
            "model_calls": writer.usage.calls,
            "model_cost_usd": round(writer.cost_usd, 6),
            "voice_characters": characters,
            "voice_cost_usd": round(characters * voice.usd_per_million_characters / 1e6, 6),
        },
        "review": {
            "similarity_limit": SIMILARITY_LIMIT,
            "max_answers": MAX_ANSWERS,
            "answers_rejected": sum(len(r.rejected) for r in [*fitted, *skipped]),
        },
        "windows": [
            {
                "cue": cue.id,
                "start": f.window.start,
                "end": f.window.end,
                "text": f.text,
                "rate_percent": f.rate_percent,
                "attempts": f.attempts,
                **({"rejected": f.rejected} if f.rejected else {}),
            }
            for cue, f in zip(cues, fitted, strict=True)
        ],
        "skipped": [s.log() for s in skipped],
    }
