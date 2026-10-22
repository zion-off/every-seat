"""Relay and lens contracts shared by the companion server, the TV app and the phone.

The JSON Schemas in `schemas/` are the source of truth. `types.py` mirrors them for Python and
`companion/src/contracts.d.ts` mirrors them for TypeScript. `validate.py` checks relay message
streams against the schemas. The SenseVTT cue file format and its validator come from the
`sensevtt` package.
"""
