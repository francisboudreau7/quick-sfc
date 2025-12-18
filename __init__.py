"""Quick Grafcet parser for Sequential Function Charts.

This module provides a parser for Quick Grafcet (.qg) files, a simplified
language for describing Sequential Function Charts (Grafcets).

Example usage:
    from l5x.FastSFC import parse_qg_file

    # Parse a .qg file
    sfc = parse_qg_file("path/to/file.qg")

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

from .qg_sfc import QGSFC, QGStep, QGTransition, QGBranch, QGLeg, QGDirectedLink
from .qg_parser import QGParser
from .qg_errors import QGError, ParseError, TokenizeError, ValidationError


def parse_qg_file(file_path: str):
    """Parse a Quick Grafcet .qg file and return QGSFC object.

    Args:
        file_path: Path to .qg file

    Returns:
        QGSFC object containing parsed steps and transitions

    Raises:
        ParseError: If file contains syntax or semantic errors
        FileNotFoundError: If file doesn't exist
        IOError: If file cannot be read
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    parser = QGParser(content)
    return parser.parse()


def parse_qg_string(content: str):
    """Parse Quick Grafcet content from a string.

    Args:
        content: Quick Grafcet file content as string

    Returns:
        QGSFC object containing parsed steps and transitions

    Raises:
        ParseError: If content contains syntax or semantic errors
    """
    parser = QGParser(content)
    return parser.parse()


__all__ = [
    'QGSFC',
    'QGStep',
    'QGTransition',
    'QGBranch',
    'QGLeg',
    'QGDirectedLink',
    'QGParser',
    'QGError',
    'ParseError',
    'TokenizeError',
    'ValidationError',
    'parse_qg_file',
    'parse_qg_string',
]
