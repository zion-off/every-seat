"""AgentCore Runtime entrypoint: accept an analysis job, answer at once, finish in the background.

A film takes far longer than a runtime invocation may stay open, so `/invocations` only validates
the request and starts a worker thread. The registered async task keeps `/ping` at HealthyBusy
until the worker is done, which stops the runtime from retiring the session mid-analysis. Progress
and the final result are written to `jobs/<job>/status.json` in the results bucket.
"""

import logging
import os
import threading

import boto3
from bedrock_agentcore.runtime import BedrockAgentCoreApp

from everyseat.agent.model import DEFAULT_REGION
from everyseat.cloud.job import JobRequest, RequestError, run_job

log = logging.getLogger("everyseat.cloud")
app = BedrockAgentCoreApp()

_running: set[str] = set()
_lock = threading.Lock()


def _work(request: JobRequest, task_id: int) -> None:
    try:
        s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", DEFAULT_REGION))
        run_job(request, s3)
    except Exception:
        log.exception("job %s could not record its outcome", request.job)
    finally:
        with _lock:
            _running.discard(request.job)
        app.complete_async_task(task_id)


@app.entrypoint
def invoke(payload: dict) -> dict:
    try:
        request = JobRequest.parse(payload)
    except RequestError as error:
        return {"status": "rejected", "error": str(error)}
    with _lock:
        if request.job in _running:
            return {"status": "already_running", "job": request.job}
        _running.add(request.job)
    task_id = app.add_async_task("analyze", {"job": request.job})
    threading.Thread(target=_work, args=(request, task_id), name=f"job-{request.job}").start()
    return {"status": "accepted", "job": request.job, "status_key": request.status_key}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    app.run()
