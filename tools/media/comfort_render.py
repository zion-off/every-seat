#!/usr/bin/env python3
"""Render the comfort audio rendition from a recipe.

The recipe lists windows around loud moments. Inside each window the gain falls to `gain_db`,
and a look-ahead limiter caps the peaks of the whole track:

    {"gain_db": -18, "pre_s": 0.4, "ramp_s": 0.3, "release_s": 1.0, "limiter": 0.25,
     "windows": [{"onset": 463.4, "end": 465.5}]}

For each window the gain starts falling at `onset - pre_s`, reaches `gain_db` after `ramp_s`,
holds until `end`, then releases over `release_s`. Where windows overlap, the deeper cut wins.
Every key except `windows` is optional and defaults to the values above; `limiter` is a linear
peak ceiling (0.0625 to 1) and null turns the limiter off.

A plain compressor has no look-ahead and lowers the whole track instead, which is why the gain is
ridden from known onset times.

Usage: comfort_render.py --recipe RECIPE.json --input IN --output OUT.wav
Environment: FFMPEG overrides the ffmpeg path.
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

DEFAULTS = {"gain_db": -18.0, "pre_s": 0.4, "ramp_s": 0.3, "release_s": 1.0, "limiter": 0.25}
KNOWN_KEYS = set(DEFAULTS) | {"windows"}


class RecipeError(ValueError):
    pass


def is_number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def load_recipe(path: Path) -> dict:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as err:
        raise RecipeError(f"cannot read recipe {path}: {err}") from err
    if not isinstance(raw, dict):
        raise RecipeError("recipe must be a JSON object")
    unknown = sorted(set(raw) - KNOWN_KEYS)
    if unknown:
        raise RecipeError(f"unknown recipe keys: {', '.join(unknown)}")
    recipe = {**DEFAULTS, **raw}

    for key in ("gain_db", "pre_s", "ramp_s", "release_s"):
        if not is_number(recipe[key]):
            raise RecipeError(f"{key} must be a number")
    if recipe["gain_db"] > 0:
        raise RecipeError("gain_db must not be positive")
    if recipe["pre_s"] < 0:
        raise RecipeError("pre_s must not be negative")
    for key in ("ramp_s", "release_s"):
        if recipe[key] <= 0:
            raise RecipeError(f"{key} must be greater than 0")
    limiter = recipe["limiter"]
    if limiter is not None and not (is_number(limiter) and 0.0625 <= limiter <= 1):
        raise RecipeError("limiter must be null or a number from 0.0625 to 1")

    windows = recipe.get("windows", [])
    if not isinstance(windows, list):
        raise RecipeError("windows must be a list")
    for i, window in enumerate(windows):
        where = f"windows[{i}]"
        if not isinstance(window, dict) or set(window) != {"onset", "end"}:
            raise RecipeError(f'{where} must be an object with "onset" and "end"')
        if not (is_number(window["onset"]) and is_number(window["end"])):
            raise RecipeError(f"{where}: onset and end must be numbers")
        if window["onset"] < 0 or window["end"] < window["onset"]:
            raise RecipeError(f"{where}: need 0 <= onset <= end")
    recipe["windows"] = sorted(windows, key=lambda w: w["onset"])
    return recipe


def num(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".") or "0"


def window_gain_db(recipe: dict, window: dict) -> str:
    start = window["onset"] - recipe["pre_s"]
    done = window["end"] + recipe["release_s"]
    return (
        f"{num(recipe['gain_db'])}"
        f"*clip((t-({num(start)}))/{num(recipe['ramp_s'])},0,1)"
        f"*clip(({num(done)}-t)/{num(recipe['release_s'])},0,1)"
    )


def build_filter(recipe: dict) -> str:
    stages = []
    terms = [window_gain_db(recipe, w) for w in recipe["windows"]]
    if terms and recipe["gain_db"] < 0:
        gain_db = terms[-1]
        for term in reversed(terms[:-1]):
            gain_db = f"min({term},{gain_db})"
        # The gain is evaluated once per audio frame, so small frames keep each step inaudible.
        stages.append("asetnsamples=n=256:p=0")
        stages.append(f"volume=volume='pow(10,({gain_db})/20)':eval=frame")
    if recipe["limiter"] is not None:
        stages.append(f"alimiter=limit={num(recipe['limiter'])}:level=false")
    return ",".join(stages) or "anull"


def main() -> int:
    parser = argparse.ArgumentParser(description="Render the comfort audio rendition.")
    parser.add_argument("--recipe", required=True, type=Path, help="recipe JSON")
    parser.add_argument("--input", required=True, type=Path, help="audio (or a file with audio)")
    parser.add_argument("--output", required=True, type=Path, help="output .wav")
    parser.add_argument(
        "--print-filter", action="store_true", help="print the ffmpeg filter and exit"
    )
    args = parser.parse_args()

    try:
        recipe = load_recipe(args.recipe)
    except RecipeError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    audio_filter = build_filter(recipe)
    if args.print_filter:
        print(audio_filter)
        return 0
    if args.output.suffix != ".wav":
        print("error: --output must end in .wav", file=sys.stderr)
        return 2
    if not args.input.is_file():
        print(f"error: no such file: {args.input}", file=sys.stderr)
        return 2

    args.output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        os.environ.get("FFMPEG", "ffmpeg"),
        *("-v", "error", "-y", "-nostdin"),
        *("-i", str(args.input)),
        *("-map", "0:a:0", "-vn"),
        *("-af", audio_filter),
        *("-c:a", "pcm_s16le"),
        str(args.output),
    ]
    try:
        subprocess.run(command, check=True)
    except FileNotFoundError:
        print("error: ffmpeg not found (set FFMPEG to its path)", file=sys.stderr)
        return 2
    except subprocess.CalledProcessError as err:
        return err.returncode
    print(
        f"{args.output}: {len(recipe['windows'])} window(s), gain {num(recipe['gain_db'])} dB, "
        f"limiter {recipe['limiter']}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
