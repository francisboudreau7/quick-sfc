"""Integration test for simple_parallel.qsfc - AND (parallel) branches."""

import os
import sys

# Add parent directory to path for imports
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
QUICKSFC_DIR = os.path.dirname(TEST_DIR)
WORKSPACE_DIR = os.path.dirname(QUICKSFC_DIR)
sys.path.insert(0, WORKSPACE_DIR)

from QuickSFC.qg_parser import QGParser


def test_parse_simple_parallel():
    """Verify that simple_parallel.qsfc is correctly parsed."""
    test_file = os.path.join(TEST_DIR, 'simple_parallel.qsfc')
    with open(test_file, 'r') as f:
        content = f.read()

    parser = QGParser(content)
    sfc = parser.parse()

    # Verify structure counts
    assert len(sfc.steps) == 5, f"Expected 5 steps, got {len(sfc.steps)}"
    assert len(sfc.transitions) == 3, f"Expected 3 transitions, got {len(sfc.transitions)}"
    assert len(sfc.branches) == 2, f"Expected 2 branches (DIVERGE AND + CONVERGE AND), got {len(sfc.branches)}"

    # Verify initial step
    assert sfc.initial_step is not None, "No initial step found"
    assert sfc.initial_step.name == "init", f"Initial step should be 'init', got '{sfc.initial_step.name}'"

    # Verify all expected steps exist
    step_names = ["init", "do1", "do2", "do5", "do3"]
    for name in step_names:
        step = sfc.get_step_by_name(name)
        assert step is not None, f"Step '@{name}' not found"

    init = sfc.get_step_by_name("init")
    do1 = sfc.get_step_by_name("do1")
    do2 = sfc.get_step_by_name("do2")
    do5 = sfc.get_step_by_name("do5")
    do3 = sfc.get_step_by_name("do3")

    # Verify all expected transitions exist
    transition_names = ["beginsplit", "do2done", "finalize"]
    for name in transition_names:
        trans = sfc.get_transition_by_name(name)
        assert trans is not None, f"Transition '@{name}' not found"

    beginsplit = sfc.get_transition_by_name("beginsplit")
    do2done = sfc.get_transition_by_name("do2done")
    finalize = sfc.get_transition_by_name("finalize")

    # Verify AND branch structure
    diverge_and = [b for b in sfc.branches if b.branch_type == "DIVERGE" and b.flow_type == "AND"]
    assert len(diverge_and) == 1, f"Expected 1 DIVERGE AND branch, got {len(diverge_and)}"
    assert len(diverge_and[0].legs) == 3, f"Expected 3 parallel legs, got {len(diverge_and[0].legs)}"

    converge_and = [b for b in sfc.branches if b.branch_type == "CONVERGE" and b.flow_type == "AND"]
    assert len(converge_and) == 1, f"Expected 1 CONVERGE AND branch, got {len(converge_and)}"

    # Verify jump target on finalize transition
    assert finalize.target_name == "init", f"finalize should jump to 'init', got '{finalize.target_name}'"
    assert init in finalize.outgoing_steps, "finalize should have init as outgoing step"

    # Verify parallel split: beginsplit should have 3 outgoing steps
    assert len(beginsplit.outgoing_steps) == 3, f"beginsplit should have 3 outgoing steps, got {len(beginsplit.outgoing_steps)}"
    assert do1 in beginsplit.outgoing_steps, "do1 should be in beginsplit's outgoing steps"
    assert do2 in beginsplit.outgoing_steps, "do2 should be in beginsplit's outgoing steps"
    assert do3 in beginsplit.outgoing_steps, "do3 should be in beginsplit's outgoing steps"

    # Verify middle leg has transition do2done
    assert do2done in do2.outgoing_transitions, "do2 should have do2done as outgoing transition"
    assert do5 in do2done.outgoing_steps, "do2done should have do5 as outgoing step"

    # Verify parallel convergence: finalize should have 3 incoming steps
    assert len(finalize.incoming_steps) == 3, f"finalize should have 3 incoming steps (from parallel legs), got {len(finalize.incoming_steps)}"
    assert do1 in finalize.incoming_steps, "do1 should be in finalize's incoming steps"
    assert do5 in finalize.incoming_steps, "do5 should be in finalize's incoming steps"
    assert do3 in finalize.incoming_steps, "do3 should be in finalize's incoming steps"

    print("✓ All assertions passed for simple_parallel.qsfc")
    return True


if __name__ == "__main__":
    try:
        test_parse_simple_parallel()
        print("\n✓ Integration test PASSED: simple_parallel.qsfc is correctly parsed")
        sys.exit(0)
    except AssertionError as e:
        print(f"\n✗ Integration test FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Integration test ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
