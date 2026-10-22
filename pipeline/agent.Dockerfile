# AgentCore Runtime container for the analysis pipeline (linux/arm64).
#
# The build context is the pipeline directory, and this file sits at its root so that the
# context upload needs no directory re-included beside the ignored ones:
#   docker buildx build --platform linux/arm64 -f agent.Dockerfile .
#
# The SenseVTT library comes from PyPI. Until it is published, pass a checkout's `python`
# directory as the `sensevtt` build context (otherwise that stage is empty and ignored):
#   docker buildx build --platform linux/arm64 -f agent.Dockerfile \
#     --build-context sensevtt=../../sensevtt/python .
FROM scratch AS sensevtt

# The runtime contract is HTTP on port 8080 (POST /invocations, GET /ping). An invocation starts
# the analysis in a background thread and returns at once; see everyseat/cloud/app.py.
FROM public.ecr.aws/docker/library/python:3.12-slim-trixie

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DOCKER_CONTAINER=1 \
    EVERYSEAT_AWS_SESSION=role \
    EVERYSEAT_IRIS_BACKEND=fargate

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 1000 bedrock_agentcore

WORKDIR /app

# Dependencies first, so a code change does not reinstall them. The bracketed names keep the
# copies from failing when the context is empty.
COPY --from=sensevtt /pyproject.tom[l] /README.m[d] /tmp/sensevtt/
COPY --from=sensevtt /sensevt[t] /tmp/sensevtt/sensevtt/
RUN if [ -f /tmp/sensevtt/pyproject.toml ]; then pip install /tmp/sensevtt; fi \
 && rm -rf /tmp/sensevtt

COPY pyproject.toml ./
RUN python -c "import tomllib; p = tomllib.load(open('pyproject.toml', 'rb'))['project']; \
print('\n'.join(p['dependencies'] + p['optional-dependencies']['cloud']))" > /tmp/requirements.txt \
 && pip install -r /tmp/requirements.txt && rm /tmp/requirements.txt

COPY everyseat ./everyseat
RUN pip install --no-deps .

USER bedrock_agentcore
EXPOSE 8080
CMD ["opentelemetry-instrument", "python", "-m", "everyseat.cloud.app"]
