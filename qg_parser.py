
"""Parser for Quick Grafcet language.

This module provides syntactic and semantic analysis for Quick Grafcet
(.qg) files, building SFC objects from token streams.
"""

from .qg_tokenizer import QGTokenizer, TokenType
from .qg_sfc import QGSFC, QGStep, QGTransition, QGBranch, QGLeg
from .qg_errors import ErrorCollector, ParseError, TokenizeError, ValidationError


class QGParser:
    """Parser for Quick Grafcet language.

    Consumes tokens from the tokenizer and builds SFC objects with
    proper relationships. Collects all errors for batch reporting.
    """

    def __init__(self, content: str):
        """Initialize parser with file content.

        Args:
            content: Full text content of .qg file
        """
        self.content = content
        self.tokenizer = QGTokenizer(content)
        self.tokens = []
        self.current = 0

        # Parsing state
        self.steps = []  # List[QGStep] - ordered by appearance
        self.transitions = []  # List[QGTransition]
        self.branches = []  # List[QGBranch]
        self.name_to_step = {}  # Map: name -> QGStep
        self.name_to_transition = {}  # Map: name -> QGTransition
        self.errors = ErrorCollector()
        self.current_step = None  # Track current step for transition linking

    def parse(self):
        """Parse the .qg file and return QGSFC object.

        Returns:
            QGSFC object containing parsed steps and transitions

        Raises:
            ParseError: If any syntax or semantic errors found
        """
        # Phase 1: Tokenization
        try:
            self.tokens = self.tokenizer.tokenize()
        except TokenizeError as e:
            self.errors.add(e)
            self.errors.raise_if_errors()

        # Phase 2: Syntax validation and object construction
        self._parse_file()

        # Phase 3: Relationship building
        if not self.errors.has_errors():
            self._build_relationships()

        # Phase 4: Validation
        if not self.errors.has_errors():
            self._validate()

        # Raise if any errors collected
        self.errors.raise_if_errors()

        return QGSFC(self.steps, self.transitions, self.branches)

    def _parse_file(self):
        """Parse the entire file: SI ... (S | T)* ... END"""
        # Skip leading newlines
        self._skip_newlines()

        # First meaningful token must be SI
        if not self._check(TokenType.SI):
            self._record_error(
                "First line must be SI() (initial step)",
                self._current_token().line_number if self._current_token() else 1
            )
            # Try to recover by finding SI
            while not self._at_end() and not self._check(TokenType.SI):
                self._advance()

        # Parse statements until END or EOF
        while not self._at_end() and not self._check(TokenType.END):
            self._skip_newlines()

            if self._at_end() or self._check(TokenType.END):
                break

            # Parse SI, S, or T
            if self._check(TokenType.SI):
                self._parse_initial_step()
                # Check if step is followed by divergence operator
                self._skip_newlines()
                if self._check(TokenType.OR_DIVERGE) or self._check(TokenType.AND_DIVERGE):
                    self._parse_branch()
            elif self._check(TokenType.S):
                self._parse_step()
                # Check if step is followed by divergence operator
                self._skip_newlines()
                if self._check(TokenType.OR_DIVERGE) or self._check(TokenType.AND_DIVERGE):
                    self._parse_branch()
            elif self._check(TokenType.T):
                self._parse_transition()
            elif self._check(TokenType.OR_DIVERGE) or self._check(TokenType.AND_DIVERGE):
                self._parse_branch()
            elif self._check(TokenType.LEG_SEPARATOR):
                # Standalone | without branch context - skip
                self._advance()
            else:
                # Unexpected token
                token = self._current_token()
                self._record_error(
                    f"Expected S, SI, T, or END, got {token.type.name}",
                    token.line_number
                )
                self._advance()  # Skip to recover

        # Check for END marker
        self._skip_newlines()
        if not self._check(TokenType.END):
            last_line = self.tokens[-2].line_number if len(self.tokens) >= 2 else 1
            self._record_error(
                "Missing END marker at end of file",
                last_line
            )

    def _parse_initial_step(self):
        """Parse SI@name(ACTION, [PRESET])"""
        line_number = self._current_token().line_number

        # Check if SI already parsed
        if any(step.is_initial for step in self.steps):
            self._record_error(
                "Only one SI@name() (initial step) allowed",
                line_number
            )

        self._advance()  # Consume SI

        # Expect @ symbol
        if not self._expect(TokenType.AT):
            return

        # Expect NAME token
        if not self._check(TokenType.NAME):
            self._record_error(
                f"Expected name after @, got {self._current_token().type.name if self._current_token() else 'EOF'}",
                self._current_token().line_number if self._current_token() else line_number
            )
            name = f"unnamed_si_{len(self.steps)}"
        else:
            name = self._current_token().value
            self._advance()

        # Check for duplicate names
        if name in self.name_to_step:
            self._record_error(
                f"Duplicate step name '@{name}'",
                line_number
            )

        # Expect (
        if not self._expect(TokenType.LPAREN):
            return

        # Expect ACTION token
        if not self._check(TokenType.ACTION):
            self._record_error(
                f"Expected ACTION, got {self._current_token().type.name if self._current_token() else 'EOF'}",
                self._current_token().line_number if self._current_token() else line_number
            )
            action = ""
        else:
            action = self._current_token().value
            self._advance()

        # Check for optional preset
        preset = 0
        if self._check(TokenType.COMMA):
            self._advance()  # Consume comma
            preset = self._parse_number()
            if preset is None:
                preset = 0  # Error already recorded

        # Expect )
        if not self._expect(TokenType.RPAREN):
            return

        # Create step object
        step = QGStep(name, action, preset, is_initial=True, line_number=line_number)
        step.operand = len(self.steps)  # Sequential: 0, 1, 2...
        step.id = line_number           # Line number: 1, 3, 6...
        self.steps.append(step)
        self.name_to_step[name] = step
        self.current_step = step

    def _parse_step(self):
        """Parse S@name(ACTION, [PRESET])"""
        line_number = self._current_token().line_number
        self._advance()  # Consume S

        # Expect @ symbol
        if not self._expect(TokenType.AT):
            return

        # Expect NAME token
        if not self._check(TokenType.NAME):
            self._record_error(
                f"Expected name after @, got {self._current_token().type.name if self._current_token() else 'EOF'}",
                self._current_token().line_number if self._current_token() else line_number
            )
            name = f"unnamed_s_{len(self.steps)}"
        else:
            name = self._current_token().value
            self._advance()

        # Check for duplicate names
        if name in self.name_to_step:
            self._record_error(
                f"Duplicate step name '@{name}'",
                line_number
            )

        # Expect (
        if not self._expect(TokenType.LPAREN):
            return

        # Expect ACTION token
        if not self._check(TokenType.ACTION):
            self._record_error(
                f"Expected ACTION, got {self._current_token().type.name if self._current_token() else 'EOF'}",
                self._current_token().line_number if self._current_token() else line_number
            )
            action = ""
        else:
            action = self._current_token().value
            self._advance()

        # Check for optional preset
        preset = 0
        if self._check(TokenType.COMMA):
            self._advance()  # Consume comma
            preset = self._parse_number()
            if preset is None:
                preset = 0  # Error already recorded

        # Expect )
        if not self._expect(TokenType.RPAREN):
            return

        # Create step object
        step = QGStep(name, action, preset, is_initial=False, line_number=line_number)
        step.operand = len(self.steps)  # Sequential: 0, 1, 2...
        step.id = line_number            # Line number: 1, 3, 6...
        self.steps.append(step)
        self.name_to_step[name] = step
        self.current_step = step

    def _parse_transition(self):
        """Parse T@name(CONDITION) [>> @target]"""
        line_number = self._current_token().line_number

        # Check if transition appears before any step
        if self.current_step is None:
            self._record_error(
                "Transition T@name() cannot appear before any step (S or SI)",
                line_number
            )

        self._advance()  # Consume T

        # Expect @ symbol
        if not self._expect(TokenType.AT):
            return

        # Expect NAME token
        if not self._check(TokenType.NAME):
            self._record_error(
                f"Expected name after @, got {self._current_token().type.name if self._current_token() else 'EOF'}",
                self._current_token().line_number if self._current_token() else line_number
            )
            name = f"unnamed_t_{len(self.transitions)}"
        else:
            name = self._current_token().value
            self._advance()

        # Check for duplicate names
        if name in self.name_to_transition:
            self._record_error(
                f"Duplicate transition name '@{name}'",
                line_number
            )

        # Expect (
        if not self._expect(TokenType.LPAREN):
            return

        # Expect CONDITION token
        if not self._check(TokenType.CONDITION):
            self._record_error(
                f"Expected CONDITION, got {self._current_token().type.name if self._current_token() else 'EOF'}",
                self._current_token().line_number if self._current_token() else line_number
            )
            condition = ""
        else:
            condition = self._current_token().value
            self._advance()

        # Expect )
        if not self._expect(TokenType.RPAREN):
            return

        # Check for optional >> jump operator
        target_name = None
        if self._check(TokenType.JUMP):
            self._advance()  # Consume >>
            # Expect @ symbol
            if not self._expect(TokenType.AT):
                return
            # Expect target NAME
            if not self._check(TokenType.NAME):
                self._record_error(
                    f"Expected step name after >> @, got {self._current_token().type.name if self._current_token() else 'EOF'}",
                    self._current_token().line_number if self._current_token() else line_number
                )
            else:
                target_name = self._current_token().value
                self._advance()

        # Create transition object
        transition = QGTransition(name, condition, target_name, line_number=line_number)
        transition.operand = len(self.transitions)  # Sequential: 0, 1, 2...
        transition.id = line_number                 # Line number: 2, 4, 5...
        self.transitions.append(transition)
        self.name_to_transition[name] = transition

        # Link transition to current step (from_step)
        if self.current_step is not None:
            transition.set_from_step(self.current_step)

    def _parse_branch(self):
        """Parse branch structure: /\\ ... \\/ or //\\\\ ... \\\\//

        Branch syntax:
        T@decision(cond) /\\         # OR divergence
            T@opt1(c1) -> S@p1(a1)  # Leg 1
          |                          # Separator
            T@opt2(c2) -> S@p2(a2)  # Leg 2
        \\/ S@merge(action)          # OR convergence

        T@start(cond) //\\\\         # AND divergence
            S@leg1(a1)               # Leg 1
            T@done1(c1)
          |                          # Separator
            S@leg2(a2)               # Leg 2
            T@done2(c2)
        \\\\// T@join(all_done)      # AND convergence
        """
        line_number = self._current_token().line_number

        # Determine branch type
        is_and_branch = self._check(TokenType.AND_DIVERGE)
        flow_type = "AND" if is_and_branch else "OR"
        diverge_token = TokenType.AND_DIVERGE if is_and_branch else TokenType.OR_DIVERGE
        converge_token = TokenType.AND_CONVERGE if is_and_branch else TokenType.OR_CONVERGE

        self._advance()  # Consume divergence operator
        self._skip_newlines()

        # Create divergence branch
        diverge_branch = QGBranch("DIVERGE", flow_type, line_number)

        # Parse legs until convergence
        current_leg = QGLeg()
        diverge_branch.legs.append(current_leg)

        while not self._at_end() and not self._check(converge_token) and not self._check(TokenType.END):
            self._skip_newlines()

            if self._check(converge_token):
                break

            # Check for leg separator
            if self._check(TokenType.LEG_SEPARATOR):
                self._advance()
                self._skip_newlines()
                # Start new leg
                current_leg = QGLeg()
                diverge_branch.legs.append(current_leg)
                continue

            # Parse leg content based on branch type
            if self._check(TokenType.S) or self._check(TokenType.SI):
                # Parse step and add to current leg
                step_before_count = len(self.steps)
                if self._check(TokenType.SI):
                    self._parse_initial_step()
                else:
                    self._parse_step()
                # Add newly created step to leg
                if len(self.steps) > step_before_count:
                    current_leg.steps.append(self.steps[-1])

            elif self._check(TokenType.T):
                # Parse transition
                trans_before_count = len(self.transitions)
                self._parse_transition()
                # Add newly created transition to leg
                if len(self.transitions) > trans_before_count:
                    current_leg.transitions.append(self.transitions[-1])

                # For OR branches, check for -> operator
                if not is_and_branch and self._check(TokenType.ARROW):
                    self._advance()  # Consume ->
                    self._skip_newlines()

                    # Check for jump (-> @target) or new step (-> S@name)
                    if self._check(TokenType.AT):
                        # Jump to existing step: -> @target
                        self._advance()  # Consume @
                        if not self._check(TokenType.NAME):
                            self._record_error(
                                f"Expected step name after -> @",
                                self._current_token().line_number if self._current_token() else line_number
                            )
                        else:
                            target_name = self._current_token().value
                            self._advance()
                            # Set jump target on last transition in current leg
                            if current_leg.transitions and len(current_leg.transitions) > 0:
                                current_leg.transitions[-1].target_name = target_name
                            else:
                                self._record_error(
                                    f"-> @ jump must follow a transition",
                                    self._current_token().line_number if self._current_token() else line_number
                                )

                    elif self._check(TokenType.S):
                        # Create new step: -> S@name(action)
                        step_before_count = len(self.steps)
                        self._parse_step()
                        if len(self.steps) > step_before_count:
                            current_leg.steps.append(self.steps[-1])
                    else:
                        self._record_error(
                            f"Expected S@name or @target after -> in OR branch leg",
                            self._current_token().line_number if self._current_token() else line_number
                        )
            elif self._check(TokenType.END):
                # Reached END - exit loop
                break
            else:
                # Unexpected token in branch
                token = self._current_token()
                self._record_error(
                    f"Unexpected token in branch: {token.type.name}",
                    token.line_number if token else line_number
                )
                self._advance()

        # Validate branch structure according to IEC 61131-3
        if is_and_branch:
            self._validate_and_divergence_structure(diverge_branch)
        else:  # OR branch
            self._validate_or_divergence_structure(diverge_branch)

        # Check if all legs have jumps (for optional convergence)
        all_legs_jump = self._check_all_legs_have_jumps(diverge_branch)

        # Expect convergence operator (but optional if all legs jump in OR)
        if not self._check(converge_token):
            if is_and_branch:
                # AND branches ALWAYS need convergence
                converge_op = r"\//"
                self._record_error(
                    f"Expected {converge_op} to close AND branch",
                    self._current_token().line_number if self._current_token() else line_number
                )
            elif not all_legs_jump:
                # OR branches need convergence unless all legs jump
                converge_op = r"\/"
                self._record_error(
                    f"Expected {converge_op} to close OR branch, or ensure all legs jump (-> @target)",
                    self._current_token().line_number if self._current_token() else line_number
                )
            # If OR branch and all legs jump, convergence is optional - no error
        else:
            # Convergence present - parse it
            self._advance()  # Consume convergence operator
            self._skip_newlines()

            # Create convergence branch
            converge_branch = QGBranch("CONVERGE", flow_type, self._current_token().line_number if self._current_token() else line_number)

            # Validate convergence is at a Transition (IEC 61131-3 rule)
            if not self._check(TokenType.T):
                self._record_error(
                    f"Convergence must be followed by a step S@name, not transition",
                    self._current_token().line_number if self._current_token() else line_number
                )

            # Parse the element after convergence
            if self._check(TokenType.T):
                trans_before_count = len(self.transitions)
                self._parse_transition()
                # Link convergence to this transition
                if len(self.transitions) > trans_before_count:
                    converge_branch.name = self.transitions[-1].name

            elif self._check(TokenType.S):
                step_before_count = len(self.steps)
                self._parse_step()
                # Link convergence to this step
                if len(self.steps) > step_before_count:
                    converge_branch.name = self.steps[-1].name
                    # Update current_step so next transition can link to it
                    self.current_step = self.steps[-1]

            self.branches.append(converge_branch)

        # Store divergence branch
        self.branches.append(diverge_branch)

    def _validate_or_divergence_structure(self, branch):
        """Validate OR divergence follows IEC 61131-3 rules.

        Rules:
        - Each leg MUST start with a Transition
        - Convergence at Step (or optional if all legs jump)
        """
        for i, leg in enumerate(branch.legs):
            if not leg.transitions:
                self._record_error(
                    f"OR divergence leg {i+1} must start with a transition",
                    branch.line_number
                )
                return False
            # First element in leg must be transition (check by seeing if transitions[0] appears before any steps)
            if leg.steps and leg.steps[0].line_number < leg.transitions[0].line_number:
                self._record_error(
                    f"OR divergence leg {i+1} must START with transition, not step",
                    leg.steps[0].line_number
                )
                return False
        return True

    def _validate_and_divergence_structure(self, branch):
        """Validate AND divergence follows IEC 61131-3 rules.

        Rules:
        - Each leg MUST start with a Step
        - Each leg MUST end with a Transition
        """
        for i, leg in enumerate(branch.legs):
            if not leg.steps:
                self._record_error(
                    f"AND divergence leg {i+1} must start with a step",
                    branch.line_number
                )
                return False

            # First element must be step
            first_line = min(
                leg.steps[0].line_number if leg.steps else float('inf'),
                leg.transitions[0].line_number if leg.transitions else float('inf')
            )
            if leg.transitions and leg.transitions[0].line_number == first_line:
                self._record_error(
                    f"AND divergence leg {i+1} must START with step, not transition",
                    leg.transitions[0].line_number
                )
                return False

            # Last element must be step
            last_step_line = leg.steps[-1].line_number if leg.steps else 0
            last_trans_line = leg.transitions[-1].line_number if leg.transitions else 0
            if last_step_line < last_trans_line:
                self._record_error(
                    f"AND divergence leg {i+1} must END with step, not transition",
                    leg.steps[-1].line_number
                )
                return False

        return True

    def _check_all_legs_have_jumps(self, branch):
        """Check if all legs have transitions with jump targets."""
        if not branch.legs:
            return False
        for leg in branch.legs:
            if not leg.transitions:
                return False
            has_jump = any(t.target_name is not None for t in leg.transitions)
            if not has_jump:
                return False
        return True

    def _parse_number(self):
        """Parse a number token.

        Returns:
            Integer value or None if error
        """
        if not self._check(TokenType.NUMBER):
            self._record_error(
                f"Expected number, got {self._current_token().type.name}",
                self._current_token().line_number
            )
            return None

        number = self._current_token().value
        self._advance()
        return number

    def _build_relationships(self):
        """Build bidirectional Step ↔ Transition relationships."""
        for transition in self.transitions:
            # from_step already set during parsing

            # Resolve to_step
            if transition.target_name is not None:
                # Explicit target name specified (>> @target)
                to_step = self.name_to_step.get(transition.target_name)
                if to_step is None:
                    self._record_error(
                        f"Invalid step reference: step '@{transition.target_name}' not found",
                        transition.line_number
                    )
                else:
                    transition.set_to_step(to_step)
            else:
                # Implicit next step - find next step after this transition
                next_step = self._find_next_step_from(transition.line_number)
                if next_step is None:
                    self._record_error(
                        "Transition has no target step (no >> @target and no following step)",
                        transition.line_number
                    )
                else:
                    transition.set_to_step(next_step)

            # Update step relationships
            if transition.from_step is not None:
                transition.from_step.add_outgoing_transition(transition)

            if transition.to_step is not None:
                transition.to_step.add_incoming_transition(transition)

    def _find_next_step_from(self, line_number: int):
        """Find the next step (S or SI) after given line number.

        Args:
            line_number: 1-indexed line number

        Returns:
            QGStep object or None if not found
        """
        # Find step with smallest line number greater than line_number
        next_step = None
        min_line = float('inf')

        for step in self.steps:
            if step.line_number > line_number and step.line_number < min_line:
                next_step = step
                min_line = step.line_number

        return next_step

    def _validate(self):
        """Validate the parsed SFC."""
        # Check for initial step
        if not any(step.is_initial for step in self.steps):
            self._record_error("No initial step (SI) found", None)

        # Check all transitions have from and to steps
        for transition in self.transitions:
            if transition.from_step is None:
                self._record_error(
                    "Transition has no incoming step",
                    transition.line_number
                )
            if transition.to_step is None:
                self._record_error(
                    "Transition has no outgoing step",
                    transition.line_number
                )

    # Token navigation helpers

    def _current_token(self):
        """Return current token or None if at end."""
        if self._at_end():
            return None
        return self.tokens[self.current]

    def _peek_token(self, offset=1):
        """Look ahead at token without consuming.

        Args:
            offset: How many positions to peek ahead

        Returns:
            Token at offset or None if out of bounds
        """
        peek_pos = self.current + offset
        if peek_pos >= len(self.tokens):
            return None
        return self.tokens[peek_pos]

    def _advance(self):
        """Move to next token."""
        if not self._at_end():
            self.current += 1

    def _at_end(self):
        """Check if at end of token stream."""
        if self.current >= len(self.tokens):
            return True
        # Check if current token is EOF without calling _check (avoid recursion)
        return self.tokens[self.current].type == TokenType.EOF

    def _check(self, token_type: TokenType):
        """Check if current token matches type without consuming.

        Args:
            token_type: TokenType to check

        Returns:
            True if current token matches, False otherwise
        """
        if self._at_end():
            return False
        return self._current_token().type == token_type

    def _expect(self, token_type: TokenType):
        """Expect current token to match type and advance.

        Args:
            token_type: Expected TokenType

        Returns:
            True if matched, False if error (error recorded)
        """
        if not self._check(token_type):
            current = self._current_token()
            self._record_error(
                f"Expected {token_type.name}, got {current.type.name if current else 'EOF'}",
                current.line_number if current else self.tokens[-1].line_number
            )
            return False

        self._advance()
        return True

    def _skip_newlines(self):
        """Skip any newline tokens."""
        while self._check(TokenType.NEWLINE):
            self._advance()

    def _record_error(self, message: str, line_number: int):
        """Record a parse error.

        Args:
            message: Error description
            line_number: Line number where error occurred
        """
        error = ParseError(message, line_number)
        self.errors.add(error)
