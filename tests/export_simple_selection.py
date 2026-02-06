"""Export simple_selection.qsfc to L5X for testing in Studio 5000."""

import sys
import os

# Add workspace to path for imports
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
QUICKSFC_DIR = os.path.dirname(TEST_DIR)
WORKSPACE_DIR = os.path.dirname(QUICKSFC_DIR)
sys.path.insert(0, WORKSPACE_DIR)

from QuickSFC import parse_file
from QuickSFC.L5X_exporter import L5XExporter

INPUT_FILE = os.path.join(TEST_DIR, "simple_selection.qsfc")
OUTPUT_FILE = os.path.join(TEST_DIR, "simple_selection.L5X")

sfc = parse_file(INPUT_FILE)
L5XExporter(sfc).export(OUTPUT_FILE)
print(f"Exported {OUTPUT_FILE}")
