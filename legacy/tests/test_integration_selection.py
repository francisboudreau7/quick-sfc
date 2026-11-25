"""Integration test for simple_selection.qsfc - OR (selection) branches."""

import os
import sys

# Add parent directory to path for imports
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
QUICKSFC_DIR = os.path.dirname(TEST_DIR)
WORKSPACE_DIR = os.path.dirname(QUICKSFC_DIR)
sys.path.insert(0, WORKSPACE_DIR)

from QuickSFC.parser import Parser


def test_parse_simple_selection():
    """Verify that simple_selection.qsfc is correctly parsed."""
    test_file = os.path.join(TEST_DIR, 'simple_selection.qsfc')
    with open(test_file, 'r') as f:
        content = f.read()

    parser = Parser(content)
    sfc = parser.parse()

    # Verify structure counts
    assert len(sfc.steps) == 7, f"Expected 7 steps, got {len(sfc.steps)}"
    assert len(sfc.transitions) == 9, f"Expected 9 transitions, got {len(sfc.transitions)}"
    assert len(sfc.branches) >= 1, f"Expected at least 1 branch (DIVERGE OR), got {len(sfc.branches)}"

    # Verify initial step
    assert sfc.initial_step is not None, "No initial step found"
    assert sfc.initial_step.name == "init", f"Initial step should be 'init', got '{sfc.initial_step.name}'"

    # Verify all expected steps exist
    step_names = ["init", "step1", "step2", "step3", "do2", "do3", "step4"]
    for name in step_names:
        step = sfc.get_step_by_name(name)
        assert step is not None, f"Step '@{name}' not found"

    init = sfc.get_step_by_name("init")
    step1 = sfc.get_step_by_name("step1")
    step2 = sfc.get_step_by_name("step2")
    step3 = sfc.get_step_by_name("step3")
    do2 = sfc.get_step_by_name("do2")
    do3 = sfc.get_step_by_name("do3")
    step4 = sfc.get_step_by_name("step4")

    # Verify all expected transitions exist
    transition_names = ["initdone", "step1done", "step2done", "condition1",
                       "condition2", "do2done", "condition3", "do3done", "loop"]
    for name in transition_names:
        trans = sfc.get_transition_by_name(name)
        assert trans is not None, f"Transition '@{name}' not found"

    initdone = sfc.get_transition_by_name("initdone")
    step1done = sfc.get_transition_by_name("step1done")
    step2done = sfc.get_transition_by_name("step2done")
    condition1 = sfc.get_transition_by_name("condition1")
    condition2 = sfc.get_transition_by_name("condition2")
    do2done = sfc.get_transition_by_name("do2done")
    condition3 = sfc.get_transition_by_name("condition3")
    do3done = sfc.get_transition_by_name("do3done")
    loop = sfc.get_transition_by_name("loop")

    # Verify OR branch structure
    diverge_or = [b for b in sfc.branches if b.branch_type == "DIVERGE" and b.flow_type == "OR"]
    assert len(diverge_or) >= 1, f"Expected at least 1 DIVERGE OR branch, got {len(diverge_or)}"
    assert len(diverge_or[0].legs) == 3, f"Expected 3 alternative paths (legs), got {len(diverge_or[0].legs)}"

    # Verify main sequential flow
    assert initdone in init.outgoing_transitions, "init should have initdone as outgoing transition"
    assert step1 in initdone.outgoing_steps, "initdone should have step1 as outgoing step"

    assert step1done in step1.outgoing_transitions, "step1 should have step1done as outgoing transition"
    assert step2 in step1done.outgoing_steps, "step1done should have step2 as outgoing step"

    assert step2done in step2.outgoing_transitions, "step2 should have step2done as outgoing transition"
    assert step3 in step2done.outgoing_steps, "step2done should have step3 as outgoing step"

    # Verify jump targets (backward jumps for loops)
    assert condition1.target_name == "step1", f"condition1 should jump to 'step1', got '{condition1.target_name}'"
    assert do2done.target_name == "step2", f"do2done should jump to 'step2', got '{do2done.target_name}'"
    assert loop.target_name == "init", f"loop should jump to 'init', got '{loop.target_name}'"

    # Verify jumps are resolved (targets connected)
    assert step1 in condition1.outgoing_steps, "condition1 should have step1 as outgoing step (jump resolved)"
    assert step2 in do2done.outgoing_steps, "do2done should have step2 as outgoing step (jump resolved)"
    assert init in loop.outgoing_steps, "loop should have init as outgoing step (jump resolved)"

    # Verify selection divergence: step3 should have 3 outgoing transitions (the selection point)
    assert len(step3.outgoing_transitions) == 3, f"step3 should have 3 outgoing transitions (selection branches), got {len(step3.outgoing_transitions)}"
    assert condition1 in step3.outgoing_transitions, "condition1 should be in step3's outgoing transitions"
    assert condition2 in step3.outgoing_transitions, "condition2 should be in step3's outgoing transitions"
    assert condition3 in step3.outgoing_transitions, "condition3 should be in step3's outgoing transitions"

    # Verify selection leg 1: condition1 -> step1 (jump back)
    assert step1 in condition1.outgoing_steps, "condition1 should jump to step1"

    # Verify selection leg 2: condition2 -> do2 -> do2done -> step2 (jump back)
    assert do2 in condition2.outgoing_steps, "condition2 should have do2 as outgoing step"
    assert do2done in do2.outgoing_transitions, "do2 should have do2done as outgoing transition"
    assert step2 in do2done.outgoing_steps, "do2done should jump to step2"

    # Verify selection leg 3: condition3 -> do3 -> do3done -> step4
    assert do3 in condition3.outgoing_steps, "condition3 should have do3 as outgoing step"
    assert do3done in do3.outgoing_transitions, "do3 should have do3done as outgoing transition"
    assert step4 in do3done.outgoing_steps, "do3done should have step4 as outgoing step"

    # Verify final loop back
    assert loop in step4.outgoing_transitions, "step4 should have loop as outgoing transition"
    assert init in loop.outgoing_steps, "loop should jump back to init"

    print("✓ All assertions passed for simple_selection.qsfc")
    return True


if __name__ == "__main__":
    try:
        test_parse_simple_selection()
        print("\n✓ Integration test PASSED: simple_selection.qsfc is correctly parsed")
        sys.exit(0)
    except AssertionError as e:
        print(f"\n✗ Integration test FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Integration test ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
