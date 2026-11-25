import { key } from "../model/ast.js";

const NUM_RE = /\d[0-9A-Za-z_]*(?:#[0-9A-Za-z_]+)?(?:\.\d+(?:[eE][+-]?\d+)?)?/y;
const ID_RE = /[A-Za-z_][A-Za-z0-9_]*/y;

/**
 * Rewrites `stepname.member` to `operand.member` (SPEC §8.4). Identifier-aware, case-insensitive,
 * skips ST strings and comments; every other byte is copied unchanged.
 */
export function rewriteStepRefs(text: string, operandByStepKey: Map<string, string>): string {
  const n = text.length;
  let out = "";
  let i = 0;
  while (i < n) {
    const c = text.charAt(i);
    const c2 = text.charAt(i + 1);
    if (c === "/" && c2 === "/") {
      let j = text.indexOf("\n", i);
      if (j < 0) j = n;
      out += text.slice(i, j);
      i = j;
      continue;
    }
    if (c === "(" && c2 === "*") {
      const e = text.indexOf("*)", i + 2);
      const j = e < 0 ? n : e + 2;
      out += text.slice(i, j);
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        const d = text.charAt(j);
        if (d === "$") {
          j += 2;
          continue;
        }
        if (d === c) {
          j++;
          break;
        }
        if (d === "\n") break; // an unterminated string ends with its line
        j++;
      }
      if (j > n) j = n;
      out += text.slice(i, j);
      i = j;
      continue;
    }
    if (c >= "0" && c <= "9") {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(text);
      const j = i + (m ? m[0].length : 1);
      out += text.slice(i, j);
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      ID_RE.lastIndex = i;
      const m = ID_RE.exec(text);
      const word = m ? m[0] : c;
      const j = i + word.length;
      if (text.charAt(j) === "#") {
        // typed literal (T#5s): copy it whole
        let k = j + 1;
        while (k < n && /[0-9A-Za-z_.]/.test(text.charAt(k))) k++;
        out += text.slice(i, k);
        i = k;
        continue;
      }
      const operand = operandByStepKey.get(key(word));
      out += operand !== undefined && !precededByDot(text, i) && followedByMember(text, j) ? operand : word;
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function precededByDot(text: string, i: number): boolean {
  let k = i - 1;
  while (k >= 0 && (text.charAt(k) === " " || text.charAt(k) === "\t")) k--;
  return k >= 0 && text.charAt(k) === "." && text.charAt(k - 1) !== ".";
}

function followedByMember(text: string, j: number): boolean {
  let k = j;
  while (k < text.length && (text.charAt(k) === " " || text.charAt(k) === "\t")) k++;
  if (text.charAt(k) !== "." || text.charAt(k + 1) === ".") return false;
  k++;
  while (k < text.length && (text.charAt(k) === " " || text.charAt(k) === "\t")) k++;
  return /[A-Za-z_]/.test(text.charAt(k));
}
