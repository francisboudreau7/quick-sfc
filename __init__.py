"""QuickSFC parser for Sequential Function Charts.

This module provides a parser for QuickSFC (.qsfc) files, a simplified
language for describing Sequential Function Charts (SFCs).

Example usage:
    from QuickSFC import parse_file

    # Parse a .qsfc file
    sfc = parse_file("path/to/file.qsfc")

    # Access the parsed SFC
    print(f"Steps: {len(sfc.steps)}")
    print(f"Transitions: {len(sfc.transitions)}")

    # Print summary
    sfc.print_summary()

    # Navigate relationships
    initial = sfc.initial_step
    for trans in initial.outgoing_transitions:
        print(f"Transition {trans.condition} → Step {trans.to_step.id}")
"""

from .sfc import SFC, Step, Transition, Branch, Leg
from .parser import Parser
from .errors import SFCError, ParseError, TokenizeError, ValidationError


def parse_file(file_path: str):
    """Parse a QuickSFC .qsfc file and return SFC object.

    Args:
        file_path: Path to .qsfc file

    Returns:
        SFC object containing parsed steps and transitions

    Raises:
        ParseError: If file contains syntax or semantic errors
        FileNotFoundError: If file doesn't exist
        IOError: If file cannot be read
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    parser = Parser(content)
    return parser.parse()


def parse_string(content: str):
    """Parse QuickSFC content from a string.

    Args:
        content: QuickSFC file content as string

    Returns:
        SFC object containing parsed steps and transitions

    Raises:
        ParseError: If content contains syntax or semantic errors
    """
    parser = Parser(content)
    return parser.parse()


__all__ = [
    'SFC',
    'Step',
    'Transition',
    'Branch',
    'Leg',
    'Parser',
    'SFCError',
    'ParseError',
    'TokenizeError',
    'ValidationError',
    'parse_file',
    'parse_string',
]
