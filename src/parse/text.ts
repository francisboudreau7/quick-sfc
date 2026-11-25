/**
 * Low-level text helpers for the line parser: string masking, comment detection,
 * qSFC strings and durations (SPEC §3.3, §3.5, §3.6).
 */
import { error, type Diagnostic, type Span } from "../model/diagnostics.js";

/**
 * Replace the content of ST strings ('...', escape `$`) and qSFC / ST double-quoted
 * strings ("...", escape `\`) with spaces, keeping the quotes and the length.
 * `comment` is the index of the first `//` outside strings (-1 if none); everything
 * from there on is blanked too.
 */
export function mask(s: string): { masked: string; comment: number } {
  let out = "";
  let i = 0;
  let comment = -1;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "/" && s[i + 1] === "/") {
      comment = i;
      out += " ".repeat(s.length - i);
      break;
    }
    if (c === "'" || c === '"') {
      const esc = c === "'" ? "$" : "\\";
      out += c;
      i++;
      while (i < s.length && s[i] !== c) {
        if (s[i] === esc && i + 1 < s.length) {
          out += "  ";
          i += 2;
          continue;
        }
        out += " ";
        i++;
      }
      if (i < s.length) {
        out += c;
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return { masked: out, comment };
}

/** End index of the line content: before the comment, trailing whitespace removed. */
export function contentEnd(raw: string): number {
  const { comment } = mask(raw);
  const end = comment < 0 ? raw.length : comment;
  return raw.slice(0, end).trimEnd().length;
}

export function skipWs(s: string, i: number, end: number): number {
  while (i < end && (s[i] === " " || s[i] === "\t")) i++;
  return i;
}

export function isWs(c: string | undefined): boolean {
  return c === " " || c === "\t";
}

/** Read a qSFC string starting at the opening quote `s[i]`. `\"` and `\\` are escapes. */
export function readString(
  s: string,
  i: number,
  end: number,
): { value: string; next: number; closed: boolean } {
  let j = i + 1;
  let value = "";
  while (j < end) {
    const c = s[j]!;
    if (c === "\\" && j + 1 < end && (s[j + 1] === '"' || s[j + 1] === "\\")) {
      value += s[j + 1];
      j += 2;
      continue;
    }
    if (c === '"') return { value, next: j + 1, closed: true };
    value += c;
    j++;
  }
  return { value, next: end, closed: false };
}

/** E109 when the text contains `]]>`. */
export function checkCdata(text: string, span: Span, diags: Diagnostic[]): void {
  const at = text.indexOf("]]>");
  if (at >= 0) {
    diags.push(
      error("E109", { line: span.line, col: span.col + at, endLine: span.line, endCol: span.col + at + 3 },
        "text can't contain `]]>` (L5X limitation)"),
    );
  }
}

export const MAX_PRESET_MS = 2147483647;

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000 };

/** Parse a duration token (SPEC §3.5). Returns ms, or undefined after pushing E104/E105. */
export function parseDuration(tok: string, span: Span, diags: Diagnostic[]): number | undefined {
  if (/^\d+$/.test(tok)) {
    diags.push(error("E104", span, `\`${tok}\` has no unit: write \`${tok}s\` or \`${tok}ms\``));
    return undefined;
  }
  if (!/^(\d+[A-Za-z]*)+$/.test(tok)) {
    diags.push(error("E105", span, `duration \`${tok}\` is not valid: write a number and a unit, e.g. \`5s\` or \`1m30s\``));
    return undefined;
  }
  let total = 0;
  const re = /(\d+)([A-Za-z]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tok)) !== null) {
    const num = Number(m[1]);
    const unit = m[2]!.toLowerCase();
    if (unit === "") {
      diags.push(error("E104", span, `\`${m[1]}\` in duration \`${tok}\` has no unit: add ms, s, m or h`));
      return undefined;
    }
    const factor = UNIT_MS[unit];
    if (factor === undefined) {
      diags.push(error("E105", span, `duration \`${tok}\`: unknown unit \`${m[2]}\` (use ms, s, m, h)`));
      return undefined;
    }
    total += num * factor;
  }
  if (total > MAX_PRESET_MS) {
    diags.push(error("E105", span, `duration \`${tok}\` is too long (max 2147483647 ms, about 24.8 days)`));
    return undefined;
  }
  return total;
}
