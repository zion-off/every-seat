"""Audio description: spoken descriptions of what is on screen, placed in the quiet stretches."""


class DescribeError(RuntimeError):
    """A description could not be written or voiced."""


class Rejected(DescribeError):
    """Every answer the writer gave for a window was turned down by the review."""
