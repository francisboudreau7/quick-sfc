/**
 * qSFC syntax highlighting without CodeMirror: a pure, line-based tokenizer (the language
 * is line-based, SPEC §3.2), so each line is classified on its own. app/editor.ts wraps it
 * in a CodeMirror StreamLanguage. Unit-tested in test/app.
 */

export type TokKind =
  | "kw" // qSFC keyword at line start, `--`, `|`
  | "stkw" // ST keyword (AND, IF, TRUE...)
  | "def" // name defined on this line: step, tag, sfc header
  | "label" // transition name (`name:`)
  | "target" // jump target after `->`
  | "arrow" // `->`
  | "duration" // 5s, 1m30s
  | "string"
  | "comment"
  | "number"
  | "ident" // tag or other identifier in ST
  | "member" // `.DN` after an identifier
  | "func" // identifier followed by `(`
  | "type" // type after `tag name :`
  | "op"
  | "punct";

export interface Token {
  /** 0-based, end exclusive. */
  from: number;
  to: number;
  kind: TokKind;
}

/** CodeMirror / @lezer/highlight tag names (StreamLanguage token strings). */
export const TOKEN_STYLE: Readonly<Record<TokKind, string>> = {
  kw: "keyword",
  stkw: "operatorKeyword",
  def: "variableName.definition",
  label: "labelName",
  target: "variableName.special",
  arrow: "controlOperator",
  duration: "unit",
  string: "string",
  comment: "lineComment",
  number: "number",
  ident: "variableName",
  member: "propertyName",
  func: "function.variableName",
  type: "typeName",
  op: "operator",
  punct: "punctuation",
};

export const QSFC_KEYWORDS = ["sfc", "tag", "init", "step", "select", "parallel", "end"] as const;

export const ST_KEYWORDS = new Set([
  "AND", "OR", "XOR", "NOT", "MOD", "TRUE", "FALSE", "IF", "THEN", "ELSIF", "ELSE", "END_IF",
  "CASE", "OF", "END_CASE", "FOR", "TO", "BY", "DO", "END_FOR", "WHILE", "END_WHILE",
  "REPEAT", "UNTIL", "END_REPEAT", "EXIT", "RETURN",
]);

const WORD = /[A-Za-z_][A-Za-z0-9_]*/y;
const SPACE = /[ \t]+/y;
const DURATION = /(?:\d+(?:ms|s|m|h))+(?![A-Za-z0-9_])/y;
const NUMBER = /\d[0-9_]*(?:#[0-9A-Fa-f_]+|(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;
const OPS = [":=", "<>", "<=", ">=", "**", "+", "-", "*", "/", "=", "<", ">", "&"];

function at(re: RegExp, s: string, i: number): string | undefined {
  re.lastIndex = i;
  const m = re.exec(s);
  return m ? m[0] : undefined;
}

/** End of a `"..."` qSFC string starting at `i` (handles `\"` and `\\`); unclosed runs to `end`. */
function qString(s: string, i: number, end = s.length): number {
  let j = i + 1;
  while (j < end) {
    const c = s[j];
    if (c === "\\") j += 2;
    else if (c === '"') return j + 1;
    else j++;
  }
  return end;
}

/** End of an ST `'...'` string (`$'` escapes a quote); unclosed runs to `end`. */
function stString(s: string, i: number, end = s.length): number {
  const q = s[i];
  let j = i + 1;
  while (j < end) {
    const c = s[j];
    if (c === "$") j += 2;
    else if (c === q) return j + 1;
    else j++;
  }
  return end;
}

/** Tokens of ST text in s[from, to). Comments `//` run to `to`. */
export function tokenizeST(s: string, from: number, to: number, out: Token[] = []): Token[] {
  let i = from;
  let prevMeaningful: Token | undefined;
  const push = (t: Token): void => {
    out.push(t);
    prevMeaningful = t;
  };
  while (i < to) {
    const c = s[i]!;
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      out.push({ from: i, to, kind: "comment" });
      break;
    }
    if (c === "(" && s[i + 1] === "*") {
      const close = s.indexOf("*)", i + 2);
      const e = close < 0 || close + 2 > to ? to : close + 2;
      out.push({ from: i, to: e, kind: "comment" });
      i = e;
      continue;
    }
    if (c === "'" || c === '"') {
      const e = stString(s, i, to);
      push({ from: i, to: e, kind: "string" });
      i = e;
      continue;
    }
    if (c === "[" && s.startsWith("[:=]", i)) {
      push({ from: i, to: i + 4, kind: "op" });
      i += 4;
      continue;
    }
    const w = at(WORD, s, i);
    if (w) {
      const e = i + w.length;
      let kind: TokKind;
      if (prevMeaningful?.kind === "punct" && s[prevMeaningful.from] === "." && prevMeaningful.to === i) kind = "member";
      else if (ST_KEYWORDS.has(w.toUpperCase())) kind = "stkw";
      else {
        let k = e;
        while (s[k] === " " || s[k] === "\t") k++;
        kind = s[k] === "(" ? "func" : "ident";
      }
      push({ from: i, to: Math.min(e, to), kind });
      i = e;
      continue;
    }
    const n = at(NUMBER, s, i);
    if (n) {
      push({ from: i, to: Math.min(i + n.length, to), kind: "number" });
      i += n.length;
      continue;
    }
    const op = OPS.find((o) => s.startsWith(o, i) && i + o.length <= to);
    if (op) {
      push({ from: i, to: i + op.length, kind: "op" });
      i += op.length;
      continue;
    }
    push({ from: i, to: i + 1, kind: "punct" });
    i++;
  }
  return out;
}

/** Index of `//` outside a qSFC string, or -1. */
function commentStart(s: string, from: number): number {
  let i = from;
  while (i < s.length) {
    if (s[i] === '"') i = qString(s, i);
    else if (s[i] === "/" && s[i + 1] === "/") return i;
    else i++;
  }
  return -1;
}

/**
 * Index of `->` (the jump) in a condition: outside ST strings and before `//`. -1 if none.
 */
export function jumpArrow(s: string, from: number, to = s.length): number {
  let i = from;
  while (i < to) {
    const c = s[i];
    if (c === "'" || c === '"') i = stString(s, i, to);
    else if (c === "/" && s[i + 1] === "/") return -1;
    else if (c === "-" && s[i + 1] === ">") return i;
    else i++;
  }
  return -1;
}

/** End of the condition (before `//`, outside strings). */
function conditionEnd(s: string, from: number): number {
  let i = from;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"') i = stString(s, i);
    else if (c === "/" && s[i + 1] === "/") return i;
    else i++;
  }
  return s.length;
}

export type LineKind = "blank" | "comment" | "header" | "tag" | "step" | "transition" | "branch" | "bar" | "end" | "action";

/** What the line is, from its first word (SPEC §3.2), with the keyword's position. */
export function lineKind(line: string): { kind: LineKind; start: number; word?: string } {
  const start = /^[ \t]*/.exec(line)![0].length;
  const t = line.slice(start);
  if (t.trim() === "") return { kind: "blank", start };
  if (t.startsWith("//")) return { kind: "comment", start };
  if (t.startsWith("--")) return { kind: "transition", start };
  if (t.startsWith("|")) return { kind: "bar", start };
  const word = /^[A-Za-z_]\w*/.exec(t)?.[0];
  switch (word?.toLowerCase()) {
    case "sfc":
      return { kind: "header", start, word };
    case "tag":
      return { kind: "tag", start, word };
    case "init":
    case "step":
      return { kind: "step", start, word };
    case "select":
    case "parallel":
      return { kind: "branch", start, word };
    case "end":
      return { kind: "end", start, word };
    default:
      return { kind: "action", start };
  }
}

/** Tokens of one source line (no line break). Gaps between tokens are plain text. */
export function tokenizeLine(line: string): Token[] {
  const out: Token[] = [];
  const { kind, start, word } = lineKind(line);
  switch (kind) {
    case "blank":
      return out;
    case "comment":
      out.push({ from: start, to: line.length, kind: "comment" });
      return out;
    case "action":
      return tokenizeST(line, start, line.length, out);
    case "bar":
      out.push({ from: start, to: start + 1, kind: "kw" });
      rest(line, start + 1, out);
      return out;
    case "transition":
      transition(line, start, out);
      return out;
  }
  // Structure lines with a keyword.
  const kwEnd = start + word!.length;
  out.push({ from: start, to: kwEnd, kind: "kw" });
  if (kind === "branch" || kind === "end") {
    rest(line, kwEnd, out);
    return out;
  }
  const cEnd = (() => {
    const c = commentStart(line, kwEnd);
    return c < 0 ? line.length : c;
  })();
  let i = kwEnd;
  let named = false;
  let typed = false;
  let colon = false;
  while (i < cEnd) {
    const sp = at(SPACE, line, i);
    if (sp) {
      i += sp.length;
      continue;
    }
    const c = line[i]!;
    if (c === '"') {
      const e = qString(line, i, cEnd);
      out.push({ from: i, to: e, kind: "string" });
      i = e;
      continue;
    }
    if (kind === "step" && named) {
      const d = at(DURATION, line, i);
      if (d) {
        out.push({ from: i, to: i + d.length, kind: "duration" });
        i += d.length;
        continue;
      }
      const n = at(NUMBER, line, i);
      if (n) {
        out.push({ from: i, to: i + n.length, kind: "number" });
        i += n.length;
        continue;
      }
    }
    if (kind === "tag" && named && c === ":") {
      out.push({ from: i, to: i + 1, kind: "punct" });
      colon = true;
      i++;
      continue;
    }
    const w = at(WORD, line, i);
    if (w) {
      let k: TokKind = "ident";
      if (!named) k = "def";
      else if (kind === "tag" && colon && !typed) {
        k = "type";
        typed = true;
      }
      named = true;
      out.push({ from: i, to: i + w.length, kind: k });
      i += w.length;
      continue;
    }
    // Anything else (a stray character): leave it plain, one character at a time.
    i++;
  }
  if (cEnd < line.length) out.push({ from: cEnd, to: line.length, kind: "comment" });
  return out;
}

/** After `select` / `end` / `|`: only a comment is meaningful. */
function rest(line: string, from: number, out: Token[]): void {
  const c = commentStart(line, from);
  if (c >= 0) out.push({ from: c, to: line.length, kind: "comment" });
}

/** `-- [name:] condition [-> target] [// comment]` */
function transition(line: string, start: number, out: Token[]): void {
  out.push({ from: start, to: start + 2, kind: "kw" });
  let i = start + 2;
  while (line[i] === " " || line[i] === "\t") i++;
  // Optional name: an identifier followed by `:` but not `:=`.
  const w = at(WORD, line, i);
  if (w) {
    let k = i + w.length;
    while (line[k] === " " || line[k] === "\t") k++;
    if (line[k] === ":" && line[k + 1] !== "=") {
      out.push({ from: i, to: i + w.length, kind: "label" });
      out.push({ from: k, to: k + 1, kind: "punct" });
      i = k + 1;
    }
  }
  const end = conditionEnd(line, i);
  const arrow = jumpArrow(line, i, end);
  if (arrow < 0) {
    tokenizeST(line, i, end, out);
  } else {
    tokenizeST(line, i, arrow, out);
    out.push({ from: arrow, to: arrow + 2, kind: "arrow" });
    let j = arrow + 2;
    while (j < end) {
      const sp = at(SPACE, line, j);
      if (sp) {
        j += sp.length;
        continue;
      }
      const t = at(WORD, line, j);
      if (t) {
        out.push({ from: j, to: j + t.length, kind: out[out.length - 1]?.kind === "arrow" ? "target" : "ident" });
        j += t.length;
        continue;
      }
      j++;
    }
  }
  if (end < line.length) out.push({ from: end, to: line.length, kind: "comment" });
}

/** The token that contains position `pos` (a cursor sits inside when from < pos <= to). */
export function tokenBefore(tokens: readonly Token[], pos: number): Token | undefined {
  return tokens.find((t) => t.from < pos && pos <= t.to);
}

/**
 * Indentation (in columns) for a new line typed after `prev` (the previous non-blank
 * line): action lines go under their step, legs inside `select` / `parallel` / `|`.
 * Indentation never changes the meaning of a qSFC file (SPEC §3.2); this is only comfort.
 */
export function indentAfter(prev: string | undefined, unit = 2): number {
  if (prev === undefined) return 0;
  const width = (/^[ \t]*/.exec(prev)![0]).replace(/\t/g, "    ").length;
  switch (lineKind(prev).kind) {
    case "step":
    case "branch":
    case "bar":
      return width + unit;
    case "header":
    case "tag":
      return 0;
    default:
      return width;
  }
}

const widthOf = (line: string): number => (/^[ \t]*/.exec(line)![0]).replace(/\t/g, "    ").length;

/**
 * Indentation for a structure line being typed (`--`, `step`, `init`, `end`, `|`), given
 * the non-blank lines above it, nearest first. Transitions and steps line up with the
 * step above (not its actions); `end` and `|` line up with their `select`/`parallel`.
 * Returns undefined for other lines (keep `indentAfter`).
 */
export function indentStructure(current: string, above: readonly string[], unit = 2): number | undefined {
  const kind = lineKind(current).kind;
  if (kind === "end" || kind === "bar") {
    let depth = 0;
    for (const l of above) {
      const k = lineKind(l).kind;
      if (k === "end") depth++;
      else if (k === "branch") {
        if (depth === 0) return widthOf(l);
        depth--;
      }
    }
    return 0;
  }
  if (kind !== "transition" && kind !== "step") return undefined;
  const prev = above[0];
  if (prev === undefined) return 0;
  if (lineKind(prev).kind !== "action") return indentAfter(prev, unit) - (lineKind(prev).kind === "step" && kind === "transition" ? unit : 0);
  for (const l of above) {
    if (lineKind(l).kind === "step") return widthOf(l);
    if (lineKind(l).kind !== "action" && lineKind(l).kind !== "comment") break;
  }
  return Math.max(0, widthOf(prev) - unit);
}
