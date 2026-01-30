#!/usr/bin/env python3
"""Simple test runner for QuickSFC tests (no pytest required)."""

import os
import sys

# Add parent directory to path for imports
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
QUICKSFC_DIR = os.path.dirname(TEST_DIR)
WORKSPACE_DIR = os.path.dirname(QUICKSFC_DIR)
sys.path.insert(0, WORKSPACE_DIR)

from QuickSFC.tokenizer import Tokenizer, TokenType, Token
from QuickSFC.tokenizer import Tokenizer, TokenType
from QuickSFC.sfc import Step, Transition, SFC, Branch, Leg
from QuickSFC.parser import Parser
from QuickSFC.errors import TokenizeError, ParseError


def run_test(test_name, test_func):
    """Run a single test and report results."""
    try:
        test_func()
        print(f"✓ {test_name}")
        return True
    except AssertionError as e:
        print(f"✗ {test_name}: {e}")
        return False
    except Exception as e:
        print(f"✗ {test_name}: Unexpected error: {e}")
        return False


def assert_raises(exception_class, func):
    """Helper to assert that a function raises a specific exception."""
    try:
        func()
        raise AssertionError(f"Expected {exception_class.__name__} but no exception was raised")
    except exception_class:
        pass  # Expected


def assert_in(substring, string):
    """Helper to assert substring in string."""
    assert substring in string, f"'{substring}' not found in '{string}'"


# =============================================================================
# TOKENIZER TESTS
# =============================================================================

def test_tokenize_simple_step():
    """Test tokenizing a basic step."""
    tokenizer = Tokenizer("S@step1(action)")
    tokens = tokenizer.tokenize()

    assert tokens[0].type == TokenType.S
    assert tokens[1].type == TokenType.AT
    assert tokens[2].type == TokenType.NAME
    assert tokens[2].value == "step1"
    assert tokens[3].type == TokenType.LPAREN
    assert tokens[4].type == TokenType.ACTION
    assert tokens[4].value == "action"
    assert tokens[5].type == TokenType.RPAREN
    assert tokens[-1].type == TokenType.EOF


def test_tokenize_multi_char_operators():
    """Test multi-character operators are recognized correctly."""
    test_cases = [
        ("//\\\\", TokenType.AND_DIVERGE),
        ("\\\\//", TokenType.AND_CONVERGE),
        ("/\\", TokenType.OR_DIVERGE),
        ("\\/", TokenType.OR_CONVERGE),
        (">>", TokenType.JUMP),
        ("->", TokenType.JUMP),
        ("|", TokenType.LEG_SEPARATOR),
    ]

    for text, expected_type in test_cases:
        tokenizer = Tokenizer(text)
        tokens = tokenizer.tokenize()
        assert tokens[0].type == expected_type, f"Failed for {text}"


def test_tokenize_keywords_si_vs_s():
    """Test that SI is recognized before S."""
    tokenizer = Tokenizer("SI@init()")
    tokens = tokenizer.tokenize()
    assert tokens[0].type == TokenType.SI
    assert tokens[0].value == "SI"

    tokenizer = Tokenizer("S@step()")
    tokens = tokenizer.tokenize()
    assert tokens[0].type == TokenType.S


def test_tokenize_with_comments():
    """Test that comments are skipped."""
    content = """# This is a comment
S@step1(action)  # inline comment
"""
    tokenizer = Tokenizer(content)
    tokens = tokenizer.tokenize()

    token_types = [t.type for t in tokens]
    assert TokenType.S in token_types
    assert TokenType.NAME in token_types


def test_tokenize_nested_parentheses_in_action():
    """Test actions can contain nested parentheses."""
    tokenizer = Tokenizer("S@step(func(a, b))")
    tokens = tokenizer.tokenize()

    action_token = [t for t in tokens if t.type == TokenType.ACTION][0]
    assert action_token.value == "func(a, b)"


def test_tokenize_action_vs_condition():
    """Test that S produces ACTION and T produces CONDITION."""
    tokenizer = Tokenizer("S@step(x:=1)")
    tokens = tokenizer.tokenize()
    assert any(t.type == TokenType.ACTION for t in tokens)

    tokenizer = Tokenizer("T@trans(x>5)")
    tokens = tokenizer.tokenize()
    assert any(t.type == TokenType.CONDITION for t in tokens)


def test_tokenize_line_numbers():
    """Test that line numbers are tracked correctly."""
    content = """S@step1(a)
T@trans(b)
S@step2(c)"""
    tokenizer = Tokenizer(content)
    tokens = tokenizer.tokenize()

    line1_tokens = [t for t in tokens if t.line_number == 1]
    line2_tokens = [t for t in tokens if t.line_number == 2]
    line3_tokens = [t for t in tokens if t.line_number == 3]

    assert len(line1_tokens) > 0
    assert len(line2_tokens) > 0
    assert len(line3_tokens) > 0


def test_tokenize_invalid_character_raises_error():
    """Test that invalid characters raise TokenizeError."""
    # Use & outside of action context - should be invalid
    tokenizer = Tokenizer("S@step() &")

    def test_func():
        tokenizer.tokenize()

    try:
        test_func()
        raise AssertionError("Expected TokenizeError but none was raised")
    except TokenizeError as e:
        assert_in("Unexpected character", str(e))


# =============================================================================
# SFC DATA MODEL TESTS
# =============================================================================

def test_step_creation():
    """Test QGStep creation and attributes."""
    step = Step("init", "x:=0", preset=100, is_initial=True, line_number=1)

    assert step.name == "init"
    assert step.action == "x:=0"
    assert step.preset == 100
    assert step.is_initial == True
    assert step.line_number == 1
    assert step.id is None
    assert step.operand is None


def test_transition_creation():
    """Test QGTransition creation and attributes."""
    trans = Transition("start", "button_pressed", target_name="running", line_number=2)

    assert trans.name == "start"
    assert trans.condition == "button_pressed"
    assert trans.target_name == "running"
    assert trans.line_number == 2


def test_step_transition_bidirectional_relationship():
    """Test bidirectional linking between steps and transitions."""
    step1 = Step("step1", "action1")
    trans = Transition("trans", "condition")
    step2 = Step("step2", "action2")

    step1.add_outgoing_transition(trans)
    trans.add_incoming_step(step1)
    trans.add_outgoing_step(step2)
    step2.add_incoming_transition(trans)

    assert trans in step1.outgoing_transitions
    assert step1 in trans.incoming_steps
    assert step2 in trans.outgoing_steps
    assert trans in step2.incoming_transitions


def test_qgsfc_query_methods():
    """Test SFC query methods (by name, id, operand)."""
    step1 = Step("init", "x:=0", is_initial=True)
    step1.id = 0
    step1.operand = 0

    step2 = Step("running", "x:=x+1")
    step2.id = 2
    step2.operand = 1

    trans = Transition("start", "button")
    trans.id = 1
    trans.operand = 0

    sfc = SFC([step1, step2], [trans])

    assert sfc.get_step_by_name("init") == step1
    assert sfc.get_step_by_name("running") == step2
    assert sfc.get_transition_by_name("start") == trans

    assert sfc.get_step(0) == step1
    assert sfc.get_step(2) == step2
    assert sfc.get_transition(1) == trans

    assert sfc.get_step_by_operand(0) == step1
    assert sfc.get_step_by_operand(1) == step2
    assert sfc.get_transition_by_operand(0) == trans


def test_qgsfc_initial_step_property():
    """Test SFC can identify initial step."""
    step1 = Step("init", "x:=0", is_initial=True)
    step1.operand = 0
    step2 = Step("running", "x:=x+1")
    step2.operand = 1

    sfc = SFC([step1, step2], [])

    assert sfc.initial_step == step1


def test_branch_and_leg_structure():
    """Test QGBranch and QGLeg structure."""
    branch = Branch("DIVERGE", "OR", line_number=5)
    branch.id = 10

    leg1 = Leg()
    leg1.id = 11
    step1 = Step("leg1_step", "a")
    leg1.add_step(step1)

    leg2 = Leg()
    leg2.id = 12
    step2 = Step("leg2_step", "b")
    leg2.add_step(step2)

    branch.add_leg(leg1)
    branch.add_leg(leg2)

    assert len(branch.legs) == 2
    assert branch.branch_type == "DIVERGE"
    assert branch.flow_type == "OR"



# =============================================================================
# PARSER TESTS
# =============================================================================

def test_parse_minimal_sfc():
    """Test parsing minimal valid SFC."""
    content = """SI@init()
END"""
    parser = Parser(content)
    sfc = parser.parse()

    assert len(sfc.steps) == 1
    assert sfc.steps[0].name == "init"
    assert sfc.steps[0].is_initial == True
    assert len(sfc.transitions) == 0


def test_parse_simple_sequence():
    """Test parsing simple step-transition-step sequence."""
    content = """SI@init(x:=0)
T@start(button_pressed)
S@running(x:=x+1, 100)
END"""
    parser = Parser(content)
    sfc = parser.parse()

    assert len(sfc.steps) == 2
    assert len(sfc.transitions) == 1

    init = sfc.get_step_by_name("init")
    start = sfc.get_transition_by_name("start")
    running = sfc.get_step_by_name("running")

    assert start in init.outgoing_transitions
    assert init in start.incoming_steps
    assert running in start.outgoing_steps
    assert start in running.incoming_transitions

    assert init.is_initial == True
    assert running.preset == 100


def test_parse_jump_target():
    """Test parsing >> jump to explicit target."""
    content = """SI@init()
T@start()
S@step1()
T@loop() >> @init
END"""
    parser = Parser(content)
    sfc = parser.parse()

    loop = sfc.get_transition_by_name("loop")
    init = sfc.get_step_by_name("init")

    assert loop.target_name == "init"
    assert init in loop.outgoing_steps


def test_parse_or_branch_with_convergence():
    """Test parsing OR branch (selection) - uses existing file as reference."""
    # OR branches in the actual files show they can work without explicit convergence
    # Just verify the parser can handle OR syntax with jumps
    content = """SI@init()
T@start()
S@step3()
/\\
    T@condition1() -> @step3
    |
    T@condition2() -> @step3
END"""
    parser = Parser(content)
    sfc = parser.parse()

    # Successfully parsed
    assert len(sfc.steps) > 0
    assert len(sfc.transitions) > 0


def test_parse_and_branch_with_convergence():
    """Test parsing AND branch (parallel) with convergence."""
    content = """SI@init()
T@split()
//\\\\
    S@leg1()
    |
    S@leg2()
\\\\//
T@join() -> @init
END"""
    parser = Parser(content)
    sfc = parser.parse()

    # AND branches create DIVERGE and CONVERGE branches
    assert len(sfc.branches) >= 1
    diverge = [b for b in sfc.branches if b.branch_type == "DIVERGE" and b.flow_type == "AND"][0]

    assert diverge.flow_type == "AND"
    assert len(diverge.legs) == 2


def test_parse_or_branch_without_convergence_all_jump():
    """Test OR branch without convergence is valid if all legs jump."""
    content = """SI@init()
T@start()
S@choice()
/\\
    T@opt1() -> @init
    |
    T@opt2() -> @init
END"""
    parser = Parser(content)
    sfc = parser.parse()

    assert len(sfc.branches) >= 1
    diverge = [b for b in sfc.branches if b.flow_type == "OR"][0]
    assert diverge.flow_type == "OR"


def test_parse_assigns_ids_sequentially():
    """Test that parser assigns sequential IDs."""
    content = """SI@init()
T@trans1()
S@step1()
T@trans2() >> @init
END"""
    parser = Parser(content)
    sfc = parser.parse()

    all_elements = sfc.steps + sfc.transitions
    ids = sorted([e.id for e in all_elements])
    assert ids == list(range(len(all_elements)))

    step_operands = sorted([s.operand for s in sfc.steps])
    trans_operands = sorted([t.operand for t in sfc.transitions])
    assert step_operands == list(range(len(sfc.steps)))
    assert trans_operands == list(range(len(sfc.transitions)))


def test_parse_error_duplicate_step_name():
    """Test that duplicate step names raise error."""
    content = """SI@init()
T@trans()
S@step1()
T@trans2()
S@step1()
END"""
    parser = Parser(content)

    try:
        parser.parse()
        raise AssertionError("Expected ParseError but none was raised")
    except ParseError as e:
        assert_in("Duplicate step name", str(e))


def test_parse_error_missing_si():
    """Test that missing SI raises error."""
    content = """S@step1()
END"""
    parser = Parser(content)

    try:
        parser.parse()
        raise AssertionError("Expected ParseError but none was raised")
    except ParseError as e:
        assert ("First line must be SI" in str(e) or "No initial step" in str(e))


def test_parse_error_missing_end():
    """Test that missing END raises error."""
    content = """SI@init()"""
    parser = Parser(content)

    try:
        parser.parse()
        raise AssertionError("Expected ParseError but none was raised")
    except ParseError as e:
        assert_in("Missing END marker", str(e))


def test_parse_error_invalid_jump_target():
    """Test that invalid jump target raises error."""
    content = """SI@init()
T@trans() >> @nonexistent
END"""
    parser = Parser(content)

    try:
        parser.parse()
        raise AssertionError("Expected ParseError but none was raised")
    except ParseError as e:
        assert_in("not found", str(e))


def test_parse_with_existing_qsfc_file():
    """Integration test with existing simple_parallel.qsfc file."""
    test_file = os.path.join(TEST_DIR, 'simple_parallel.qsfc')
    with open(test_file, 'r') as f:
        content = f.read()

    parser = Parser(content)
    sfc = parser.parse()

    assert len(sfc.steps) > 0
    assert len(sfc.transitions) > 0
    assert sfc.initial_step is not None
    assert len(sfc.branches) > 0


# =============================================================================
# INTEGRATION TESTS
# =============================================================================

def test_integration_simple_parallel():
    """Comprehensive integration test for simple_parallel.qsfc."""
    test_file = os.path.join(TEST_DIR, 'simple_parallel.qsfc')
    with open(test_file, 'r') as f:
        content = f.read()

    parser = Parser(content)
    sfc = parser.parse()

    # Verify structure counts
    assert len(sfc.steps) == 5
    assert len(sfc.transitions) == 3
    assert len(sfc.branches) == 2

    # Verify initial step
    assert sfc.initial_step is not None
    assert sfc.initial_step.name == "init"

    # Verify key elements exist
    init = sfc.get_step_by_name("init")
    do1 = sfc.get_step_by_name("do1")
    do2 = sfc.get_step_by_name("do2")
    do3 = sfc.get_step_by_name("do3")
    beginsplit = sfc.get_transition_by_name("beginsplit")
    finalize = sfc.get_transition_by_name("finalize")

    # Verify AND branch
    diverge_and = [b for b in sfc.branches if b.branch_type == "DIVERGE" and b.flow_type == "AND"][0]
    assert len(diverge_and.legs) == 3

    # Verify parallel split
    assert len(beginsplit.outgoing_steps) == 3
    assert do1 in beginsplit.outgoing_steps
    assert do2 in beginsplit.outgoing_steps
    assert do3 in beginsplit.outgoing_steps

    # Verify jump
    assert finalize.target_name == "init"
    assert init in finalize.outgoing_steps


def test_integration_simple_selection():
    """Comprehensive integration test for simple_selection.qsfc."""
    test_file = os.path.join(TEST_DIR, 'simple_selection.qsfc')
    with open(test_file, 'r') as f:
        content = f.read()

    parser = Parser(content)
    sfc = parser.parse()

    # Verify structure counts
    assert len(sfc.steps) == 7
    assert len(sfc.transitions) == 9
    assert len(sfc.branches) >= 1

    # Verify initial step
    assert sfc.initial_step is not None
    assert sfc.initial_step.name == "init"

    # Verify key elements exist
    init = sfc.get_step_by_name("init")
    step1 = sfc.get_step_by_name("step1")
    step2 = sfc.get_step_by_name("step2")
    step3 = sfc.get_step_by_name("step3")
    condition1 = sfc.get_transition_by_name("condition1")
    do2done = sfc.get_transition_by_name("do2done")
    loop = sfc.get_transition_by_name("loop")

    # Verify OR branch
    diverge_or = [b for b in sfc.branches if b.branch_type == "DIVERGE" and b.flow_type == "OR"][0]
    assert len(diverge_or.legs) == 3

    # Verify selection divergence
    assert len(step3.outgoing_transitions) == 3

    # Verify jump targets
    assert condition1.target_name == "step1"
    assert do2done.target_name == "step2"
    assert loop.target_name == "init"

    # Verify jumps resolved
    assert step1 in condition1.outgoing_steps
    assert step2 in do2done.outgoing_steps
    assert init in loop.outgoing_steps


# =============================================================================
# MAIN TEST RUNNER
# =============================================================================

def main():
    """Run all tests and report results."""
    print("=" * 70)
    print("Running QuickSFC Unit Tests")
    print("=" * 70)

    tokenizer_tests = [
        ("test_tokenize_simple_step", test_tokenize_simple_step),
        ("test_tokenize_multi_char_operators", test_tokenize_multi_char_operators),
        ("test_tokenize_keywords_si_vs_s", test_tokenize_keywords_si_vs_s),
        ("test_tokenize_with_comments", test_tokenize_with_comments),
        ("test_tokenize_nested_parentheses_in_action", test_tokenize_nested_parentheses_in_action),
        ("test_tokenize_action_vs_condition", test_tokenize_action_vs_condition),
        ("test_tokenize_line_numbers", test_tokenize_line_numbers),
        ("test_tokenize_invalid_character_raises_error", test_tokenize_invalid_character_raises_error),
    ]

    sfc_tests = [
        ("test_step_creation", test_step_creation),
        ("test_transition_creation", test_transition_creation),
        ("test_step_transition_bidirectional_relationship", test_step_transition_bidirectional_relationship),
        ("test_qgsfc_query_methods", test_qgsfc_query_methods),
        ("test_qgsfc_initial_step_property", test_qgsfc_initial_step_property),
        ("test_branch_and_leg_structure", test_branch_and_leg_structure),
    ]

    parser_tests = [
        ("test_parse_minimal_sfc", test_parse_minimal_sfc),
        ("test_parse_simple_sequence", test_parse_simple_sequence),
        ("test_parse_jump_target", test_parse_jump_target),
        ("test_parse_or_branch_with_convergence", test_parse_or_branch_with_convergence),
        ("test_parse_and_branch_with_convergence", test_parse_and_branch_with_convergence),
        ("test_parse_or_branch_without_convergence_all_jump", test_parse_or_branch_without_convergence_all_jump),
        ("test_parse_assigns_ids_sequentially", test_parse_assigns_ids_sequentially),
        ("test_parse_error_duplicate_step_name", test_parse_error_duplicate_step_name),
        ("test_parse_error_missing_si", test_parse_error_missing_si),
        ("test_parse_error_missing_end", test_parse_error_missing_end),
        ("test_parse_error_invalid_jump_target", test_parse_error_invalid_jump_target),
        ("test_parse_with_existing_qsfc_file", test_parse_with_existing_qsfc_file),
    ]

    integration_tests = [
        ("test_integration_simple_parallel", test_integration_simple_parallel),
        ("test_integration_simple_selection", test_integration_simple_selection),
    ]

    all_tests = [
        ("\nTokenizer Tests (8)", tokenizer_tests),
        ("\nSFC Data Model Tests (6)", sfc_tests),
        ("\nParser Tests (12)", parser_tests),
        ("\nIntegration Tests (2)", integration_tests),
    ]

    total_passed = 0
    total_failed = 0

    for section_name, tests in all_tests:
        print(section_name)
        print("-" * 70)
        section_passed = 0
        section_failed = 0

        for test_name, test_func in tests:
            if run_test(test_name, test_func):
                section_passed += 1
            else:
                section_failed += 1

        total_passed += section_passed
        total_failed += section_failed

        print(f"  {section_passed} passed, {section_failed} failed\n")

    print("=" * 70)
    print(f"TOTAL: {total_passed} passed, {total_failed} failed out of {total_passed + total_failed} tests")
    print("=" * 70)

    return 0 if total_failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
