"""Quick Grafcet SFC object model.

This module provides classes for representing Sequential Function Charts
parsed from Quick Grafcet (.qg) files.
"""
from typing import List


class QGStep:
    """Represents a step in Quick SFC.

    A step has a name, an action (structured text), optional timer preset,
    and maintains bidirectional relationships with incoming and
    outgoing transitions.

    Attributes:
        name: Identifier name (e.g., "init", "running") - mandatory
        id: Line number from .qg file (1-indexed)
        operand: Sequential numbering (0, 1, 2, ...)
        action: Structured text action string (e.g., "T:=2;")
        preset: Timer preset in milliseconds (default 0)
        is_initial: True if this is the initial step (SI), False for regular steps (S)
        line_number: 1-indexed line number from .qg file (same as id)
    """

    def __init__(self, name: str, action: str, preset: int = 0,
                 line_number: int = None, comments:List = None, is_initial: bool = False):
        self.name = name  # Mandatory identifier
        self.id = None  # Global ID - assigned by parser
        self.operand = None  # Sequential ID - assigned by parser
        self.action = action
        self.preset = preset
        self.is_initial = is_initial
        self.line_number = line_number
        self.comments = comments

        # L5X export attributes (set by parser)
        self.x = None  # X coordinate for visual layout
        self.y = None  # Y coordinate for visual layout

        # Bidirectional relationships (private)
        self._incoming_transitions = []
        self._outgoing_transitions = []

    @property
    def incoming_transitions(self):
        """Return list of Transition objects incoming to this Step."""
        return list(self._incoming_transitions)

    @property
    def outgoing_transitions(self):
        """Return list of Transition objects outgoing from this Step."""
        return list(self._outgoing_transitions)

    def add_incoming_transition(self, transition):
        """Add an incoming transition (called by parser).

        Args:
            transition: QGTransition object to add
        """
        if transition not in self._incoming_transitions:
            self._incoming_transitions.append(transition)

    def add_outgoing_transition(self, transition):
        """Add an outgoing transition (called by parser).

        Args:
            transition: QGTransition object to add
        """
        if transition not in self._outgoing_transitions:
            self._outgoing_transitions.append(transition)

    def __repr__(self):
        initial = "SI" if self.is_initial else "S"
        return f"{initial}@{self.name}(operand={self.operand}, id={self.id}, action={self.action!r}, preset={self.preset}ms)"


class QGTransition:
    """Represents a transition in Quick SFC.

    A transition has a name, a condition (boolean expression), and connects
    two steps (from_step and to_step).

    Attributes:
        name: Identifier name (e.g., "start", "timeout") - mandatory
        id: Line number from .qg file (1-indexed)
        operand: Sequential numbering (0, 1, 2, ...)
        condition: Boolean expression string (e.g., "a", "b", "Step_001.DN")
        target_name: Optional explicit target step name (for >> jumps)
        line_number: 1-indexed line number from .qg file (same as id)
    """

    def __init__(self, name: str, condition: str, target_name: str = None,
                 line_number: int = None, comment:str =None):
        self.name = name  # Mandatory identifier
        self.id = None  # Global ID - assigned by parser
        self.operand = None  # Sequential ID - assigned by parser
        self.condition = condition
        self.target_name = target_name  # For >> jumps
        self.line_number = line_number
        self.comment = comment

        # L5X export attributes (set by parser)
        self.x = None  # X coordinate for visual layout
        self.y = None  # Y coordinate for visual layout

        # Bidirectional relationships (private)
        self._incoming_steps = []
        self._outgoing_steps = []

    @property
    def incoming_steps(self):
        """Return a list of incoming Step objects."""
        return self._incoming_steps

    @property
    def outgoing_steps(self):
        """Return a list of outgoing Step objects."""
        return self._outgoing_steps

    def add_incoming_step(self, step):
        """add step to incoming steps

        Args:
            step: QGStep object
        """
        self._incoming_steps.append(step)

    def add_outgoing_step(self, step):
        """add step to outgoing steps

        Args:
            step: QGStep object
        """
        self._outgoing_steps.append(step)

    def __repr__(self):
        target = f"->@{self.target_name}" if self.target_name else "->next"
        return f"T@{self.name}(operand={self.operand}, id={self.id}, condition={self.condition!r}, {target})"


class QGBranch():
    """Represents a branch (divergence or convergence) in Quick SFC.

    Attributes:
        id: Global sequential ID (set by parser)
        branch_type: "DIVERGE" or "CONVERGE"
        flow_type: "AND" or "OR"
        x: X coordinate for visual layout
        y: Y coordinate for visual layout
        legs: List of QGLeg objects (for divergence branches)
        name: Optional identifier
        line_number: Line number where branch starts
    """

    def __init__(self, branch_type: str, flow_type: str, line_number: int = None):
        self.id = None  # Global ID - assigned by parser
        self.branch_type = branch_type  # "DIVERGE" or "CONVERGE"
        self.flow_type = flow_type      # "AND" or "OR"
        self.x = None  # X coordinate for L5X export
        self.y = None  # Y coordinate for L5X export
        self.legs :List[QGLeg] = []                    # List[QGLeg]
        self.name = None
        self.line_number = line_number  
        self.root = None

        

    def add_leg(self, leg):
        """Add a leg to this branch."""
        self.legs.append(leg)

    @property
    def branch_type_l5x(self):
        """Return L5X-compatible branch type: 'Selection' or 'Parallel'."""
        return "Parallel" if self.flow_type == "AND" else "Selection"

    @property
    def branch_flow_l5x(self):
        """Return L5X-compatible flow direction: 'Diverge' or 'Converge'."""
        return self.branch_type.capitalize()  # "DIVERGE" -> "Diverge"

    @property
    def priority(self):
        """Return L5X priority (always 'Default')."""
        return "Default"
    
    @property
    def elements_in_branch(self):
        branch_elements = []
        for leg in self.legs:
           branch_elements += leg.elements
        return branch_elements

        
    def get_root(self) -> QGStep | QGTransition:
        return self.root

    def __repr__(self):
        flow_sym = "//\\\\" if self.flow_type == "AND" else "/\\"
        return f"Branch(id={self.id}, {self.branch_type}, {flow_sym}, {len(self.legs)} legs)"


class QGLeg:
    """Represents a single leg (path) in a parallel or selection branch.

    Attributes:
        id: Global sequential ID (set by parser)
        steps: List of QGStep objects in this leg
        transitions: List of QGTransition objects in this leg
    """

    def __init__(self):
        self.id = None  # Global ID - assigned by parser
        self.steps = []
        self.transitions = []

    @property
    def elements(self) -> List[QGStep|QGBranch]:
        return self.steps + self.transitions

    def elements_sorted_by_line_number(self):
        return sorted(self.elements,key=lambda x: x.line_number)
    
    def add_step(self, step):
        """Add a step to this leg."""
        self.steps.append(step)

    def add_transition(self, transition):
        """Add a transition to this leg."""
        self.transitions.append(transition)
    

    def __repr__(self):
        return f"Leg(id={self.id}, {len(self.steps)} steps, {len(self.transitions)} transitions)"
    


class QGDirectedLink:
    """Represents a directed connection between SFC elements for L5X export.

    DirectedLinks are auto-generated during parsing to represent all
    connections in the SFC graph structure.

    Attributes:
        from_id: ID of source object (Step, Transition, or Branch)
        to_id: ID of target object
        show: Visibility flag for L5X export (default True)
    """

    def __init__(self, from_id: int, to_id: int, show: bool = True):
        self.from_id = from_id
        self.to_id = to_id
        self.show = show

    def __repr__(self):
        return f"DirectedLink(from={self.from_id}, to={self.to_id}, show={self.show})"


class QGSFC:
    """Container for a parsed Quick Grafcet SFC.

    Provides access to steps, transitions, and their relationships.
    """

    def __init__(self, steps: list, transitions: list, branches: list = None,
                 directed_links: list = None):
        """Initialize QGSFC with lists of steps, transitions, branches, and links.

        Args:
            steps: List of QGStep objects
            transitions: List of QGTransition objects
            branches: Optional list of QGBranch objects
            directed_links: Optional list of QGDirectedLink objects
        """
        # Triple indexing for flexibility (by name, id, operand)
        self._steps_by_name = {step.name: step for step in steps}
        self._steps_by_id = {step.id: step for step in steps}
        self._steps_by_operand = {step.operand: step for step in steps}
        self._transitions_by_name = {trans.name: trans for trans in transitions}
        self._transitions_by_id = {trans.id: trans for trans in transitions}
        self._transitions_by_operand = {trans.operand: trans for trans in transitions}
        self.branches = branches or []
        self.directed_links = directed_links or []

    @property
    def steps(self):
        """Return list of all Step objects."""
        return list(self._steps_by_operand.values())

    @property
    def transitions(self):
        """Return list of all Transition objects."""
        return list(self._transitions_by_operand.values())

    @property
    def links(self):
        """Return list of all DirectedLink objects."""
        return list(self.directed_links)

    @property
    def initial_step(self):
        """Return the initial step (SI)."""
        for step in self._steps_by_operand.values():
            if step.is_initial:
                return step
        return None
    
    def get_node_by_id(self,id:int) -> QGStep | QGTransition:
        return self._transitions_by_id | self._steps_by_id

    def get_step_by_name(self, name: str):
        """Get step by name.

        Args:
            name: Step name (without @ prefix)

        Returns:
            QGStep object or None if not found
        """
        return self._steps_by_name.get(name)

    def get_step(self, id_: int):
        """Get step by line number ID.

        Args:
            id_: Step line number ID (1-indexed)

        Returns:
            QGStep object or None if not found
        """
        return self._steps_by_id.get(id_)

    def get_step_by_operand(self, operand: int):
        """Get step by sequential operand.

        Args:
            operand: Sequential operand (0, 1, 2, ...)

        Returns:
            QGStep object or None if not found
        """
        return self._steps_by_operand.get(operand)

    def get_transition_by_name(self, name: str):
        """Get transition by name.

        Args:
            name: Transition name (without @ prefix)

        Returns:
            QGTransition object or None if not found
        """
        return self._transitions_by_name.get(name)

    def get_transition(self, id_: int):
        """Get transition by line number ID.

        Args:
            id_: Transition line number ID (1-indexed)

        Returns:
            QGTransition object or None if not found
        """
        return self._transitions_by_id.get(id_)

    def get_transition_by_operand(self, operand: int):
        """Get transition by sequential operand.

        Args:
            operand: Sequential operand (0, 1, 2, ...)

        Returns:
            QGTransition object or None if not found
        """
        return self._transitions_by_operand.get(operand)

    def get_links_from(self, from_id: int):
        """Get all DirectedLinks originating from given ID.

        Args:
            from_id: Source object ID

        Returns:
            List of QGDirectedLink objects
        """
        return [link for link in self.directed_links if link.from_id == from_id]

    def get_links_to(self, to_id: int):
        """Get all DirectedLinks targeting given ID.

        Args:
            to_id: Target object ID

        Returns:
            List of QGDirectedLink objects
        """
        return [link for link in self.directed_links if link.to_id == to_id]

    def get_step_by_line(self, line_number: int):
        """Get step by line number in .qg file.

        This is an alias for get_step() for backwards compatibility.

        Args:
            line_number: 1-indexed line number

        Returns:
            QGStep object or None if not found
        """
        return self.get_step(line_number)

    def print_summary(self):
        """Print a human-readable summary of the SFC."""
        print("\n" + "=" * 70)
        print("Quick Grafcet SFC Summary")
        print("=" * 70 + "\n")

        print(f"STEPS: {len(self.steps)}")
        print("-" * 70)
        print(f"{'Name':<12} {'Type':<4} {'Action':<30} {'Preset':<10}")
        print("-" * 70)
        for step in sorted(self.steps, key=lambda s: s.operand):
            stype = "SI" if step.is_initial else "S"
            action_str = step.action[:27] + "..." if len(step.action) > 30 else step.action
            print(f"@{step.name:<11} {stype:<4} "
                  f"{action_str:<30} {step.preset}ms")

        print(f"\nTRANSITIONS: {len(self.transitions)}")
        print("-" * 70)
        print(f"{'Name':<12} {'From':<12} {'To':<12} {'Condition':<20}")
        print("-" * 70)
        for trans in sorted(self.transitions, key=lambda t: t.operand):
            from_name = f"@{trans.from_step.name}" if trans.from_step else "?"
            to_name = f"@{trans.to_step.name}" if trans.to_step else "?"
            cond_str = trans.condition[:17] + "..." if len(trans.condition) > 20 else trans.condition
            print(f"@{trans.name:<11} "
                  f"{from_name:<12} {to_name:<12} {cond_str:<20}")

        if self.branches:
            print(f"\nBRANCHES: {len(self.branches)}")
            print("-" * 70)
            for branch in self.branches:
                print(f"{branch}")

        print("\n" + "=" * 70 + "\n")
