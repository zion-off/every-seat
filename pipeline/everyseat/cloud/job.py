"""The analysis job that runs inside the agent container.

One job analyzes one film from S3: it downloads the source, runs the detectors and the Nova agent,
and uploads the cue file, the comfort recipe and the run log under `jobs/<job>/` in the results
bucket. `jobs/<job>/status.json` is rewritten at every stage so a client can poll one object.
"""

import json
import os
import re
import shutil
import tempfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from opentelemetry import trace

from everyseat.analyze import analyze, excerpt_name
from everyseat.cloud import tracing

JOB_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
ERROR_LIMIT = 2000
STATUS_VERSION = 1

# Payload `iris` keys and the environment variables the Fargate backend reads them from.
IRIS_ENV = {
    "cluster": "EVERYSEAT_IRIS_CLUSTER",
    "task_definition": "EVERYSEAT_IRIS_TASK_DEFINITION",
    "subnets": "EVERYSEAT_IRIS_SUBNETS",
    "security_groups": "EVERYSEAT_IRIS_SECURITY_GROUPS",
    "staging_bucket": "EVERYSEAT_IRIS_STAGING_BUCKET",
    "staging_prefix": "EVERYSEAT_IRIS_STAGING_PREFIX",
}


class RequestError(ValueError):
    """The invocation payload or the object's metadata is not usable."""


def _number(value, label: str) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise RequestError(f"{label} must be a number, got {value!r}") from None
    if number < 0:
        raise RequestError(f"{label} must not be negative")
    return number


@dataclass(frozen=True)
class JobRequest:
    job: str
    bucket: str
    key: str
    results_bucket: str
    start: float | None = None
    duration: float | None = None
    model: str | None = None
    title: str | None = None
    with_iris: bool = True
    iris: dict[str, str] = field(default_factory=dict)

    @classmethod
    def parse(cls, payload: object) -> "JobRequest":
        if not isinstance(payload, dict):
            raise RequestError("the payload must be a JSON object")
        for name in ("job", "bucket", "key", "results_bucket"):
            if not isinstance(payload.get(name), str) or not payload[name]:
                raise RequestError(f"{name} is required")
        if not JOB_ID.match(payload["job"]):
            raise RequestError("job must be lowercase letters, digits and hyphens")
        iris = payload.get("iris") or {}
        if not isinstance(iris, dict):
            raise RequestError("iris must be an object")
        unknown = set(iris) - set(IRIS_ENV)
        if unknown:
            raise RequestError(f"unknown iris settings: {', '.join(sorted(unknown))}")
        return cls(
            job=payload["job"],
            bucket=payload["bucket"],
            key=payload["key"],
            results_bucket=payload["results_bucket"],
            start=_number(payload.get("start"), "start"),
            duration=_number(payload.get("duration"), "duration"),
            model=payload.get("model"),
            title=payload.get("title"),
            with_iris=payload.get("with_iris", True) is not False,
            iris={
                name: ",".join(value) if isinstance(value, list) else str(value)
                for name, value in iris.items()
            },
        )

    @property
    def status_key(self) -> str:
        return f"jobs/{self.job}/status.json"

    def output_key(self, filename: str) -> str:
        return f"jobs/{self.job}/{filename}"


class Status:
    """The job's `status.json`, rewritten whole on every change."""

    def __init__(self, s3, request: JobRequest):
        self._s3 = s3
        self._request = request
        self.document = {
            "version": STATUS_VERSION,
            "job": request.job,
            "state": "queued",
            "stage": "",
            "source": f"s3://{request.bucket}/{request.key}",
            "started_at": _now(),
            "updated_at": _now(),
        }

    def update(self, **fields) -> None:
        self.document.update(fields, updated_at=_now())
        self._s3.put_object(
            Bucket=self._request.results_bucket,
            Key=self._request.status_key,
            Body=(json.dumps(self.document, indent=1) + "\n").encode(),
            ContentType="application/json",
            CacheControl="no-store",
        )


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _settings(request: JobRequest, metadata: dict[str, str]) -> dict:
    """Excerpt and model choices: the payload wins over the object's user metadata."""
    start = request.start if request.start is not None else _number(metadata.get("start"), "start")
    duration = (
        request.duration
        if request.duration is not None
        else _number(metadata.get("duration"), "duration")
    )
    return {
        "start": start or 0.0,
        "duration": duration,
        "model": request.model or metadata.get("model") or "nova-pro",
        "title": request.title or metadata.get("title"),
        "with_iris": request.with_iris and metadata.get("iris", "on") != "off",
    }


def run_job(request: JobRequest, s3, work_root: Path | None = None) -> Status:
    """Run one job to completion; failures are recorded in the status and do not raise."""
    status = Status(s3, request)
    work = Path(tempfile.mkdtemp(prefix=f"{request.job}-", dir=work_root))
    tracer = trace.get_tracer("everyseat.cloud")
    try:
        with tracer.start_as_current_span("everyseat.job", attributes={"job": request.job}):
            _run(request, s3, status, work)
    except Exception as error:  # the status file is the only way the client learns of it
        message = f"{type(error).__name__}: {error}"
        status.update(state="failed", stage="failed", error=message[-ERROR_LIMIT:])
        _upload_log(request, s3, status, work / "out")
    finally:
        shutil.rmtree(work, ignore_errors=True)
        tracing.flush()
    return status


def _upload_log(request: JobRequest, s3, status: Status, out_dir: Path) -> None:
    """Keep the run log of a failed analysis: it says what the agent left open."""
    for log in out_dir.glob("*.run.json"):
        key = request.output_key(log.name)
        try:
            s3.upload_file(str(log), request.results_bucket, key)
            status.update(outputs={"run_log": key})
        except Exception:  # best effort: the failure is already recorded
            return


def _run(request: JobRequest, s3, status: Status, work: Path) -> None:
    status.update(state="running", stage="reading the object")
    head = s3.head_object(Bucket=request.bucket, Key=request.key)
    settings = _settings(request, head.get("Metadata", {}))

    stem = Path(request.key).stem
    title = settings["title"] or _slug(stem) or "film"
    source = work / f"{_slug(stem) or 'film'}{Path(request.key).suffix.lower() or '.mp4'}"
    status.update(stage="downloading", settings=settings)
    s3.download_file(request.bucket, request.key, str(source))

    for name, value in request.iris.items():
        os.environ[IRIS_ENV[name]] = value
    result = analyze(
        source,
        work / "out",
        name=excerpt_name(source, settings["start"], settings["duration"]),
        title=title,
        model_choice=settings["model"],
        work_dir=work / "detect",
        start=settings["start"],
        duration=settings["duration"],
        with_iris=settings["with_iris"],
        progress=lambda line: status.update(stage=line),
    )

    status.update(stage="uploading")
    outputs = {}
    for label, path in (
        ("sensevtt", result.sensevtt),
        ("recipe", result.recipe),
        ("run_log", result.log),
    ):
        key = request.output_key(path.name)
        s3.upload_file(str(path), request.results_bucket, key)
        outputs[label] = key
    run = result.run
    status.update(
        state="succeeded",
        stage="done",
        outputs=outputs,
        cues=result.cue_count,
        usage={
            "model": run.model_id,
            "input_tokens": run.input_tokens,
            "output_tokens": run.output_tokens,
            "cost_usd": run.cost_usd,
            "elapsed_s": run.elapsed_s,
        },
    )
