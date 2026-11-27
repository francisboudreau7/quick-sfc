/**
 * The simulation's minimal ST (Phase 4e, decided 2026-11-27): assignments (`:=`, `[:=]`),
 * IF / ELSIF / ELSE / END_IF, `call name;` and `JSR(name, …);`. Any other statement is kept as
 * "skipped" (the simulator notes it once). Parsed once, run every scan. Pure.
 */
import { scan, type Tok } from "../tags/lexer.js";
import { parseExpr, type Expr } from "./expr.js";

export type Stmt =
  | { k: "assign"; target: string; text: string; retentive: boolean; value: Expr; line: number }
  | { k: "if"; branches: Array<{ cond: Expr; body: Stmt[] }>; otherwise: Stmt[]; line: number }
  | { k: "call"; routine: string; line: number }
  | { k: "skip"; text: string; line: number };

/** `lines[i]` is source line `firstLine + i`. */
export function parseStatements(lines: readonly string[], firstLine = 1): Stmt[] {
  const text = lines.join("\n");
  const toks = scan(lines.map((t, i) => ({ text: t, line: firstLine + i, col: 1 }))).toks;
  const src = (a: Tok, b: Tok): string => {
    if (a.line === b.line) return lines[a.line - firstLine]!.slice(a.col - 1, b.end - 1);
    return toks.slice(toks.indexOf(a), toks.indexOf(b) + 1).map((t) => t.t).join(" ");
  };
  void text;
  let i = 0;
  const peek = () => toks[i];
  const isKw = (t: Tok | undefined, u: string) => !!t && (t.k === "kw" || t.k === "id") && t.u === u;
  const isP = (t: Tok | undefined, s: string) => !!t && (t.k === "p" || t.k === "op") && t.t === s;

  /** The expression text up to (not including) a stop token, as a parsed Expr. */
  const exprUntil = (stop: (t: Tok) => boolean): Expr => {
    const start = i;
    let depth = 0;
    while (i < toks.length) {
      const t = toks[i]!;
      if (isP(t, "(")) depth++;
      if (isP(t, ")")) depth--;
      if (depth <= 0 && stop(t)) break;
      i++;
    }
    if (i === start) return { k: "unknown", text: "" };
    return parseExpr(src(toks[start]!, toks[i - 1]!));
  };
  const skipStatement = (line: number): Stmt => {
    const start = i;
    while (i < toks.length && !isP(toks[i], ";")) i++;
    const last = toks[Math.min(i, toks.length - 1)]!;
    if (i < toks.length) i++;
    return { k: "skip", text: start < toks.length ? src(toks[start]!, last) : "", line };
  };

  const block = (ends: string[]): Stmt[] => {
    const out: Stmt[] = [];
    while (i < toks.length && !ends.some((e) => isKw(peek(), e))) {
      const s = statement();
      if (s) out.push(s);
    }
    return out;
  };

  const statement = (): Stmt | undefined => {
    const t = peek()!;
    if (isP(t, ";")) {
      i++;
      return undefined;
    }
    if (isKw(t, "IF")) {
      i++;
      const branches: Array<{ cond: Expr; body: Stmt[] }> = [];
      const cond = exprUntil((x) => isKw(x, "THEN"));
      i++;
      branches.push({ cond, body: block(["ELSIF", "ELSE", "END_IF"]) });
      let otherwise: Stmt[] = [];
      while (isKw(peek(), "ELSIF")) {
        i++;
        const c = exprUntil((x) => isKw(x, "THEN"));
        i++;
        branches.push({ cond: c, body: block(["ELSIF", "ELSE", "END_IF"]) });
      }
      if (isKw(peek(), "ELSE")) {
        i++;
        otherwise = block(["END_IF"]);
      }
      if (isKw(peek(), "END_IF")) i++;
      if (isP(peek(), ";")) i++;
      return { k: "if", branches, otherwise, line: t.line };
    }
    if (t.k === "id" && t.u === "CALL" && toks[i + 1]?.k === "id") {
      const name = toks[i + 1]!.t;
      i += 2;
      if (isP(peek(), ";")) i++;
      return { k: "call", routine: name, line: t.line };
    }
    if (t.k === "id" && t.u === "JSR" && isP(toks[i + 1], "(") && toks[i + 2]?.k === "id") {
      const name = toks[i + 2]!.t;
      i += 3;
      let depth = 1;
      while (i < toks.length && depth > 0) {
        if (isP(peek(), "(")) depth++;
        if (isP(peek(), ")")) depth--;
        i++;
      }
      if (isP(peek(), ";")) i++;
      return { k: "call", routine: name, line: t.line };
    }
    // assignment: a tag or a member path, then := or [:=]
    if (t.k === "id") {
      let j = i + 1;
      let target = t.t.toLowerCase();
      while (isP(toks[j], ".") && toks[j + 1] && (toks[j + 1]!.k === "id" || toks[j + 1]!.k === "kw")) {
        target += `.${toks[j + 1]!.t.toLowerCase()}`;
        j += 2;
      }
      const op = toks[j];
      if (op && op.k === "op" && (op.t === ":=" || op.t === "[:=]")) {
        const start = i;
        i = j + 1;
        const value = exprUntil((x) => isP(x, ";"));
        const end = toks[i - 1]!;
        if (isP(peek(), ";")) i++;
        return { k: "assign", target, text: src(toks[start]!, end), retentive: op.t === ":=", value, line: t.line };
      }
    }
    return skipStatement(t.line);
  };

  const out: Stmt[] = [];
  while (i < toks.length) {
    const s = statement();
    if (s) out.push(s);
  }
  return out;
}

/** Every tag a statement list may write (lower case). */
export function targets(stmts: readonly Stmt[], out = new Set<string>()): Set<string> {
  for (const s of stmts) {
    if (s.k === "assign") out.add(s.target);
    if (s.k === "if") {
      for (const b of s.branches) targets(b.body, out);
      targets(s.otherwise, out);
    }
  }
  return out;
}
