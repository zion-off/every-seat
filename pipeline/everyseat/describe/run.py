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
from everyseat.describe import DescribeError, Rejected, anchor, shots, subtitles
from everyseat.describe.review import (
    MIN_WORDS,
    SIMILARITY_LIMIT,
    Earlier,
    Review,
    excerpt,
)
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
    """One spoken item: its text, where it starts and the measured clip."""

    window: Window
    start: float
    text: str
    speech: Speech
    rate_percent: int
    limit_s: float
    at_s: tuple[float, ...]
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
    placed: anchor.Placed,
    limit: float,
    writer: Writer,
    voice: Voice,
    *,
    progress: Callable[[str], None],
) -> Fitted | str:
    """Voice and measure one item against the time it has (`limit` seconds); shorten up to
    `MAX_SHORTENS` times, then speak faster as the last resort. The reason is returned when the
    item cannot be made to fit or the writer cannot shorten it acceptably.
    """
    text = placed.text
    try:
        speech = voice.speak(text)
        attempts = [{"words": _words(text), "duration_s": round(speech.duration_s, 3), "rate": 100}]
        shortened = 0
        while speech.duration_s > limit and shortened < MAX_SHORTENS:
            target = _target_words(text, speech.duration_s, limit)
            progress(
                f"      {speech.duration_s:.1f} s is over {limit:.1f} s: shortening to "
                f"{target} words"
            )
            text = writer.shorten(request, text, target, placed.start, limit)
            speech = voice.speak(text)
            shortened += 1
            attempts.append(
                {"words": _words(text), "duration_s": round(speech.duration_s, 3), "rate": 100}
            )
    except Rejected as exc:
        return str(exc)
    rate = 100
    if speech.duration_s > limit:
        rate = FASTER_RATE_PERCENT
        speech = voice.speak(text, rate_percent=rate)
        attempts.append(
            {"words": _words(text), "duration_s": round(speech.duration_s, 3), "rate": rate}
        )
        if speech.duration_s > limit:
            return (
                f"{speech.duration_s:.1f} s of speech does not fit {limit:.1f} s even at "
                f"{rate}% after {shortened} rewrites"
            )
    return Fitted(request.window, placed.start, text, speech, rate, limit, placed.at_s, attempts)


def fit_window(
    request: Request,
    writer: Writer,
    voice: Voice,
    review: Review,
    *,
    fps: int,
    progress: Callable[[str], None],
) -> tuple[list[Fitted], Skipped | None, list[dict]]:
    """Write the window's items, anchor them to their shots and fit each into its own slot.

    Items are fitted from the last to the first, so an item that has to go frees its slot for the
    one before it. Skipped when nothing needs saying, the writer gives no acceptable answer or
    no item is left.
    """
    window = request.window
    try:
        items = writer.write(request)
    except Rejected as exc:
        return [], Skipped(window, str(exc)), []
    if items is None:
        return [], Skipped(window, NOTHING_TO_DESCRIBE), []
    placed, decisions = anchor.place(items, window, request.cuts, fps)
    for d in decisions:
        progress(f"    {_describe_decision(d)}")
    kept: list[Fitted] = []
    next_start: float | None = None
    for item in reversed(placed):
        limit = anchor.slot_limit_s(item.start, next_start, window, fps)
        words = anchor.slot_words(limit)
        progress(
            f"    item at {item.start:g} s: slot {limit:.1f} s, up to {words} words "
            f'(wrote {_words(item.text)}): "{excerpt(item.text)}"'
        )
        result = anchor.fits_any(limit) or f"slot of {limit:.1f} s holds {words} words"
        if result is True:
            result = fit(request, item, limit, writer, voice, progress=progress)
        if isinstance(result, str):
            decisions.append(
                {"kind": "dropped", "start": item.start, "text": item.text, "reason": result}
            )
            progress(f"    {_describe_decision(decisions[-1])}")
            continue
        kept.insert(0, result)
        next_start = item.start
    if not kept:
        return [], Skipped(window, "no item fits its slot"), decisions
    return kept, None, decisions


def _describe_decision(d: dict) -> str:
    kind = d["kind"]
    if kind == "snapped":
        return f"snapped {d['at_s']:g} s to the shot start {d['to']:g} s"
    if kind == "clamped":
        return f"clamped {d['at_s']:g} s to {d['to']:g} s: {d['reason']}"
    if kind == "merged":
        return f"merged the item at {d['at_s']:g} s into the one at {d['into']:g} s ({d['reason']})"
    if kind == "rejected":
        return f"rejected the item at {d['at_s']:g} s: {d['reason']}"
    return f"dropped the item at {d['start']:g} s: {d['reason']}"


def preview(text: str) -> str:
    if len(text) <= PREVIEW_CHARS:
        return text
    return text[: PREVIEW_CHARS - 1].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def _cue(title: str, number: int, fitted: Fitted, fps: int, voice: Voice) -> Cue:
    cue_id = f"{title}-ad-{number}"
    start = fitted.start
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
            "window": fitted.window.index,
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
    item_decisions: list[dict] = []
    for window in windows:
        picture = shots.window_picture(proxy.path, cuts, window)
        (sheets_dir / f"window-{window.index:02d}.jpg").write_bytes(picture.jpeg)
        before, after = subtitles.around(lines, window)
        review = Review([Earlier(f.start, f.text) for f in fitted], say)
        request = Request(
            window=window,
            picture=picture.jpeg,
            before=before,
            after=after,
            earlier=review.earlier,
            check=review.check,
            cast=cast or [],
            plot=plot,
            times=picture.times,
            cuts=cuts,
        )
        say(
            f"window {window.index}/{len(windows)}: {window.start:g}-{window.end:g} s "
            f"({window.duration:.1f} s, {len(picture.times)} frames, up to {request.budget} words)"
        )
        kept, skip, decisions = fit_window(
            request, writer, voice, review, fps=proxy.fps, progress=say
        )
        rejected = [d for d in review.decisions if not d["accepted"]]
        item_decisions.extend({"window": window.index, **d} for d in decisions)
        if skip:
            skip.rejected = rejected
            skipped.append(skip)
            if skip.reason == NOTHING_TO_DESCRIBE:
                say("    nothing essential to describe")
            else:
                say(f"    left without a description: {skip.reason}")
            continue
        kept[0].rejected = rejected
        for item in kept:
            say(
                f"    kept at {item.start:g} s: {_words(item.text)} words, "
                f"{item.speech.duration_s:.2f} s of {item.limit_s:.1f} s "
                f"(rate {item.rate_percent}%)"
            )
        fitted.extend(kept)

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
        json.dumps(
            _log(writer, voice, fitted, skipped, cues, dry_run, plot, item_decisions), indent=1
        )
        + "\n"
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
    item_decisions: list[dict],
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
                "window": f.window.index,
                "window_start": f.window.start,
                "window_end": f.window.end,
                "start": f.start,
                "at_s": list(f.at_s),
                "slot_s": f.limit_s,
                "duration_s": round(f.speech.duration_s, 3),
                "text": f.text,
                "rate_percent": f.rate_percent,
                "attempts": f.attempts,
                **({"rejected": f.rejected} if f.rejected else {}),
            }
            for cue, f in zip(cues, fitted, strict=True)
        ],
        "item_decisions": item_decisions,
        "skipped": [s.log() for s in skipped],
    }
