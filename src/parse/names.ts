/** Name rules (SPEC §3.4) and small string utilities shared by parse and validate. */
import { error, type Diagnostic, type Span } from "../model/diagnostics.js";

export const QSFC_KEYWORDS = ["sfc", "tag", "init", "step", "select", "parallel", "end", "course", "author", "io", "uses", "controller"] as const;

export const ST_KEYWORDS = [
  "AND", "OR", "XOR", "NOT", "MOD", "TRUE", "FALSE", "IF", "THEN", "ELSIF", "ELSE", "END_IF",
  "CASE", "OF", "END_CASE", "FOR", "TO", "BY", "DO", "END_FOR", "WHILE", "END_WHILE",
  "REPEAT", "UNTIL", "END_REPEAT", "EXIT", "RETURN",
] as const;

const KEYWORDS = new Set<string>([...QSFC_KEYWORDS, ...ST_KEYWORDS.map((k) => k.toLowerCase())]);

export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const RESERVED_RE = /^(step|tran|action)_\d+$/i;
export const MAX_NAME_LENGTH = 40;

export function isKeyword(name: string): boolean {
  return KEYWORDS.has(name.toLowerCase());
}

export interface NameCheckOptions {
  /** Also reject generated operand names Step_nnn / Tran_nnn / Action_nnn (E405). */
  reserved?: boolean;
  /** Routine and program names: a qSFC keyword is allowed (`sfc SFC`); ST keywords are not. */
  keywordName?: boolean;
}

/** Check a name against SPEC §3.4. E101 / E102 / E103 / E108 / E405. */
export function checkName(text: string, span: Span, opts: NameCheckOptions = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!/^[A-Za-z_]/.test(text)) {
    out.push(error("E101", span, `\`${text}\` is not a valid name: names start with a letter or \`_\``));
    return out;
  }
  if (!NAME_RE.test(text)) {
    out.push(error("E101", span, `\`${text}\` is not a valid name: use only letters, digits and \`_\``));
    return out;
  }
  if (text.length > MAX_NAME_LENGTH) {
    out.push(error("E102", span, `name \`${text}\` is ${text.length} characters long; the maximum is ${MAX_NAME_LENGTH}`));
  }
  if (text.includes("__") || text.endsWith("_")) {
    out.push(error("E103", span, `name \`${text}\` can't contain \`__\` or end with \`_\` (Studio 5000 rule)`));
  }
  if (isKeyword(text) && !(opts.keywordName && !ST_KEYWORDS.some((k) => k.toLowerCase() === text.toLowerCase()))) {
    out.push(error("E108", span, `\`${text}\` is a keyword and can't be used as a name`));
  }
  if (opts.reserved && RESERVED_RE.test(text)) {
    out.push(error("E405", span, `\`${text}\` is a reserved name (used for generated operands)`));
  }
  return out;
}

/** Optimal string alignment distance (Levenshtein + adjacent transpositions), case-insensitive. */
export function editDistance(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    d.push(new Array<number>(b.length + 1).fill(0));
    d[i]![0] = i;
  }
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** Closest candidate within a small edit distance, or undefined. Ties: first candidate. */
export function closest(target: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  const limit = Math.min(2, Math.max(1, target.length - 1));
  for (const c of candidates) {
    const dist = editDistance(target, c);
    if (dist < bestD) {
      bestD = dist;
      best = c;
    }
  }
  return best !== undefined && bestD <= limit ? best : undefined;
}
