"""Layout calculation for L5X export.

Calculates X,Y coordinates for steps, transitions, and branches.
"""

from typing import Dict, Tuple, Any, List
from .constants import (
    INITIAL_X, INITIAL_Y, STEP_HEIGHT, TRANSITION_HEIGHT,
    BRANCH_OFFSET_X, LEG_SPACING
)


class LayoutCalculator:
    """Calculates X,Y positions for SFC elements in L5X format.

    Uses simple linear layout with horizontal offsets for branches.
    Y increases downward, X is centered with branch legs offset.
    """

    def __init__(self, sfc, id_manager):
        """Initialize layout calculator.

        Args:
            sfc: Parsed SFC object
            id_manager: IDManager instance with allocated IDs
        """
        self.sfc = sfc
        self.id_manager = id_manager

        # Position maps: element -> (x, y)
        self._step_positions: Dict[Any, Tuple[int, int]] = {}
        self._transition_positions: Dict[Any, Tuple[int, int]] = {}
        self._branch_positions: Dict[Any, int] = {}  # branch -> y only

        # Current position state
        self._current_x = INITIAL_X
        self._current_y = INITIAL_Y

    def calculate(self):
        """Calculate positions for all elements.

        Performs a traversal from initial step, following the flow.
        """
        if self.sfc.initial_step is None:
            return

        # Track visited elements to handle loops
        visited_steps = set()
        visited_transitions = set()

        # Build branch lookup for faster access
        self._diverge_branches = {}  # root element -> diverge branch
        self._converge_branches = {}  # root element -> converge branch

        for branch in self.sfc.branches:
            if branch.branch_type == "DIVERGE" and branch.root:
                self._diverge_branches[branch.root] = branch
            elif branch.branch_type == "CONVERGE" and branch.root:
                self._converge_branches[branch.root] = branch

        # Start layout from initial step
        self._layout_from_step(
            self.sfc.initial_step,
            INITIAL_X,
            INITIAL_Y,
            visited_steps,
            visited_transitions
        )

    def _layout_from_step(self, step, x: int, y: int,
                          visited_steps: set, visited_transitions: set):
        """Layout starting from a step.

        Args:
            step: Starting step
            x: X position for this step
            y: Y position for this step
            visited_steps: Set of already visited steps
            visited_transitions: Set of already visited transitions
        """
        if step in visited_steps:
            return y

        visited_steps.add(step)
        self._step_positions[step] = (x, y)
        current_y = y + STEP_HEIGHT

        # Check if this step is followed by a diverge branch
        if step in self._diverge_branches:
            diverge_branch = self._diverge_branches[step]
            current_y = self._layout_diverge_branch(
                diverge_branch, x, current_y,
                visited_steps, visited_transitions
            )
        else:
            # Process outgoing transitions linearly
            for trans in step.outgoing_transitions:
                if trans not in visited_transitions:
                    current_y = self._layout_from_transition(
                        trans, x, current_y,
                        visited_steps, visited_transitions
                    )

        return current_y

    def _layout_from_transition(self, trans, x: int, y: int,
                                 visited_steps: set, visited_transitions: set):
        """Layout starting from a transition.

        Args:
            trans: Starting transition
            x: X position for this transition
            y: Y position for this transition
            visited_steps: Set of already visited steps
            visited_transitions: Set of already visited transitions
        """
        if trans in visited_transitions:
            return y

        visited_transitions.add(trans)
        self._transition_positions[trans] = (x, y)
        current_y = y + TRANSITION_HEIGHT

        # Check if this transition leads to a diverge branch
        if trans in self._diverge_branches:
            diverge_branch = self._diverge_branches[trans]
            current_y = self._layout_diverge_branch(
                diverge_branch, x, current_y,
                visited_steps, visited_transitions
            )
        else:
            # Process outgoing steps
            for step in trans.outgoing_steps:
                if step not in visited_steps:
                    current_y = self._layout_from_step(
                        step, x, current_y,
                        visited_steps, visited_transitions
                    )

        return current_y

    def _layout_diverge_branch(self, branch, x: int, y: int,
                                visited_steps: set, visited_transitions: set):
        """Layout a diverge branch and its legs.

        Args:
            branch: Diverge branch to layout
            x: Center X position
            y: Starting Y position
            visited_steps: Set of already visited steps
            visited_transitions: Set of already visited transitions

        Returns:
            Y position after branch
        """
        self._branch_positions[branch] = y
        branch_y = y

        # Calculate leg offsets
        num_legs = len(branch.legs)
        if num_legs == 0:
            return y + TRANSITION_HEIGHT

        # Center the legs around x
        total_width = (num_legs - 1) * LEG_SPACING
        start_x = x - total_width // 2

        max_leg_y = branch_y + TRANSITION_HEIGHT

        for i, leg in enumerate(branch.legs):
            leg_x = start_x + i * LEG_SPACING
            leg_y = branch_y + TRANSITION_HEIGHT

            # Layout leg content
            leg_end_y = self._layout_leg(
                leg, branch.flow_type, leg_x, leg_y,
                visited_steps, visited_transitions
            )
            max_leg_y = max(max_leg_y, leg_end_y)

        # Look for corresponding converge branch
        converge_y = max_leg_y + TRANSITION_HEIGHT

        # Find converge branch if exists
        for conv_branch in self.sfc.branches:
            if (conv_branch.branch_type == "CONVERGE" and
                conv_branch.flow_type == branch.flow_type):
                # Check if legs match (simplified check)
                if conv_branch.root:
                    self._branch_positions[conv_branch] = converge_y
                    # Layout element after converge
                    if conv_branch.root not in visited_steps and hasattr(conv_branch.root, 'is_initial'):
                        converge_y = self._layout_from_step(
                            conv_branch.root, x, converge_y + TRANSITION_HEIGHT,
                            visited_steps, visited_transitions
                        )
                    elif conv_branch.root not in visited_transitions and hasattr(conv_branch.root, 'condition'):
                        converge_y = self._layout_from_transition(
                            conv_branch.root, x, converge_y + TRANSITION_HEIGHT,
                            visited_steps, visited_transitions
                        )
                    break

        return converge_y

    def _layout_leg(self, leg, flow_type: str, x: int, y: int,
                    visited_steps: set, visited_transitions: set):
        """Layout elements within a leg.

        Args:
            leg: Leg to layout
            flow_type: "AND" or "OR"
            x: X position for this leg
            y: Starting Y position
            visited_steps: Set of already visited steps
            visited_transitions: Set of already visited transitions

        Returns:
            Y position after leg content
        """
        current_y = y

        # Get elements sorted by line number
        elements = leg.elements_sorted_by_line_number()

        for elem in elements:
            if hasattr(elem, 'is_initial'):  # It's a step
                if elem not in visited_steps:
                    visited_steps.add(elem)
                    self._step_positions[elem] = (x, current_y)
                    current_y += STEP_HEIGHT
            elif hasattr(elem, 'condition'):  # It's a transition
                if elem not in visited_transitions:
                    visited_transitions.add(elem)
                    self._transition_positions[elem] = (x, current_y)
                    current_y += TRANSITION_HEIGHT

        return current_y

    def get_step_position(self, step) -> Tuple[int, int]:
        """Get position for a step.

        Args:
            step: Step object

        Returns:
            (x, y) tuple or (INITIAL_X, INITIAL_Y) if not calculated
        """
        return self._step_positions.get(step, (INITIAL_X, INITIAL_Y))

    def get_transition_position(self, trans) -> Tuple[int, int]:
        """Get position for a transition.

        Args:
            trans: Transition object

        Returns:
            (x, y) tuple or (INITIAL_X, INITIAL_Y + STEP_HEIGHT) if not calculated
        """
        return self._transition_positions.get(trans, (INITIAL_X, INITIAL_Y + STEP_HEIGHT))

    def get_branch_y(self, branch) -> int:
        """Get Y position for a branch.

        Args:
            branch: Branch object

        Returns:
            Y position or calculated default
        """
        return self._branch_positions.get(branch, INITIAL_Y + STEP_HEIGHT)
