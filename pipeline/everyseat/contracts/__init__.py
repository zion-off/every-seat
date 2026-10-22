"""Data contracts shared by the analysis pipeline, the companion server and the TV app.

The JSON Schemas in `schemas/` are the source of truth. `types.py` mirrors them for Python and
`companion/src/contracts.d.ts` mirrors them for TypeScript. `validate.py` checks files against
the schemas plus the semantic rules a schema can't express.
"""
