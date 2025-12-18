#!/usr/bin/env python3
"""Detailed test script for parallel branch."""

import os
import sys

# Add parent directory to path for imports
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
QUICKSFC_DIR = os.path.dirname(TEST_DIR)
WORKSPACE_DIR = os.path.dirname(QUICKSFC_DIR)
sys.path.insert(0, WORKSPACE_DIR)

from QuickSFC.qg_parser import QGParser

def test_parallel_branch():
    """Test parsing of parallel (AND) branch."""
    print("="*70)
    print("Testing: simple_parallel_branch_SFC.qg")
    print("="*70)

    test_file = os.path.join(TEST_DIR, 'simple_parallel.qsfc')
    with open(test_file, 'r') as f:

        content = f.read()

    print(f"\nInput file:\n{content}\n")

    parser = QGParser(content)
    sfc = parser.parse()

    print(f"\n{'='*70}")
    print("All Elements with IDs:")
    print(f"{'='*70}\n")

# Print all steps with IDs and coordinates
    print(f"STEPS ({len(sfc.steps)}):")
    print("-"*70)
    print(f"{'Name':<15} {'ID':<5} {'Operand':<8} {'X':<6} {'Y':<6} {'Incoming Transitions':<20} {'Outgoing Transitions':<6}")
    print("-"*70)
    for step in sorted(sfc.steps, key=lambda s: s.id):
        print(f"@{step.name:<14} {step.id:<5} {step.operand:<8} {step.x:<6} {step.y:<6} {str(list(map(lambda t:t.name,step.incoming_transitions))):<20} {str(list(map(lambda t:t.name,step.outgoing_transitions))):<6}")

    print(f"\nTRANSITIONS ({len(sfc.transitions)}):")
    print("-"*70)
    print(f"{'Name':<15} {'ID':<5} {'Operand':<8} {'X':<6} {'Y':<6} {'Target':<15} {'Incoming Steps':<20} {'Outgoing Steps':<6} ")
    print("-"*70)
    for trans in sorted(sfc.transitions, key=lambda t: t.id):
        target = f"@{trans.target_name}" if trans.target_name else ""
        print(f"@{trans.name:<14} {trans.id:<5} {trans.operand:<8} {trans.x:<6} {trans.y:<6} {target:<15} {str(list(map(lambda s:s.name,trans.incoming_steps))):<20} {str(list(map(lambda s:s.name,trans.outgoing_steps))):<6}")
    print("\nBRANCHES:")
    for branch in sfc.branches:
        print(f"  ID={branch.id:<3} {branch.branch_type} {branch.flow_type}")
        for leg in branch.legs:
            print(f"    Leg ID={leg.id}: steps={[s.id for s in leg.steps]}, transitions={[t.id for t in leg.transitions]}")


    print(f"\n{'='*70}\n")

if __name__ == "__main__":
    test_parallel_branch()
