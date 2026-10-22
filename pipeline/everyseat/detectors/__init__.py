"""Deterministic detectors: they set the timestamps, and the agent only rates intensity.

Every detector reads a constant-frame-rate proxy made by `proxy.build_proxy`, so all times are
seconds on one integer-fps frame grid.
"""
