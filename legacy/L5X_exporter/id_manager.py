"""ID allocation and operand name generation for L5X export."""

from typing import Dict, Any


class IDManager:
    """Manages ID allocation and operand naming for L5X elements.

    Generates sequential IDs for steps, transitions, actions, branches, and legs.
    Produces operand names like Step_000, Tran_000, Action_000.
    """

    def __init__(self):
        """Initialize ID manager with empty state."""
        self._global_id = 0
        self._step_count = 0
        self._transition_count = 0
        self._action_count = 0
        self._branch_count = 0
        self._leg_count = 0

        # Maps from source object to L5X ID
        self._step_ids: Dict[Any, int] = {}
        self._transition_ids: Dict[Any, int] = {}
        self._action_ids: Dict[Any, int] = {}
        self._branch_ids: Dict[Any, int] = {}
        self._leg_ids: Dict[Any, int] = {}

        # Maps from source object to operand name
        self._step_operands: Dict[Any, str] = {}
        self._transition_operands: Dict[Any, str] = {}
        self._action_operands: Dict[Any, str] = {}

    def next_id(self) -> int:
        """Get next global ID and increment counter.

        Returns:
            Next sequential ID
        """
        current = self._global_id
        self._global_id += 1
        return current

    def allocate_step_id(self, step) -> int:
        """Allocate ID for a step.

        Args:
            step: Step object from SFC

        Returns:
            Allocated ID for this step
        """
        if step in self._step_ids:
            return self._step_ids[step]

        step_id = self.next_id()
        self._step_ids[step] = step_id

        operand = f"Step_{self._step_count:03d}"
        self._step_operands[step] = operand
        self._step_count += 1

        return step_id

    def allocate_action_id(self, step) -> int:
        """Allocate ID for an action (associated with a step).

        Args:
            step: Step object that owns this action

        Returns:
            Allocated ID for this action
        """
        if step in self._action_ids:
            return self._action_ids[step]

        action_id = self.next_id()
        self._action_ids[step] = action_id

        operand = f"Action_{self._action_count:03d}"
        self._action_operands[step] = operand
        self._action_count += 1

        return action_id

    def allocate_transition_id(self, transition) -> int:
        """Allocate ID for a transition.

        Args:
            transition: Transition object from SFC

        Returns:
            Allocated ID for this transition
        """
        if transition in self._transition_ids:
            return self._transition_ids[transition]

        trans_id = self.next_id()
        self._transition_ids[transition] = trans_id

        operand = f"Tran_{self._transition_count:03d}"
        self._transition_operands[transition] = operand
        self._transition_count += 1

        return trans_id

    def allocate_branch_id(self, branch) -> int:
        """Allocate ID for a branch.

        Args:
            branch: Branch object from SFC

        Returns:
            Allocated ID for this branch
        """
        if branch in self._branch_ids:
            return self._branch_ids[branch]

        branch_id = self.next_id()
        self._branch_ids[branch] = branch_id
        self._branch_count += 1

        return branch_id

    def allocate_leg_id(self, leg) -> int:
        """Allocate ID for a leg.

        Args:
            leg: Leg object from branch

        Returns:
            Allocated ID for this leg
        """
        if leg in self._leg_ids:
            return self._leg_ids[leg]

        leg_id = self.next_id()
        self._leg_ids[leg] = leg_id
        self._leg_count += 1

        return leg_id

    def get_step_id(self, step) -> int:
        """Get allocated ID for step.

        Args:
            step: Step object

        Returns:
            Allocated ID or None if not allocated
        """
        return self._step_ids.get(step)

    def get_step_operand(self, step) -> str:
        """Get operand name for step.

        Args:
            step: Step object

        Returns:
            Operand name (e.g., "Step_000") or None
        """
        return self._step_operands.get(step)

    def get_transition_id(self, transition) -> int:
        """Get allocated ID for transition.

        Args:
            transition: Transition object

        Returns:
            Allocated ID or None if not allocated
        """
        return self._transition_ids.get(transition)

    def get_transition_operand(self, transition) -> str:
        """Get operand name for transition.

        Args:
            transition: Transition object

        Returns:
            Operand name (e.g., "Tran_000") or None
        """
        return self._transition_operands.get(transition)

    def get_action_id(self, step) -> int:
        """Get allocated action ID for step.

        Args:
            step: Step object that owns the action

        Returns:
            Allocated ID or None if not allocated
        """
        return self._action_ids.get(step)

    def get_action_operand(self, step) -> str:
        """Get operand name for action.

        Args:
            step: Step object that owns the action

        Returns:
            Operand name (e.g., "Action_000") or None
        """
        return self._action_operands.get(step)

    def get_branch_id(self, branch) -> int:
        """Get allocated ID for branch.

        Args:
            branch: Branch object

        Returns:
            Allocated ID or None if not allocated
        """
        return self._branch_ids.get(branch)

    def get_leg_id(self, leg) -> int:
        """Get allocated ID for leg.

        Args:
            leg: Leg object

        Returns:
            Allocated ID or None if not allocated
        """
        return self._leg_ids.get(leg)
