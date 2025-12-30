"""Unit tests for qg_sfc.py"""

import os
import sys
import pytest

# Add parent directory to path for imports
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
QUICKSFC_DIR = os.path.dirname(TEST_DIR)
WORKSPACE_DIR = os.path.dirname(QUICKSFC_DIR)
sys.path.insert(0, WORKSPACE_DIR)

from QuickSFC.qg_sfc import QStep, QTransition, QSFC, QBranch, QLeg


class TestDataModelBasics:
    """Test basic data model object creation."""

    def test_step_creation(self):
        """Test QGStep creation and attributes."""
        step = QStep("init", "x:=0", preset=100, is_initial=True, line_number=1)

        assert step.name == "init"
        assert step.action == "x:=0"
        assert step.preset == 100
        assert step.is_initial == True
        assert step.line_number == 1
        assert step.id is None  # Set by parser
        assert step.operand is None  # Set by parser

    def test_transition_creation(self):
        """Test QGTransition creation and attributes."""
        trans = QTransition("start", "button_pressed", target_name="running", line_number=2)

        assert trans.name == "start"
        assert trans.condition == "button_pressed"
        assert trans.target_name == "running"
        assert trans.line_number == 2


class TestDataModelRelationships:
    """Test bidirectional relationships and queries."""

    def test_step_transition_bidirectional_relationship(self):
        """Test bidirectional linking between steps and transitions."""
        step1 = QStep("step1", "action1")
        trans = QTransition("trans", "condition")
        step2 = QStep("step2", "action2")

        # Link: step1 -> trans -> step2
        step1.add_outgoing_transition(trans)
        trans.add_incoming_step(step1)
        trans.add_outgoing_step(step2)
        step2.add_incoming_transition(trans)

        # Verify bidirectional relationships
        assert trans in step1.outgoing_transitions
        assert step1 in trans.incoming_steps
        assert step2 in trans.outgoing_steps
        assert trans in step2.incoming_transitions

    def test_qgsfc_query_methods(self):
        """Test QGSFC query methods (by name, id, operand)."""
        step1 = QStep("init", "x:=0", is_initial=True)
        step1.id = 0
        step1.operand = 0

        step2 = QStep("running", "x:=x+1")
        step2.id = 2
        step2.operand = 1

        trans = QTransition("start", "button")
        trans.id = 1
        trans.operand = 0

        sfc = QSFC([step1, step2], [trans])

        # Test query by name
        assert sfc.get_step_by_name("init") == step1
        assert sfc.get_step_by_name("running") == step2
        assert sfc.get_transition_by_name("start") == trans

        # Test query by id
        assert sfc.get_step(0) == step1
        assert sfc.get_step(2) == step2
        assert sfc.get_transition(1) == trans

        # Test query by operand
        assert sfc.get_step_by_operand(0) == step1
        assert sfc.get_step_by_operand(1) == step2
        assert sfc.get_transition_by_operand(0) == trans

    def test_qgsfc_initial_step_property(self):
        """Test QGSFC can identify initial step."""
        step1 = QStep("init", "x:=0", is_initial=True)
        step1.operand = 0
        step2 = QStep("running", "x:=x+1")
        step2.operand = 1

        sfc = QSFC([step1, step2], [])

        assert sfc.initial_step == step1

    def test_branch_and_leg_structure(self):
        """Test QGBranch and QGLeg structure."""
        branch = QBranch("DIVERGE", "OR", line_number=5)
        branch.id = 10

        leg1 = QLeg()
        leg1.id = 11
        step1 = QStep("leg1_step", "a")
        leg1.add_step(step1)

        leg2 = QLeg()
        leg2.id = 12
        step2 = QStep("leg2_step", "b")
        leg2.add_step(step2)

        branch.add_leg(leg1)
        branch.add_leg(leg2)

        assert len(branch.legs) == 2
        assert branch.branch_type == "DIVERGE"
        assert branch.flow_type == "OR"

