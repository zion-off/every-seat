"""Trace export for short-lived work.

The runtime can go idle, and be frozen, as soon as a job ends, so spans still queued in the batch
exporter would be lost. The tracer provider is flushed at the end of every job.
"""

from opentelemetry import trace

FLUSH_TIMEOUT_MS = 30_000


def flush() -> bool:
    """Export every finished span now. False when no SDK tracer provider is installed."""
    provider = trace.get_tracer_provider()
    force_flush = getattr(provider, "force_flush", None)
    if force_flush is None:
        return False
    return bool(force_flush(FLUSH_TIMEOUT_MS))
