"""Tokenizer for Quick Grafcet language.

This module provides lexical analysis for Quick Grafcet (.qg) files,
converting text into a stream of tokens for the parser.
"""

from enum import Enum, auto
from .qg_errors import TokenizeError


class TokenType(Enum):
    """Token types for Quick SFC language."""
    # Keywords
    SI = auto()
    S = auto()
    T = auto()
    END = auto()

    # Delimiters
    LPAREN = auto()
    RPAREN = auto()
    COMMA = auto()

    # Literals
    ACTION = auto()
    CONDITION = auto()
    NUMBER = auto()
    NAME = auto()  # Identifier names (after @)

    # Operators
    AT = auto()  # @ symbol for naming
    JUMP = auto()  # >> operator for explicit jumps
    ARROW = auto()  # -> operator for OR branch connections
    LEG_SEPARATOR = auto()  # | separator for parallel legs
    OR_DIVERGE = auto()  # /\ operator for OR branching
    OR_CONVERGE = auto()  # \/ operator for OR convergence
    AND_DIVERGE = auto()  # //\\ operator for AND branching
    AND_CONVERGE = auto()  # \\// operator for AND convergence

    # Special
    NEWLINE = auto()
    EOF = auto()


class Token:
    """Represents a single token in the Quick Grafcet language.

    Attributes:
        type: TokenType enum value
        value: Token value (str or int)
        line_number: 1-indexed line number where token appears
    """

    def __init__(self, type_: TokenType, value, line_number: int):
        self.type = type_
        self.value = value
        self.line_number = line_number

    def __repr__(self):
        return f"Token({self.type.name}, {self.value!r}, line={self.line_number})"


class QGTokenizer:
    """Tokenizer for Quick Grafcet language.

    Converts .qg file content into a stream of tokens using a
    context-sensitive state machine approach.
    """

    def __init__(self, content: str):
        """Initialize tokenizer with file content.

        Args:
            content: Full text content of .qg file
        """
        self.content = content
        self.pos = 0
        self.line_number = 1
        self.tokens = []

    def tokenize(self):
        """Tokenize the entire content and return list of tokens.

        Returns:
            List of Token objects

        Raises:
            TokenizeError: If invalid characters or syntax encountered
        """
        state = 'NORMAL'  # States: NORMAL, AFTER_NAME, AFTER_LPAREN

        while self.pos < len(self.content):
            self._skip_whitespace_except_newline()

            if self._at_end():
                break

            # Handle comments (# to end of line)
            if self._current_char() == '#':
                self._skip_comment()
                continue

            # Handle newlines (significant for line tracking)
            if self._current_char() == '\n':
                self._emit_token(TokenType.NEWLINE, '\n')
                self.line_number += 1
                self.pos += 1
                continue

            # Try to match multi-character operators first (before single chars)
            if self._match_multi_char_operators():
                continue

            # Try to match keywords (SI, S, T, END)
            if self._match_keyword_with_state():
                state = 'AFTER_KEYWORD'
                continue

            # Handle @ symbol (name prefix)
            if self._current_char() == '@':
                self._emit_token(TokenType.AT, '@')
                self._advance()
                # Expect NAME after @
                if not self._match_name():
                    raise TokenizeError(
                        f"Expected identifier after '@'",
                        self.line_number
                    )
                state = 'AFTER_NAME'
                continue

            # Handle left paren - capture action/condition
            if self._current_char() == '(':
                self._emit_token(TokenType.LPAREN, '(')
                self._advance()

                # After @name(, capture action or condition
                if state == 'AFTER_NAME':
                    # Peek at previous tokens to determine if S/SI or T
                    content = self._capture_until([',', ')'])
                    # Check token before @ to determine type
                    keyword_token = self._find_recent_keyword()
                    if keyword_token and keyword_token.type in [TokenType.S, TokenType.SI]:
                        self._emit_token(TokenType.ACTION, content)
                    elif keyword_token and keyword_token.type == TokenType.T:
                        self._emit_token(TokenType.CONDITION, content)
                    else:
                        # Default to action
                        self._emit_token(TokenType.ACTION, content)
                    state = 'NORMAL'
                continue

            # Try to match other delimiters
            if self._match_delimiter_except_lparen():
                continue

            # Try to match numbers
            if self._match_number():
                continue

            # Try to match standalone name (shouldn't happen in valid syntax)
            if self._match_name():
                continue

            # Otherwise, it's an error
            raise TokenizeError(
                f"Unexpected character: '{self._current_char()}'",
                self.line_number
            )

        self._emit_token(TokenType.EOF, None)
        return self.tokens

    def _at_end(self):
        """Check if at end of content."""
        return self.pos >= len(self.content)

    def _current_char(self):
        """Return current character or None if at end."""
        if self._at_end():
            return None
        return self.content[self.pos]

    def _peek_char(self, offset=1):
        """Look ahead at character without consuming.

        Args:
            offset: How many positions to peek ahead (default 1)

        Returns:
            Character at offset position or None if out of bounds
        """
        peek_pos = self.pos + offset
        if peek_pos >= len(self.content):
            return None
        return self.content[peek_pos]

    def _advance(self):
        """Move position forward by one character."""
        self.pos += 1

    def _emit_token(self, token_type: TokenType, value):
        """Add a token to the list.

        Args:
            token_type: TokenType enum value
            value: Token value
        """
        token = Token(token_type, value, self.line_number)
        self.tokens.append(token)

    def _skip_whitespace_except_newline(self):
        """Skip spaces and tabs but not newlines."""
        while not self._at_end() and self._current_char() in ' \t\r':
            self._advance()

    def _skip_comment(self):
        """Skip from # to end of line."""
        # Skip the # character
        self._advance()
        # Skip until newline or end of file
        while not self._at_end() and self._current_char() != '\n':
            self._advance()

    def _find_recent_keyword(self):
        """Find the most recent S, SI, or T keyword token.

        Returns:
            Token object or None
        """
        for i in range(len(self.tokens) - 1, -1, -1):
            token = self.tokens[i]
            if token.type in [TokenType.S, TokenType.SI, TokenType.T]:
                return token
        return None

    def _match_name(self):
        """Try to match an identifier name (alphanumeric + underscore).

        Returns:
            True if name matched, False otherwise
        """
        if not (self._current_char() and self._current_char().isalpha()):
            return False

        start_pos = self.pos
        while not self._at_end() and self._is_alphanumeric(self._current_char()):
            self._advance()

        name_str = self.content[start_pos:self.pos]
        self._emit_token(TokenType.NAME, name_str)
        return True

    def _match_multi_char_operators(self):
        r"""Try to match multi-character operators: //\\, \\//,  >>, ->, /\, \/, |

        Returns:
            True if operator matched, False otherwise
        """
        # Check for AND divergence: //\\
        if self._match_text_exact("//\\\\"):
            self._emit_token(TokenType.AND_DIVERGE, "//\\\\")
            return True

        # Check for AND convergence: \\//
        if self._match_text_exact("\\\\//"):
            self._emit_token(TokenType.AND_CONVERGE, "\\\\//")
            return True

        # Check for jump operator: >>
        if self._match_text_exact(">>"):
            self._emit_token(TokenType.JUMP, ">>")
            return True

        # Check for arrow operator: ->
        if self._match_text_exact("->"):
            self._emit_token(TokenType.ARROW, "->")
            return True

        # Check for OR divergence: /\
        if self._match_text_exact("/\\"):
            self._emit_token(TokenType.OR_DIVERGE, "/\\")
            return True

        # Check for OR convergence: \/
        if self._match_text_exact("\\/"):
            self._emit_token(TokenType.OR_CONVERGE, "\\/")
            return True

        # Check for leg separator: |
        if self._current_char() == '|':
            self._emit_token(TokenType.LEG_SEPARATOR, '|')
            self._advance()
            return True

        return False

    def _match_text_exact(self, text):
        """Try to match exact text at current position (no alphanumeric check).

        Args:
            text: Text to match

        Returns:
            True if matched (and position advanced), False otherwise
        """
        end_pos = self.pos + len(text)
        if end_pos > len(self.content):
            return False

        if self.content[self.pos:end_pos] == text:
            self.pos = end_pos
            return True

        return False

    def _match_keyword_with_state(self):
        """Try to match keywords: SI, S, T, END.

        Returns:
            True if keyword matched, False otherwise
        """
        # Check for SI first (must come before S)
        if self._match_text("SI"):
            self._emit_token(TokenType.SI, "SI")
            return True

        # Check for single-letter keywords
        if self._current_char() == 'S' and not self._is_alphanumeric(self._peek_char()):
            self._emit_token(TokenType.S, "S")
            self._advance()
            return True

        if self._current_char() == 'T' and not self._is_alphanumeric(self._peek_char()):
            self._emit_token(TokenType.T, "T")
            self._advance()
            return True

        # Check for END
        if self._match_text("END"):
            self._emit_token(TokenType.END, "END")
            return True

        return False

    def _match_text(self, text):
        """Try to match exact text at current position.

        Args:
            text: Text to match

        Returns:
            True if matched (and position advanced), False otherwise
        """
        end_pos = self.pos + len(text)
        if end_pos > len(self.content):
            return False

        # Check exact match
        if self.content[self.pos:end_pos] == text:
            # Ensure not part of longer identifier
            if end_pos < len(self.content) and self._is_alphanumeric(self.content[end_pos]):
                return False
            self.pos = end_pos
            return True

        return False

    def _is_alphanumeric(self, char):
        """Check if character is alphanumeric or underscore.

        Args:
            char: Character to check

        Returns:
            True if alphanumeric or underscore, False otherwise
        """
        if char is None:
            return False
        return char.isalnum() or char == '_'

    def _match_delimiter_except_lparen(self):
        """Try to match delimiters: ), ,

        LPAREN is handled separately due to context-sensitive parsing.

        Returns:
            True if delimiter matched, False otherwise
        """
        char = self._current_char()

        if char == ')':
            self._emit_token(TokenType.RPAREN, ')')
            self._advance()
            return True
        elif char == ',':
            self._emit_token(TokenType.COMMA, ',')
            self._advance()
            return True

        return False

    def _match_number(self):
        """Try to match an integer number.

        Returns:
            True if number matched, False otherwise
        """
        if not self._current_char().isdigit():
            return False

        start_pos = self.pos
        while not self._at_end() and self._current_char().isdigit():
            self._advance()

        number_str = self.content[start_pos:self.pos]
        self._emit_token(TokenType.NUMBER, int(number_str))
        return True

    def _capture_until(self, delimiters):
        """Capture all characters until one of the delimiters is found.

        Args:
            delimiters: List of delimiter characters to stop at

        Returns:
            Captured string (stripped of leading/trailing whitespace)
        """
        result = []
        paren_depth = 0

        while not self._at_end():
            char = self._current_char()

            # Track parenthesis depth
            if char == '(':
                paren_depth += 1
                result.append(char)
                self._advance()
            elif char == ')':
                if paren_depth == 0 and ')' in delimiters:
                    # End delimiter found
                    break
                paren_depth -= 1
                result.append(char)
                self._advance()
            elif char in delimiters and paren_depth == 0:
                # Delimiter found at top level
                break
            elif char == '\n':
                # Newline in action/condition - error will be handled by parser
                break
            else:
                result.append(char)
                self._advance()

        return ''.join(result).strip()
