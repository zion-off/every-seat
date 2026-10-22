"""Start an analysis when a film lands in the media bucket.

EventBridge delivers the S3 "Object Created" event here. The handler writes a `queued` status,
then asks the AgentCore runtime to run the job. The runtime answers as soon as the job has been
accepted: the analysis itself continues in the runtime and reports through `status.json`.

The invocation is a SigV4-signed HTTPS call made with botocore alone, so the function does not
depend on the data-plane service being present in the SDK bundled with the Lambda runtime.
"""

import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime

import boto3
import botocore.session
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

VIDEO_SUFFIXES = (".mp4", ".m4v", ".mov", ".mkv", ".webm")
SERVICE = "bedrock-agentcore"
SESSION_HEADER = "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id"
REQUEST_TIMEOUT_S = 100

s3 = boto3.client("s3")


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def job_ids(bucket: str, key: str, etag: str) -> tuple[str, str]:
    """A job id for the object's S3 path and a runtime session id (at least 33 characters).

    One session per job: the runtime keeps the session's microVM alive while the analysis runs and
    retires it afterwards, so jobs never share a machine.
    """
    digest = hashlib.sha256(f"{bucket}/{key}/{etag}".encode()).hexdigest()
    stem = _slug(os.path.splitext(os.path.basename(key))[0])[:40].strip("-") or "film"
    return f"{stem}-{digest[:10]}", f"job-{digest}"


def write_status(bucket: str, job: str, source: str, state: str, **fields) -> None:
    document = {
        "version": 1,
        "job": job,
        "state": state,
        "source": source,
        "updated_at": _now(),
        **fields,
    }
    s3.put_object(
        Bucket=bucket,
        Key=f"jobs/{job}/status.json",
        Body=(json.dumps(document, indent=1) + "\n").encode(),
        ContentType="application/json",
        CacheControl="no-store",
    )


def invoke_runtime(arn: str, session_id: str, payload: dict) -> dict:
    region = os.environ["AWS_REGION"]
    url = (
        f"https://{SERVICE}.{region}.amazonaws.com/runtimes/"
        f"{urllib.parse.quote(arn, safe='')}/invocations"
    )
    body = json.dumps(payload).encode()
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        SESSION_HEADER: session_id,
    }
    signed = AWSRequest(method="POST", url=url, data=body, headers=headers)
    credentials = botocore.session.get_session().get_credentials().get_frozen_credentials()
    SigV4Auth(credentials, SERVICE, region).add_auth(signed)
    request = urllib.request.Request(url, data=body, method="POST", headers=dict(signed.headers))
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
        return json.loads(response.read() or b"{}")


def handler(event, _context):
    detail = event["detail"]
    bucket, key = detail["bucket"]["name"], detail["object"]["key"]
    if not key.lower().endswith(VIDEO_SUFFIXES) or not detail["object"].get("size", 1):
        print(f"ignored s3://{bucket}/{key}")
        return {"ignored": key}

    results = os.environ["RESULTS_BUCKET"]
    job, session_id = job_ids(bucket, key, detail["object"].get("etag", ""))
    source = f"s3://{bucket}/{key}"
    write_status(results, job, source, "queued", stage="waiting for the analysis runtime")

    runtime_arn = os.environ.get("AGENT_RUNTIME_ARN", "")
    if not runtime_arn:
        write_status(
            results,
            job,
            source,
            "failed",
            error="no analysis runtime is configured: redeploy with -c agent_runtime_arn=<arn>",
        )
        return {"job": job, "state": "failed"}

    payload = {
        "job": job,
        "bucket": bucket,
        "key": key,
        "results_bucket": results,
        "iris": {
            "cluster": os.environ["IRIS_CLUSTER"],
            "task_definition": os.environ["IRIS_TASK_DEFINITION"],
            "subnets": os.environ["IRIS_SUBNETS"].split(","),
            "security_groups": [os.environ["IRIS_SECURITY_GROUP"]],
            "staging_bucket": results,
        },
    }
    try:
        answer = invoke_runtime(runtime_arn, session_id, payload)
    except urllib.error.HTTPError as error:
        detail_text = error.read().decode(errors="replace")[:500]
        write_status(
            results, job, source, "failed", error=f"runtime returned {error.code}: {detail_text}"
        )
        if error.code >= 500 or error.code == 429:
            raise  # let the asynchronous retry try again
        return {"job": job, "state": "failed"}
    except Exception as error:
        write_status(results, job, source, "failed", error=f"{type(error).__name__}: {error}")
        raise

    if answer.get("status") == "rejected":
        write_status(results, job, source, "failed", error=f"rejected: {answer.get('error')}")
        return {"job": job, "state": "failed"}
    print(f"job {job}: {answer.get('status')}")
    return {"job": job, "state": answer.get("status")}
