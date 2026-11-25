"""Unit tests for qg_tokenizer.py"""

import os
import sys
import pytest

# Add parent directory to path for imports
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
QUICKSFC_DIR = os.path.dirname(TEST_DIR)
WORKSPACE_DIR = os.path.dirname(QUICKSFC_DIR)
sys.path.insert(0, WORKSPACE_DIR)

from QuickSFC.tokenizer import Tokenizer, TokenType, Token
from QuickSFC.errors import TokenizeError


class TestTokenizerBasics:
    """Test basic tokenization functionality."""

    def test_tokenize_simple_step(self):
        """Test tokenizing a basic step."""
        tokenizer = Tokenizer("S@step1(action)")
        tokens = tokenizer.tokenize()

        # Verify token sequence
        assert tokens[0].type == TokenType.S
        assert tokens[1].type == TokenType.AT
        assert tokens[2].type == TokenType.NAME
        assert tokens[2].value == "step1"
        assert tokens[3].type == TokenType.LPAREN
        assert tokens[4].type == TokenType.ACTION
        assert tokens[4].value == "action"
        assert tokens[5].type == TokenType.RPAREN
        assert tokens[-1].type == TokenType.EOF

    def test_tokenize_multi_char_operators(self):
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

    def test_tokenize_keywords_si_vs_s(self):
        """Test that SI is recognized before S."""
        # SI should be recognized as SI, not S then I
        tokenizer = Tokenizer("SI@init()")
        tokens = tokenizer.tokenize()
        assert tokens[0].type == TokenType.SI
        assert tokens[0].value == "SI"

        # S should be recognized as S
        tokenizer = Tokenizer("S@step()")
        tokens = tokenizer.tokenize()
        assert tokens[0].type == TokenType.S

    def test_tokenize_with_comments(self):
        """Test that comments are skipped."""
        content = """# This is a comment
S@step1(action)  # inline comment
"""
        tokenizer = Tokenizer(content)
        tokens = tokenizer.tokenize()

        # Should have: NEWLINE, S, AT, NAME, LPAREN, ACTION, RPAREN, NEWLINE, EOF
        token_types = [t.type for t in tokens]
        assert TokenType.S in token_types
        assert TokenType.NAME in token_types
        # No special comment token - they're just skipped


class TestTokenizerEdgeCases:
    """Test tokenizer edge cases and context-sensitive features."""

    def test_tokenize_nested_parentheses_in_action(self):
        """Test actions can contain nested parentheses."""
        tokenizer = Tokenizer("S@step(func(a, b))")
        tokens = tokenizer.tokenize()

        action_token = [t for t in tokens if t.type == TokenType.ACTION][0]
        assert action_token.value == "func(a, b)"

    def test_tokenize_action_vs_condition(self):
        """Test that S produces ACTION and T produces CONDITION."""
        # Step produces ACTION
        tokenizer = Tokenizer("S@step(x:=1)")
        tokens = tokenizer.tokenize()
        assert any(t.type == TokenType.ACTION for t in tokens)

        # Transition produces CONDITION
        tokenizer = Tokenizer("T@trans(x>5)")
        tokens = tokenizer.tokenize()
        assert any(t.type == TokenType.CONDITION for t in tokens)

    def test_tokenize_line_numbers(self):
        """Test that line numbers are tracked correctly."""
        content = """S@step1(a)
T@trans(b)
S@step2(c)"""
        tokenizer = Tokenizer(content)
        tokens = tokenizer.tokenize()

        # Find tokens on each line
        line1_tokens = [t for t in tokens if t.line_number == 1]
        line2_tokens = [t for t in tokens if t.line_number == 2]
        line3_tokens = [t for t in tokens if t.line_number == 3]

        assert len(line1_tokens) > 0
        assert len(line2_tokens) > 0
        assert len(line3_tokens) > 0

    def test_tokenize_invalid_character_raises_error(self):
        """Test that invalid characters raise TokenizeError."""
        tokenizer = Tokenizer("S@step($invalid)")

        with pytest.raises(TokenizeError) as exc_info:
            tokenizer.tokenize()

        assert "Unexpected character" in str(exc_info.value)
