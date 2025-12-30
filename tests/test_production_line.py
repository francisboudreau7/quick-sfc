#!/usr/bin/env python3
"""Test script for selection branch."""

import os
import sys

# Add parent directory to path for imports
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
QUICKSFC_DIR = os.path.dirname(TEST_DIR)
WORKSPACE_DIR = os.path.dirname(QUICKSFC_DIR)
sys.path.insert(0, WORKSPACE_DIR)

from QuickSFC.qg_parser import QGParser

def test_selection_branch():

    test_file = os.path.join(TEST_DIR, 'production_line.qsfc')
    with open(test_file, 'r') as f:
        content = f.read()

    print(f"\nInput file:\n{content}\n")

    parser = QGParser(content)
    sfc = parser.parse()

    print(f"\n{'='*70}")
    print("Parse Results:")
    print(f"{'='*70}\n")

    # Print file_comments dictionary
    print(f"FILE_COMMENTS ({len(parser.file_comments)}):")
    print("-"*70)
    for line_num, comment in sorted(parser.file_comments.items()):
        print(f"Line {line_num}: {comment}")
    print()

    # Print all steps with IDs and coordinates
    print(f"STEPS ({len(sfc.steps)}):")
    print("-"*70)
    print(f"{'Name':<15} {'ID':<5} {'Operand':<8} {'Incoming Transitions':<20} {'Outgoing Transitions':<20} {'Comments':<20}{'Action'}")
    print("-"*70)
    for step in sorted(sfc.steps, key=lambda s: s.id):
        print(f"@{step.name:<14} {step.id:<5} {step.operand:<8} {str(list(map(lambda t:t.name,step.incoming_transitions))):<20} {str(list(map(lambda t:t.name,step.outgoing_transitions))):<20} {str(step.comments):<30} {str(step.action)} ")

    # Print all transitions with IDs and coordinates
    print(f"\nTRANSITIONS ({len(sfc.transitions)}):")
    print("-"*70)
    print(f"{'Name':<15} {'ID':<5} {'Operand':<8}  {'Target':<15} {'Incoming Steps':<20} {'Outgoing Steps':<30}{'Comments':<20} ")
    print("-"*70)
    for trans in sorted(sfc.transitions, key=lambda t: t.id):
        target = f"@{trans.target_name}" if trans.target_name else ""
        print(f"@{trans.name:<14} {trans.id:<5} {trans.operand:<8} {trans.x:<6} {trans.y:<6} {target:<15} {str(list(map(lambda s:s.name,trans.incoming_steps))):<20} {str(list(map(lambda s:s.name,trans.outgoing_steps))):<{30}}{str(trans.comment):<30}")

    # Print all branches with IDs and L5X properties
    print(f"\nBRANCHES ({len(sfc.branches)}):")
    print("-"*70)
    print(f"{'Type':<12}  {'ID':<5} {'FlowType':<16}  {'Legs':<5}")
    print("-"*70)
    for branch in sfc.branches:
        print(f"{branch.flow_type:<12} {branch.id:<5} {branch.branch_type:<16} {len(list(branch.legs)):<5}")
        for i, leg in enumerate(branch.legs):

            print(f"    Leg {i}, contains {len(leg.steps)} steps, {len(leg.transitions)} transitions")


if __name__ == "__main__":
    test_selection_branch()
