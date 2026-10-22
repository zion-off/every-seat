"""Locating and running ffmpeg and ffprobe."""

import os
import shutil
import subprocess
from pathlib import Path


class ToolError(RuntimeError):
    """An external tool is missing or failed."""


def _find(name: str, env_var: str) -> str:
    path = os.environ.get(env_var) or shutil.which(name)
    if not path:
        raise ToolError(f"{name} not found: install it or set {env_var} to its path")
    return path


def ffmpeg() -> str:
    return _find("ffmpeg", "FFMPEG")


def ffprobe() -> str:
    return _find("ffprobe", "FFPROBE")


def run(args: list[str | Path], *, binary: bool = False) -> subprocess.CompletedProcess:
    """Run a command, capturing output; raise ToolError with the tail of stderr on failure."""
    result = subprocess.run(
        [str(a) for a in args], capture_output=True, text=not binary, check=False
    )
    if result.returncode != 0:
        stderr = result.stderr if isinstance(result.stderr, str) else result.stderr.decode()
        tail = "\n".join(stderr.strip().splitlines()[-8:])
        raise ToolError(f"{Path(str(args[0])).name} failed ({result.returncode}):\n{tail}")
    return result
