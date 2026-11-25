"""Error handling for QuickSFC parser.

This module provides exception classes and error collection utilities
for the QuickSFC tokenizer and parser.
"""


class SFCError(Exception):
    """Base exception for QuickSFC parsing errors.

    Attributes:
        message: Error description
        line_number: Optional line number where error occurred (1-indexed)
    """

    def __init__(self, message: str, line_number: int = None):
        self.message = message
        self.line_number = line_number
        super().__init__(self._format_message())

    def _format_message(self):
        """Format error message with line number if available."""
        if self.line_number is not None:
            return f"Line {self.line_number}: {self.message}"
        return self.message


class TokenizeError(SFCError):
    """Lexical analysis error during tokenization."""
    pass


class ParseError(SFCError):
    """Syntax or semantic error during parsing."""
    pass


class ValidationError(SFCError):
    """Error during validation phase."""
    pass


class ErrorCollector:
    """Collects multiple errors during parsing for batch reporting.

    This allows the parser to continue collecting errors instead of
    failing on the first one, providing better user feedback.
    """

    def __init__(self):
        self.errors = []

    def add(self, error: SFCError):
        """Add an error to the collection.

        Args:
            error: SFCError instance to add
        """
        self.errors.append(error)

    def has_errors(self):
        """Return True if any errors have been collected."""
        return len(self.errors) > 0

    def raise_if_errors(self):
        """Raise a combined exception if any errors exist.

        Sorts errors by line number and formats them into a single
        ParseError exception with all error messages.

        Raises:
            ParseError: If any errors have been collected
        """
        if not self.has_errors():
            return

        # Sort errors by line number (None values sort to end)
        sorted_errors = sorted(
            self.errors,
            key=lambda e: (e.line_number is None, e.line_number or 0)
        )

        # Format error message
        lines = ["QuickSFC parsing failed with the following errors:\n"]
        for i, err in enumerate(sorted_errors, 1):
            lines.append(f"  {i}. {err._format_message()}")

        raise ParseError("\n".join(lines))
