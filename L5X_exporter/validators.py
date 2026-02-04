"""Pre-export validation for L5X generation."""

import re
from typing import List


class L5XExportError(Exception):
    """Error raised during L5X export."""

    def __init__(self, message: str, errors: List[str] = None):
        self.message = message
        self.errors = errors or []
        super().__init__(self.message)

    def __str__(self):
        if self.errors:
            return f"{self.message}:\n" + "\n".join(f"  - {e}" for e in self.errors)
        return self.message


class L5XValidator:
    """Validates SFC before export to L5X format."""

    # Valid L5X identifier pattern (alphanumeric and underscore, starts with letter or underscore)
    VALID_NAME_PATTERN = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
    MAX_NAME_LENGTH = 40

    def __init__(self, sfc):
        """Initialize validator with SFC object.

        Args:
            sfc: Parsed SFC object to validate
        """
        self.sfc = sfc
        self.errors = []

    def validate(self) -> bool:
        """Run all validation checks.

        Returns:
            True if validation passes, False otherwise

        Raises:
            L5XExportError: If validation fails
        """
        self.errors = []

        self._check_initial_step()
        self._check_step_connectivity()
        self._check_transition_connectivity()
        self._check_jump_targets()
        self._check_branch_structure()

        if self.errors:
            raise L5XExportError("SFC validation failed", self.errors)

        return True

    def _check_initial_step(self):
        """Check that exactly one initial step exists."""
        if self.sfc.initial_step is None:
            self.errors.append("No initial step (SI) found in SFC")

    def _check_step_connectivity(self):
        """Check all steps have at least one transition connection."""
        for step in self.sfc.steps:
            # Initial step may not have incoming transitions
            if not step.is_initial and not step.incoming_transitions:
                self.errors.append(
                    f"Step '@{step.name}' has no incoming transitions"
                )
            # All steps should have outgoing transitions (except in special cases)
            # This is optional - some steps may be terminal

    def _check_transition_connectivity(self):
        """Check all transitions have proper step connections."""
        for trans in self.sfc.transitions:
            if not trans.incoming_steps:
                self.errors.append(
                    f"Transition '@{trans.name}' has no incoming step"
                )
            if not trans.outgoing_steps:
                self.errors.append(
                    f"Transition '@{trans.name}' has no outgoing step"
                )

    def _check_jump_targets(self):
        """Check all jump targets reference existing steps."""
        for trans in self.sfc.transitions:
            if trans.target_name:
                target = self.sfc.get_step_by_name(trans.target_name)
                if target is None:
                    self.errors.append(
                        f"Transition '@{trans.name}' jumps to unknown step '@{trans.target_name}'"
                    )

    def _check_branch_structure(self):
        """Check branch diverge/converge are properly matched."""
        diverge_count = 0
        converge_count = 0

        for branch in self.sfc.branches:
            if branch.branch_type == "DIVERGE":
                diverge_count += 1
                if len(branch.legs) < 2:
                    self.errors.append(
                        f"Branch (id={branch.id}) has fewer than 2 legs"
                    )
            elif branch.branch_type == "CONVERGE":
                converge_count += 1

        # Note: In some cases with jumps, converge may not be needed
        # so we don't strictly require matching counts
