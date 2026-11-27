/**
 * Long transition conditions in Studio 5000 (Phase 4d+, STATION2 import 2026-11-27): Studio draws
 * each ST line of a condition on one row to the right of the transition, so a long condition
 * runs into the next leg. The export breaks it into lines before `AND` / `OR` / `XOR` / `&`
 * (SPEC §8.2), and the layout makes the column and the row room for the lines it gets.
 */

/** A condition line longer than this is broken, where it can be. */
export const CONDITION_WRAP = 38;

const OPERATOR = /^(and|or|xor)(?![A-Za-z0-9_])|^&/i;

/**
 * The condition as Studio lines: broken before an operator that follows exactly one space,
 * outside strings and comments, so that `lines.join(" ")` gives the text back (the import joins
 * condition lines that way). A part with no such operator stays whole, however long.
 */
export function wrapCondition(text: string, max = CONDITION_WRAP): string[] {
  if (text.length <= max) return [text];
  const breaks: number[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "/" && text[i + 1] === "/") break; // a comment runs to the end
    if (c === "(" && text[i + 1] === "*") {
      const e = text.indexOf("*)", i + 2);
      i = e < 0 ? text.length : e + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "$" ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (i >= 2 && text[i - 1] === " " && text[i - 2] !== " " && OPERATOR.test(text.slice(i)) && !/[A-Za-z0-9_]/.test(text[i - 1]!)) {
      breaks.push(i);
    }
    i++;
  }
  const lines: string[] = [];
  let start = 0;
  let last = -1;
  for (const b of breaks) {
    if (b - 1 - start > max && last > start) {
      lines.push(text.slice(start, last - 1));
      start = last;
    }
    last = b;
  }
  if (text.length - start > max && last > start) {
    lines.push(text.slice(start, last - 1));
    start = last;
  }
  lines.push(text.slice(start));
  return lines;
}
