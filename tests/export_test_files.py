"""Export sample charts to L5X for testing in Studio 5000."""

import sys
import os

# Add workspace to path for imports
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
QUICKSFC_DIR = os.path.dirname(TEST_DIR)
WORKSPACE_DIR = os.path.dirname(QUICKSFC_DIR)
sys.path.insert(0, WORKSPACE_DIR)

from QuickSFC import parse_file
from QuickSFC.L5X_exporter import L5XExporter

for name, declare_missing_tags in (("simple_selection", False), ("production_line", True)):
    sfc = parse_file(os.path.join(TEST_DIR, f"{name}.qsfc"))
    output_file = os.path.join(TEST_DIR, f"{name}.L5X")
    L5XExporter(sfc).set_declare_missing_tags(declare_missing_tags).export(output_file)
    print(f"Exported {output_file}")
