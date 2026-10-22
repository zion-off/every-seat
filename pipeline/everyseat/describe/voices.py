"""Voices: text in, 16-bit mono PCM out, with the duration measured from the samples."""

import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

SAMPLE_RATE = 16_000
SAMPLE_BYTES = 2
# The stand-in voice speaks a little slower than the word budget assumes, so a dry run exercises
# the shortening step the way a real voice sometimes does.
STUB_WORDS_PER_SECOND = 2.2


@dataclass(frozen=True)
class Speech:
    pcm: bytes
    sample_rate: int
    characters: int

    @property
    def duration_s(self) -> float:
        """Exact length: bytes over bytes per second."""
        return len(self.pcm) / (SAMPLE_BYTES * self.sample_rate)


class Voice(Protocol):
    name: str
    usd_per_million_characters: float

    def speak(self, text: str, rate_percent: int = 100) -> Speech:
        """Render `text`; `rate_percent` above 100 speaks faster."""
        ...


class StubVoice:
    """Silence of the length a person would take to read the words; needs no network."""

    name = "silence"
    usd_per_million_characters = 0.0

    def speak(self, text: str, rate_percent: int = 100) -> Speech:
        seconds = len(text.split()) / STUB_WORDS_PER_SECOND * 100 / rate_percent
        samples = round(seconds * SAMPLE_RATE)
        return Speech(bytes(samples * SAMPLE_BYTES), SAMPLE_RATE, len(text))


def write_wav(path: Path, speech: Speech) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(SAMPLE_BYTES)
        out.setframerate(speech.sample_rate)
        out.writeframes(speech.pcm)
