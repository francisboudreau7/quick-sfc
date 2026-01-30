"""Unit tests for qg_parser.py"""

import os
import sys
import pytest

# Add parent directory to path for imports
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
QUICKSFC_DIR = os.path.dirname(TEST_DIR)
WORKSPACE_DIR = os.path.dirname(QUICKSFC_DIR)
sys.path.insert(0, WORKSPACE_DIR)

from QuickSFC.parser import Parser
from QuickSFC.errors import ParseError


class TestParserBasics:
    """Test basic parsing functionality."""

    def test_parse_minimal_sfc(self):
        """Test parsing minimal valid SFC."""
        content = """SI@init()
END"""
        parser = Parser(content)
        sfc = parser.parse()

        assert len(sfc.steps) == 1
        assert sfc.steps[0].name == "init"
        assert sfc.steps[0].is_initial == True
        assert len(sfc.transitions) == 0

    def test_parse_simple_sequence(self):
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

        # Verify relationships
        assert start in init.outgoing_transitions
        assert init in start.incoming_steps
        assert running in start.outgoing_steps
        assert start in running.incoming_transitions

        # Verify attributes
        assert init.is_initial == True
        assert running.preset == 100

    def test_parse_jump_target(self):
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


class TestParserBranches:
    """Test branch parsing (OR and AND)."""

    def test_parse_or_branch_with_convergence(self):
        """Test parsing OR branch (selection) with convergence."""
        content = """SI@init()
T@decide()
S@choice()
/\\
    T@opt1() -> S@step1()
    |
    T@opt2() -> S@step2()
\\/ S@merge()
END"""
        parser = Parser(content)
        sfc = parser.parse()

        assert len(sfc.branches) == 2  # diverge + converge
        diverge = [b for b in sfc.branches if b.branch_type == "DIVERGE"][0]
        converge = [b for b in sfc.branches if b.branch_type == "CONVERGE"][0]

        assert diverge.flow_type == "OR"
        assert len(diverge.legs) == 2
        assert converge.flow_type == "OR"

    def test_parse_and_branch_with_convergence(self):
        """Test parsing AND branch (parallel) with convergence."""
        content = """SI@init()
T@split()
//\\\\
    S@leg1()
    |
    S@leg2()
\\\\// T@join()
END"""
        parser = Parser(content)
        sfc = parser.parse()

        assert len(sfc.branches) == 2
        diverge = [b for b in sfc.branches if b.branch_type == "DIVERGE"][0]
        converge = [b for b in sfc.branches if b.branch_type == "CONVERGE"][0]

        assert diverge.flow_type == "AND"
        assert len(diverge.legs) == 2
        assert converge.flow_type == "AND"

    def test_parse_or_branch_without_convergence_all_jump(self):
        """Test OR branch without convergence is valid if all legs jump."""
        content = """SI@init()
S@choice()
/\\
    T@opt1() >> @init
    |
    T@opt2() >> @init
END"""
        parser = Parser(content)
        sfc = parser.parse()

        # Should parse without errors
        assert len(sfc.branches) == 1
        assert sfc.branches[0].flow_type == "OR"


class TestParserIDAssignment:
    """Test ID and operand assignment."""

    def test_parse_assigns_ids_sequentially(self):
        """Test that parser assigns sequential IDs."""
        content = """SI@init()
T@trans1()
S@step1()
T@trans2()
END"""
        parser = Parser(content)
        sfc = parser.parse()

        # IDs should be sequential starting from 0
        all_elements = sfc.steps + sfc.transitions
        ids = sorted([e.id for e in all_elements])
        assert ids == list(range(len(all_elements)))

        # Operands should be sequential within type
        step_operands = sorted([s.operand for s in sfc.steps])
        trans_operands = sorted([t.operand for t in sfc.transitions])
        assert step_operands == list(range(len(sfc.steps)))
        assert trans_operands == list(range(len(sfc.transitions)))


class TestParserErrors:
    """Test parser error handling."""

    def test_parse_error_duplicate_step_name(self):
        """Test that duplicate step names raise error."""
        content = """SI@init()
S@step1()
S@step1()
END"""
        parser = Parser(content)

        with pytest.raises(ParseError) as exc_info:
            parser.parse()

        assert "Duplicate step name" in str(exc_info.value)

    def test_parse_error_missing_si(self):
        """Test that missing SI raises error."""
        content = """S@step1()
END"""
        parser = Parser(content)

        with pytest.raises(ParseError) as exc_info:
            parser.parse()

        assert "First line must be SI" in str(exc_info.value) or "No initial step" in str(exc_info.value)

    def test_parse_error_missing_end(self):
        """Test that missing END raises error."""
        content = """SI@init()"""
        parser = Parser(content)

        with pytest.raises(ParseError) as exc_info:
            parser.parse()

        assert "Missing END marker" in str(exc_info.value)

    def test_parse_error_invalid_jump_target(self):
        """Test that invalid jump target raises error."""
        content = """SI@init()
T@trans() >> @nonexistent
END"""
        parser = Parser(content)

        with pytest.raises(ParseError) as exc_info:
            parser.parse()

        assert "not found" in str(exc_info.value)


class TestParserIntegration:
    """Integration tests with existing .qsfc files."""

    def test_parse_with_existing_qsfc_file(self):
        """Integration test with existing simple_parallel.qsfc file."""
        test_file = os.path.join(TEST_DIR, 'simple_parallel.qsfc')
        with open(test_file, 'r') as f:
            content = f.read()

        parser = Parser(content)
        sfc = parser.parse()

        # Basic sanity checks
        assert len(sfc.steps) > 0
        assert len(sfc.transitions) > 0
        assert sfc.initial_step is not None
        assert len(sfc.branches) > 0  # This file has parallel branches
