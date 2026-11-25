/**
 * Minimal Structured Text scanner used by the tag analysis (SPEC §7.1, §9.2).
 * It only needs identifiers, numbers, operators and brackets with exact positions;
 * strings and comments are skipped. Block comments `(* *)` may span several lines of
 * the same unit.
 */

export type TokKind = "id" | "kw" | "num" | "str" | "op" | "p";

export interface Tok {
  k: TokKind;
  /** Text as written. */
  t: string;
  /** Upper-case text (keyword comparison). */
  u: string;
  line: number;
  /** 1-based column of the first character. */
  col: number;
  /** 1-based column after the last character (exclusive). */
  end: number;
  /** num only: decimal number (has `.` or an exponent). */
  real?: boolean;
  /** num only: integer value, or null when unknown / not a plain integer literal. */
  val?: number | null;
}

export interface LineIn {
  text: string;
  line: number;
  /** Column of text[0]. */
  col: number;
}

export interface Scan {
  toks: Tok[];
  /** String tokens that reach the end of their line without a closing quote. */
  unterminated: Tok[];
  lines: Map<number, LineIn>;
}

export const ST_KEYWORDS = new Set([
  "AND", "OR", "XOR", "NOT", "MOD", "TRUE", "FALSE", "IF", "THEN", "ELSIF", "ELSE", "END_IF",
  "CASE", "OF", "END_CASE", "FOR", "TO", "BY", "DO", "END_FOR", "WHILE", "END_WHILE",
  "REPEAT", "UNTIL", "END_REPEAT", "EXIT", "RETURN",
]);

const NUM_RE = /\d[0-9_]*(?:#[0-9A-Za-z_]+|(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;
const ID_RE = /[A-Za-z_][A-Za-z0-9_]*/y;

export function scan(lines: LineIn[]): Scan {
  const toks: Tok[] = [];
  const unterminated: Tok[] = [];
  const lineMap = new Map<number, LineIn>();
  let inBlock = false;

  for (const L of lines) {
    lineMap.set(L.line, L);
    const s = L.text;
    const n = s.length;
    const mk = (k: TokKind, i: number, j: number): Tok => {
      const t = s.slice(i, j);
      return { k, t, u: t.toUpperCase(), line: L.line, col: L.col + i, end: L.col + j };
    };
    let i = 0;
    while (i < n) {
      if (inBlock) {
        const e = s.indexOf("*)", i);
        if (e < 0) {
          i = n;
          break;
        }
        i = e + 2;
        inBlock = false;
        continue;
      }
      const c = s.charAt(i);
      const c2 = s.charAt(i + 1);
      if (c === " " || c === "\t" || c === "\r") {
        i++;
        continue;
      }
      if (c === "/" && c2 === "/") break;
      if (c === "(" && c2 === "*") {
        inBlock = true;
        i += 2;
        continue;
      }
      if (c === "'" || c === '"') {
        let j = i + 1;
        let closed = false;
        while (j < n) {
          const d = s.charAt(j);
          if (d === "$") {
            j += 2;
            continue;
          }
          if (d === c) {
            closed = true;
            j++;
            break;
          }
          j++;
        }
        const end = closed ? j : n;
        const t = mk("str", i, end);
        toks.push(t);
        if (!closed) unterminated.push(t);
        i = end;
        continue;
      }
      if (c >= "0" && c <= "9") {
        NUM_RE.lastIndex = i;
        const m = NUM_RE.exec(s);
        const j = m ? i + m[0].length : i + 1;
        const t = mk("num", i, j);
        setNumber(t);
        toks.push(t);
        i = j;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        ID_RE.lastIndex = i;
        const m = ID_RE.exec(s);
        let j = i + (m ? m[0].length : 1);
        if (s.charAt(j) === "#") {
          // typed literal such as T#5s or DINT#7
          j++;
          while (j < n && /[0-9A-Za-z_.]/.test(s.charAt(j))) j++;
          const t = mk("num", i, j);
          t.real = false;
          t.val = null;
          toks.push(t);
          i = j;
          continue;
        }
        const t = mk("id", i, j);
        if (ST_KEYWORDS.has(t.u)) t.k = "kw";
        toks.push(t);
        i = j;
        continue;
      }
      if (s.startsWith("[:=]", i)) {
        toks.push(mk("op", i, i + 4));
        i += 4;
        continue;
      }
      const two = s.slice(i, i + 2);
      if (two === ":=" || two === "=>" || two === "<>" || two === "<=" || two === ">=" || two === "**") {
        toks.push(mk("op", i, i + 2));
        i += 2;
        continue;
      }
      if ("=<>+-*/&".includes(c)) {
        toks.push(mk("op", i, i + 1));
        i++;
        continue;
      }
      toks.push(mk("p", i, i + 1));
      i++;
    }
  }
  return { toks, unterminated, lines: lineMap };
}

function setNumber(t: Tok): void {
  const text = t.t.replace(/_/g, "");
  const hash = text.indexOf("#");
  if (hash >= 0) {
    const base = Number(text.slice(0, hash));
    const v = parseInt(text.slice(hash + 1), base);
    t.real = false;
    t.val = Number.isFinite(v) && base >= 2 && base <= 16 ? v : null;
    return;
  }
  if (/[.eE]/.test(text)) {
    t.real = true;
    t.val = null;
    return;
  }
  t.real = false;
  const v = Number(text);
  t.val = Number.isFinite(v) ? v : null;
}
