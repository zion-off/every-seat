"""The flash analyzer as a one-off Fargate task.

The proxy goes to S3, the task downloads it through a presigned URL, runs the analyzer and uploads
one archive of the results through a second presigned URL, and this module unpacks the archive into
the same layout a local container run leaves behind. The task role therefore needs no storage
permissions, and the caller needs no container runtime.
"""

import os
import tarfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

import boto3
from botocore.config import Config

from everyseat.detectors import tools

REGION_ENV = "AWS_REGION"
DEFAULT_REGION = "us-east-1"
CONTAINER = "iris"
URL_TTL_S = 6 * 3600
POLL_S = 10
# ECS rejects container overrides longer than this many characters.
OVERRIDE_LIMIT = 8192


@dataclass(frozen=True)
class FargateConfig:
    cluster: str
    task_definition: str
    subnets: tuple[str, ...]
    security_groups: tuple[str, ...]
    bucket: str
    prefix: str = "work/"
    timeout_s: float = 4 * 3600

    @classmethod
    def from_env(cls) -> "FargateConfig":
        def need(name: str) -> str:
            value = os.environ.get(name, "")
            if not value:
                raise tools.ToolError(f"{name} is required for the Fargate flash analyzer")
            return value

        def split(value: str) -> tuple[str, ...]:
            return tuple(part.strip() for part in value.split(",") if part.strip())

        return cls(
            cluster=need("EVERYSEAT_IRIS_CLUSTER"),
            task_definition=need("EVERYSEAT_IRIS_TASK_DEFINITION"),
            subnets=split(need("EVERYSEAT_IRIS_SUBNETS")),
            security_groups=split(need("EVERYSEAT_IRIS_SECURITY_GROUPS")),
            bucket=need("EVERYSEAT_IRIS_STAGING_BUCKET"),
            prefix=os.environ.get("EVERYSEAT_IRIS_STAGING_PREFIX", "work/"),
            timeout_s=float(os.environ.get("EVERYSEAT_IRIS_TIMEOUT_S", 4 * 3600)),
        )


def _wait(ecs, config: FargateConfig, arn: str) -> dict:
    deadline = time.monotonic() + config.timeout_s
    while True:
        described = ecs.describe_tasks(cluster=config.cluster, tasks=[arn])
        task = described["tasks"][0] if described["tasks"] else None
        if task and task["lastStatus"] == "STOPPED":
            return task
        if time.monotonic() > deadline:
            ecs.stop_task(cluster=config.cluster, task=arn, reason="analysis timed out")
            raise tools.ToolError(f"the flash analyzer did not finish in {config.timeout_s:g} s")
        time.sleep(POLL_S)


def _tail(path: Path, lines: int = 6) -> str:
    if not path.is_file():
        return ""
    return "\n".join(path.read_text(errors="replace").strip().splitlines()[-lines:])


def _start(ecs, config: FargateConfig, command: list[str]) -> str:
    started = ecs.run_task(
        cluster=config.cluster,
        taskDefinition=config.task_definition,
        launchType="FARGATE",
        count=1,
        networkConfiguration={
            "awsvpcConfiguration": {
                "subnets": list(config.subnets),
                "securityGroups": list(config.security_groups),
                "assignPublicIp": "ENABLED",
            }
        },
        overrides={"containerOverrides": [{"name": CONTAINER, "command": command}]},
    )
    if started.get("failures") or not started.get("tasks"):
        reasons = "; ".join(
            f"{f.get('reason', '?')} {f.get('detail', '')}".strip()
            for f in started.get("failures", [])
        )
        raise tools.ToolError(f"the flash analyzer task did not start: {reasons or 'no task'}")
    return started["tasks"][0]["taskArn"]


def _unpack(s3, config: FargateConfig, key: str, out_dir: Path, task: dict) -> None:
    try:
        body = s3.get_object(Bucket=config.bucket, Key=key)["Body"]
    except s3.exceptions.NoSuchKey:
        reason = task.get("stoppedReason", "no reason given")
        raise tools.ToolError(f"the flash analyzer task left no results ({reason})") from None
    archive = out_dir / "out.tgz"
    with archive.open("wb") as handle:
        for block in iter(lambda: body.read(1 << 20), b""):
            handle.write(block)
    with tarfile.open(archive) as bundle:
        bundle.extractall(out_dir, filter="data")
    archive.unlink()


def run(media: Path, out_dir: Path, config: FargateConfig | None = None) -> None:
    """Analyze `media` on Fargate and unpack the results into the (empty) `out_dir`."""
    config = config or FargateConfig.from_env()
    region = os.environ.get(REGION_ENV, DEFAULT_REGION)
    s3 = boto3.client("s3", region_name=region, config=Config(signature_version="s3v4"))
    ecs = boto3.client("ecs", region_name=region)

    base = f"{config.prefix}{uuid.uuid4().hex}/"
    media_key, archive_key = f"{base}{media.name}", f"{base}out.tgz"
    try:
        s3.upload_file(str(media), config.bucket, media_key)
        command = [
            s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": config.bucket, "Key": media_key},
                ExpiresIn=URL_TTL_S,
            ),
            s3.generate_presigned_url(
                "put_object",
                Params={"Bucket": config.bucket, "Key": archive_key},
                ExpiresIn=URL_TTL_S,
            ),
            media.name,
        ]
        if sum(len(part) for part in command) > OVERRIDE_LIMIT - 512:
            raise tools.ToolError("the task command is too long for ECS: shorten the prefix")
        task = _wait(ecs, config, _start(ecs, config, command))
        _unpack(s3, config, archive_key, out_dir, task)
        container = next((c for c in task["containers"] if c["name"] == CONTAINER), {})
        code = container.get("exitCode")
        if code != 0:
            detail = _tail(out_dir / "run.log") or task.get("stoppedReason", "")
            raise tools.ToolError(f"the flash analyzer failed ({code}):\n{detail}")
    finally:
        s3.delete_objects(
            Bucket=config.bucket,
            Delete={"Objects": [{"Key": media_key}, {"Key": archive_key}], "Quiet": True},
        )
