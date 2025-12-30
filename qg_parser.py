
"""Parser for Quick Grafcet language.

This module provides syntactic and semantic analysis for Quick Grafcet
(.qg) files, building SFC objects from token streams.
"""

from typing import List
from .qg_tokenizer import QGTokenizer, TokenType
from .qg_sfc import QSFC, QDirectedLink, QStep, QTransition, QBranch, QLeg
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
        self.branches: List[QBranch] = []   
        self.name_to_step = {}  # Map: name -> QGStep
        self.name_to_transition = {}  # Map: name -> QGTransition
        self.errors = ErrorCollector()
        self.current_step = None  # Track current step for transition linking
        self.file_comments = {} #key is line number

        # L5X export state
        self.global_id_counter = 0  # Global ID counter for all objects
        self.directed_links = []  # List[QGDirectedLink]
        self.current_x = 100  # Current X coordinate (starting position)
        self.current_y = 20   # Current Y coordinate (starting position)
        self.y_increment = 20  # Y increment per element
        self.x_spacing = 150   # Horizontal spacing for branch legs
        self.last_parsed_element = None  # Last Step or Transition (for branch linking)
        self.inside_branch = False  # Flag to track if we're inside a branch
        self.after_convergence = False  # Flag to skip from_step linking after convergence

    def parse(self):
        """Parse the .qg file and return QGSFC object.

        Returns:
            QGSFC object containing parsed steps and transitions

        Raises:
            ParseError: If any syntax or semantic errors found
        """
        #  Tokenization
        try:
            self.tokens = self.tokenizer.tokenize()
        except TokenizeError as e:
            self.errors.add(e)
            self.errors.raise_if_errors()

        # Syntax validation, object construction, bidirectional links
        if not self.errors.has_errors():
            self._parse_file()

        #linking jumps after transitions
        if not self.errors.has_errors():
            self._handle_jumps()

        #linking comments
        if not self.errors.has_errors():
            self._link_comments()

        #  DirectedLink generation
        if not self.errors.has_errors():
            pass
        #   self._generate_directed_links()

        #  Validation
        if not self.errors.has_errors():
            pass
            self._validate()

        # Raise if any errors collected
        self.errors.raise_if_errors()

        return QSFC(self.steps, self.transitions, self.branches, self.directed_links)

    def _next_id(self):
        """Allocate next global ID from counter.

        Returns:
            int: Next sequential ID
        """
        current_id = self.global_id_counter
        self.global_id_counter += 1
        return current_id

    def _parse_file(self):
        """Parse the entire file: SI ... (S | T)* ... END"""
        # Skip leading newlines
        self._skip_newlines()

        # # First meaningful token must be SI
        # if not self._check(TokenType.SI):
        #     self._record_error(
        #         "First line must be SI() (initial step)",
        #         self._current_token().line_number if self._current_token() else 1
        #     )
        #     # Try to recover by finding SI
        #     while not self._at_end() and not self._check(TokenType.SI):
        #         self._advance()

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
            elif self._check(TokenType.HASH):
                #If the line only contains a comment, we store it
                if self._check_behind(TokenType.NEWLINE):
                    self._advance()  # Skip HASH
                    self.file_comments[self._current_token().line_number] = self._consume(TokenType.COMMENT)
                    self._skip_newlines()
                # if we are after another token, we keep it in the dict
                else:
                    self._advance()
                    self.file_comments[self._current_token().line_number] = self._consume(TokenType.COMMENT)
                    self._skip_newlines() 
            
                 
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

    def _parse_comment(self):
        line_number = self._current_token().line_number

    def _parse_initial_step(self):
        """Parse SI@name(ACTION, [PRESET])"""
        line_number = self._current_token().line_number

        # Check if SI already parsed
        if any(step.is_initial for step in self.steps):
            self._record_error(
                "Only one SI@name() (initial step) allowed",
                line_number
            )
        self._parse_step()
        self.last_parsed_element.is_initial = True
        

    def _parse_step(self):
        """Parse S@name(ACTION, [PRESET])"""
        line_number = self._current_token().line_number
        self._advance()  # Consume S
        comments = []
        action = None
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

        # Expect ACTION or COMMENT token
        if self._check(TokenType.ACTION):
            action = self._current_token().value
            self._advance()
        if self._check(TokenType.COMMENT):
            comments.append(self._current_token().value)
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
        step = QStep(name, action, preset, line_number, comments=comments, is_initial=False)

        # Assign IDs
        step.id = self._next_id()  # Global ID
        step.operand = len(self.steps)  # Sequential step counter: 0, 1, 2...

        # Assign coordinates
        step.x = self.current_x
        step.y = self.current_y
        self.current_y += self.y_increment

        #link step to preceding transition
        if self.last_parsed_element is not None and not self.inside_branch and not self.after_convergence:
            preceding_transition = self.last_parsed_element
            step.add_incoming_transition(preceding_transition)
            preceding_transition.add_outgoing_step(step)

        self.steps.append(step)
        self.name_to_step[name] = step
        self.current_step = step
        self.last_parsed_element = step  # Track for branch linking

    def _parse_transition(self):
        """Parse T@name(CONDITION) [>> @target]"""
        line_number = self._current_token().line_number
        comment = None

        # Check if transition appears before any step (unless inside a branch)
        if self.current_step is None and not self.inside_branch:
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
        # #Check for a comment after transition definition
        # while not self._check(TokenType.NEWLINE):
        #     if self._check(TokenType.HASH):
        #         self._advance()
        #         if self._check(TokenType.COMMENT):
        #             comment = self._current_token().value
        #     self._advance()
                

        # Create transition object
        transition = QTransition(name, condition, target_name, line_number,comment)
        
        # Assign IDs
        transition.id = self._next_id()  # Global ID
        transition.operand = len(self.transitions)  # Sequential transition counter: 0, 1, 2...

        # Assign coordinates
        transition.x = self.current_x
        transition.y = self.current_y
        self.current_y += self.y_increment

        self.transitions.append(transition)
        self.name_to_transition[name] = transition


        self.last_parsed_element = transition 

        # Link transition to current step ( which is the step on the line just before the transition)  - but not if inside a branch or after convergence
        if self.current_step is not None and not self.inside_branch and not self.after_convergence:
            transition.add_incoming_step(self.current_step)
            self.current_step.add_outgoing_transition(transition)
        elif self.current_step is None:
            # Debug: transition with no current_step outside of branch
            if not self.inside_branch and not self.after_convergence and line_number > 1:
                # This transition appears after first line but has no current_step
                pass  # Will/should be caught in validation

        # Reset after_convergence flag after using it
        if self.after_convergence:
            self.after_convergence = False

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
        diverge_branch = QBranch("DIVERGE", flow_type, line_number)

        # Assign ID and coordinates to divergence branch
        diverge_branch.id = self._next_id()

        # Create reference of last element to divergence branch, it is the root
        if self.last_parsed_element:
            diverge_branch.root = self.last_parsed_element

        # Set flag to indicate we're inside a branch
        self.inside_branch = True

        # Parse legs until convergence
        current_leg = QLeg()
        diverge_branch.legs.append(current_leg)

        while not self._at_end() and not self._check(converge_token) and not self._check(TokenType.END):
            self._skip_newlines()

            if self._check(converge_token):
                break

            # Check for leg separator
            if self._check(TokenType.LEG_SEPARATOR):
                self._advance()
                self._skip_newlines()


                current_leg = QLeg()
                # Legs don't have IDs - they're just organizational containers
                diverge_branch.legs.append(current_leg)
                continue

            # Parse leg content based on branch type
            if self._check(TokenType.S):
                # Parse step and add to current leg
                step_before_count = len(self.steps)
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
                if not is_and_branch and self._check(TokenType.JUMP):
                    self._advance()  # Consume ->
                    self._skip_newlines()

                    # Check for jump (-> @target)
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
            # No convergence - reset flag here
            self.inside_branch = False

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
            converge_branch = QBranch("CONVERGE", flow_type, self._current_token().line_number if self._current_token() else line_number)

            # Assign ID and coordinates to convergence branch
            converge_branch.id = self._next_id()
            converge_branch.x = self.current_x
            converge_branch.y = self.current_y
            self.current_y += self.y_increment

            #The legs of the converge branch are the legs of the diverge branch if parallel branch (no jump allowed)
            if is_and_branch: 
                converge_branch.legs = diverge_branch.legs
            else: 
                #if a the last transition of a diverge branch leg has no jump, then it is a leg of the converge branch
                converge_branch.legs =  list(filter(lambda leg: not(leg.transitions[-1].target_name), diverge_branch.legs))
                
#this should be in creating directed steps
                    # if not has_jump:
                    #     # Create link from last element directly to converge branch
                    #     if is_and_branch:
                    #         # AND branch: last Step in leg → converge_branch
                    #         if leg.steps:
                    #             link = QGDirectedLink(from_id=leg.steps[-1].id, to_id=converge_branch.id, show=True)
                    #             self.directed_links.append(link)
                    #     else:
                    #         # OR branch: last Transition in leg → converge_branch
                    #         if leg.transitions:
                    #             link = QGDirectedLink(from_id=leg.transitions[-1].id, to_id=converge_branch.id, show=True)
                    #             self.directed_links.append(link)

            # Validate convergence follows IEC 61131-3 rules
            if is_and_branch:
                # AND (parallel) convergence → Transition
                if not self._check(TokenType.T):
                    self._record_error(
                        f"AND convergence must be followed by a transition T@name",
                        self._current_token().line_number if self._current_token() else line_number
                    )
            else:
                # OR (selection) convergence → Step
                if not self._check(TokenType.S):
                    self._record_error(
                        f"OR convergence must be followed by a step S@name",
                        self._current_token().line_number if self._current_token() else line_number
                    )

            # Reset inside_branch flag BEFORE parsing the element after convergence
            # The element after convergence is NOT inside the branch
            self.inside_branch = False

            # Set after_convergence flag so transitions don't get linked to branch internals
            # This prevents incorrect from_step for transitions after convergence
            self.after_convergence = True

            # Parse the element after convergence
            following_element = None
            if self._check(TokenType.T):
                trans_before_count = len(self.transitions)
                self._parse_transition()
                # Link convergence to this transition
                if len(self.transitions) > trans_before_count:
                    converge_branch.root = self.transitions[-1]
                    following_element = self.transitions[-1]

            elif self._check(TokenType.S):
                step_before_count = len(self.steps)
                self._parse_step()
                # Link convergence to this step
                if len(self.steps) > step_before_count:
                    converge_branch.root = self.steps[-1]
                    following_element = self.steps[-1]
                    # Update current_step so next transition can link to it
                    self.current_step = self.steps[-1]
                    # Reset after_convergence flag now that we've parsed the step after convergence
                    # Next transitions should link normally to this step
                    self.after_convergence = False
            
            
           


            for leg in converge_branch.legs:
                if is_and_branch:
                    # add the transition the outgoing transitions of each last step of a leg and vice versa
                    root: QTransition = converge_branch.get_root()
                    last_step: QStep = leg.steps[-1]
                    
                    last_step.add_outgoing_transition(root)
                    root.add_incoming_step(last_step)
                else: 
                    root: QStep = converge_branch.get_root()
                    last_transition: QTransition = leg.transitions[-1]
                    last_transition.add_outgoing_step(root)
                    root.add_incoming_transition(last_transition)
            self.branches.append(converge_branch)
        
        
        for leg in diverge_branch.legs:
        #adding links between elements of legs
            for i in  range(len(leg.elements)-1):
                from_elem:QStep|QTransition = leg.elements_sorted_by_line_number()[i]
                to_elem:QStep|QTransition = leg.elements_sorted_by_line_number()[i+1]

                if isinstance(from_elem,QStep):
                    from_elem.add_outgoing_transition(to_elem)
                    to_elem.add_incoming_step(from_elem)
                elif isinstance(from_elem,QTransition):
                    from_elem.add_outgoing_step(to_elem)
                    to_elem.add_incoming_transition(from_elem)
                else:
                    self._record_error(
                f"Unexpected type in branch leg, should be only steps or transitions")
            #now we link references between legs and root 
            if is_and_branch:    
                root: QTransition = diverge_branch.get_root()
                first_step: QStep = leg.steps[0]
                first_step.add_incoming_transition(root)
                root.add_outgoing_step(first_step)
            else:
                root: QStep = diverge_branch.get_root()
                first_transition: QTransition = leg.transitions[0]
                first_transition.add_incoming_step(root)
                root.add_outgoing_transition(first_transition)


#this should be in creating directed steps
            # # Create DirectedLink from convergence to following element
            # if following_element:
            #     link = QGDirectedLink(from_id=converge_branch.id, to_id=following_element.id, show=True)
            #     self.directed_links.append(link)



            

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

    def _handle_jumps(self):
        """Build bidirectional Step ↔ Transition relationships."""
        elements_in_branches = []
        for branch in self.branches:
            elements_in_branches+=branch.elements_in_branch
        
        for transition in self.transitions:
            # from_step already set during parsing (for non-branch transitions)

            # Resolve to_step
            if transition.target_name is not None:
                # Explicit target name specified (>> @target)
                target_step = self.name_to_step.get(transition.target_name)
                if target_step is None:
                    self._record_error(
                        f"Invalid step reference: step '@{transition.target_name}' not found",
                        transition.line_number
                    )
                else:
                    transition.add_outgoing_step(target_step)
                    target_step.add_incoming_transition(transition)
            # elif transition not in elements_in_branches:
            #     next_step = self._find_next_step_from(transition.line_number)
            #     # Don't set to_step if next_step is inside a branch (connected via branch structure)
            #     if next_step is None:
            #         self._record_error(
            #             "Transition has no target step (no >> @target and no following step)",
            #             transition.line_number
            #         )
            #     elif next_step not in elements_in_branches:
            #         transition.add_outgoing_step(next_step)

    def _link_comments(self,):
        "Link comments that are after a Transition or Step to it's respective owner"
        for step in self.steps:
            if step.line_number in self.file_comments:
                step.comments.append(self.file_comments[step.line_number])

        for trans in self.transitions:
            if trans.line_number in self.file_comments:
                trans.comment= self.file_comments[trans.line_number]     

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

    def _generate_directed_links(self):
        """Generate DirectedLink objects for all connections in the SFC.

        Creates links for normal sequential flow (Step→Transition, Transition→Step).
        Also creates links for elements within branch legs.
        Branch divergence/convergence links are already created during _parse_branch.
        Deduplicates all links at the end.
        """
        from .qg_sfc import QDirectedLink

        # Collect branch IDs and leg IDs to detect branch connections
        branch_ids = set(b.id for b in self.branches)
        leg_ids = set()
        for branch in self.branches:
            if branch.branch_type == "DIVERGE":
                for leg in branch.legs:
                    leg_ids.add(leg.id)

        # Generate DirectedLinks for elements within branch legs
        for branch in self.branches:
            if branch.branch_type == "DIVERGE":
                for leg in branch.legs:
                    # Create links for sequential flow within each leg
                    leg_elements = []
                    # Collect all elements in leg with their line numbers
                    for step in leg.steps:
                        leg_elements.append((step.line_number, 'step', step))
                    for trans in leg.transitions:
                        leg_elements.append((trans.line_number, 'trans', trans))

                    # Sort by line number to get sequential order
                    leg_elements.sort(key=lambda x: x[0])

                    # Create links between consecutive elements
                    for i in range(len(leg_elements) - 1):
                        from_elem = leg_elements[i][2]
                        to_elem = leg_elements[i + 1][2]
                        link = QDirectedLink(from_id=from_elem.id, to_id=to_elem.id, show=True)
                        self.directed_links.append(link)

        # Generate DirectedLinks for normal sequential flow (outside branches)
        for step in self.steps:
            # Check if this step is already connected to a branch or leg (as source)
            has_outgoing_branch_link = any(link.from_id == step.id and (link.to_id in branch_ids or link.to_id in leg_ids)
                                           for link in self.directed_links)

            if not has_outgoing_branch_link:
                # Only create links to outgoing transitions if not connected to a branch
                for trans in step.outgoing_transitions:
                    link = QDirectedLink(from_id=step.id, to_id=trans.id, show=True)
                    self.directed_links.append(link)

        for trans in self.transitions:
            # Check if this transition is already connected to a branch or leg
            has_branch_link = any(link.from_id == trans.id and (link.to_id in branch_ids or link.to_id in leg_ids)
                                 for link in self.directed_links)

            # if not has_branch_link and trans.to_step:
            #     # Only create link to to_step if not connected to a branch
            #     link = QGDirectedLink(from_id=trans.id, to_id=trans.to_step.id, show=True)
            #     self.directed_links.append(link)

        # Deduplicate links (same from_id and to_id)
        seen = set()
        unique_links = []
        for link in self.directed_links:
            key = (link.from_id, link.to_id)
            if key not in seen:
                seen.add(key)
                unique_links.append(link)
        self.directed_links = unique_links

    def _validate(self):
        """Validate the parsed SFC."""
        # Check for initial step
        if not any(step.is_initial for step in self.steps):
            self._record_error("No initial step (SI) found", None)

        # Check all transitions have from and to steps (or are connected via branches)
        for transition in self.transitions:
            # Transitions in branches or after branches don't need from_step
            if transition.incoming_steps ==[]:
                self._record_error(
                    f"Transition {transition.name}  has no incoming step",
                    transition.line_number
                )
            # Transitions in branches or before branches don't need to_step
            if transition.outgoing_steps ==[]:
                self._record_error(
                    f"Transition {transition.name} has no outgoing step",
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
    
    def _consume(self,token_type:TokenType):
        if not self._current_token().type == token_type:
            self._record_error(
                    f"Expected to consume {token_type.name}, got {current.type.name if current else 'EOF'}",
                    current.line_number if current else self.tokens[-1].line_number
                )    
        consumed_token =self._current_token().value
        self._advance()

        return consumed_token
    
    def _check_behind(self, token_type:TokenType):
        if self.current == 0:
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
