/**
 * ST expressions for the logic checks and the simulation (Phase 4e): a parser to a small tree,
 * an evaluator, and the satisfiability of a Boolean condition. Covers what qSFC conditions and
 * the simulation's minimal ST use: AND OR XOR NOT, comparisons, + - * / MOD **, literals,
 * tags, members (`fill.done`, `t1.DN`), `after 5s`. Anything else parses as "unknown". Pure.
 */
import { READABLE_MEMBERS } from "../model/ast.js";
import { scan, type Tok } from "../tags/lexer.js";

export type Expr =
  | { k: "num"; v: number }
  | { k: "bool"; v: boolean }
  /** A tag, or a member path (`fill.DN`, lower case, readable members written as Studio's). */
  | { k: "var"; path: string; text: string; from: number; to: number }
  | { k: "after"; ms: number; text: string; from: number; to: number }
  | { k: "not"; a: Expr }
  | { k: "neg"; a: Expr }
  | { k: "bin"; op: "AND" | "OR" | "XOR" | "+" | "-" | "*" | "/" | "MOD" | "**"; a: Expr; b: Expr }
  | { k: "cmp"; op: "=" | "<>" | "<" | ">" | "<=" | ">="; a: Expr; b: Expr; from: number; to: number }
  | { k: "unknown"; text: string };

const DUR = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/i;
const UNIT: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000 };

/** Parses an expression; `from` / `to` of vars and comparisons are offsets in `text`. */
export function parseExpr(text: string): Expr {
  const toks = scan([{ text, line: 1, col: 1 }]).toks;
  let i = 0;
  const peek = (): Tok | undefined => toks[i];
  const isKw = (t: Tok | undefined, u: string) => !!t && (t.k === "kw" || t.k === "id") && t.u === u;
  const isOp = (t: Tok | undefined, s: string) => !!t && (t.k === "op" || t.k === "p") && t.t === s;
  let bad = false;

  const or = (): Expr => {
    let a = xor();
    while (isKw(peek(), "OR")) {
      i++;
      a = { k: "bin", op: "OR", a, b: xor() };
    }
    return a;
  };
  const xor = (): Expr => {
    let a = and();
    while (isKw(peek(), "XOR")) {
      i++;
      a = { k: "bin", op: "XOR", a, b: and() };
    }
    return a;
  };
  const and = (): Expr => {
    let a = cmp();
    while (isKw(peek(), "AND") || isOp(peek(), "&")) {
      i++;
      a = { k: "bin", op: "AND", a, b: cmp() };
    }
    return a;
  };
  const cmp = (): Expr => {
    const start = peek();
    let a = add();
    for (;;) {
      const t = peek();
      if (t && t.k === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(t.t)) {
        i++;
        const b = add();
        const last = toks[i - 1]!;
        a = { k: "cmp", op: t.t as "=", a, b, from: (start?.col ?? 1) - 1, to: last.end - 1 };
        continue;
      }
      return a;
    }
  };
  const add = (): Expr => {
    let a = mul();
    for (;;) {
      const t = peek();
      if (isOp(t, "+") || isOp(t, "-")) {
        i++;
        a = { k: "bin", op: t!.t as "+", a, b: mul() };
      } else return a;
    }
  };
  const mul = (): Expr => {
    let a = pow();
    for (;;) {
      const t = peek();
      if (isOp(t, "*") || isOp(t, "/")) {
        i++;
        a = { k: "bin", op: t!.t as "*", a, b: pow() };
      } else if (isKw(t, "MOD")) {
        i++;
        a = { k: "bin", op: "MOD", a, b: pow() };
      } else return a;
    }
  };
  const pow = (): Expr => {
    let a = unary();
    while (isOp(peek(), "**")) {
      i++;
      a = { k: "bin", op: "**", a, b: unary() };
    }
    return a;
  };
  const unary = (): Expr => {
    const t = peek();
    if (isKw(t, "NOT")) {
      i++;
      return { k: "not", a: unary() };
    }
    if (isOp(t, "-")) {
      i++;
      return { k: "neg", a: unary() };
    }
    if (isOp(t, "+")) {
      i++;
      return unary();
    }
    return primary();
  };
  const primary = (): Expr => {
    const t = peek();
    if (!t) {
      bad = true;
      return { k: "unknown", text };
    }
    if (t.k === "num") {
      i++;
      const v = t.val ?? Number(t.t.replace(/_/g, ""));
      if (!Number.isFinite(v)) bad = true;
      return { k: "num", v };
    }
    if (isKw(t, "TRUE") || isKw(t, "FALSE")) {
      i++;
      return { k: "bool", v: t.u === "TRUE" };
    }
    if (isOp(t, "(")) {
      i++;
      const e = or();
      if (isOp(peek(), ")")) i++;
      else bad = true;
      return e;
    }
    if (t.k === "id" && t.u === "AFTER") {
      // `after 5s`: the lexer reads `5s` as a number followed by `s`
      const n = toks[i + 1];
      const u = toks[i + 2];
      const lit = n && u && n.end === u.col ? `${n.t}${u.t}` : n?.t ?? "";
      const m = DUR.exec(lit);
      if (m) {
        i += n && u && n.end === u.col ? 3 : 2;
        return { k: "after", ms: Number(m[1]) * UNIT[m[2]!.toLowerCase()]!, text: text.slice(t.col - 1, toks[i - 1]!.end - 1), from: t.col - 1, to: toks[i - 1]!.end - 1 };
      }
    }
    if (t.k === "id") {
      i++;
      if (isOp(peek(), "(")) {
        bad = true; // function calls: not evaluated
        let depth = 0;
        while (i < toks.length) {
          if (isOp(peek(), "(")) depth++;
          if (isOp(peek(), ")")) depth--;
          i++;
          if (depth === 0) break;
        }
        return { k: "unknown", text };
      }
      let path = t.t.toLowerCase();
      let end = t.end;
      while (isOp(peek(), ".") && toks[i + 1] && (toks[i + 1]!.k === "id" || toks[i + 1]!.k === "kw" || toks[i + 1]!.k === "num")) {
        const m = toks[i + 1]!;
        const member = READABLE_MEMBERS[m.t.toLowerCase()] ?? m.t;
        path += `.${member.toLowerCase()}`;
        end = m.end;
        i += 2;
      }
      return { k: "var", path, text: text.slice(t.col - 1, end - 1), from: t.col - 1, to: end - 1 };
    }
    i++;
    bad = true;
    return { k: "unknown", text };
  };

  const e = or();
  if (bad || i < toks.length) return { k: "unknown", text };
  return e;
}

export function hasUnknown(e: Expr): boolean {
  switch (e.k) {
    case "unknown":
      return true;
    case "not":
    case "neg":
      return hasUnknown(e.a);
    case "bin":
    case "cmp":
      return hasUnknown(e.a) || hasUnknown(e.b);
    default:
      return false;
  }
}

export type Value = number | boolean;
export interface Env {
  /** A tag or member path (lower case). Unknown paths are 0 / FALSE. */
  get(path: string): Value;
  /** `after 5s`: has the step above been active that long? */
  after?(ms: number): boolean;
}

const num = (v: Value): number => (typeof v === "boolean" ? (v ? 1 : 0) : v);
const bool = (v: Value): boolean => (typeof v === "boolean" ? v : v !== 0);

export function evaluate(e: Expr, env: Env): Value {
  switch (e.k) {
    case "num":
      return e.v;
    case "bool":
      return e.v;
    case "var":
      return env.get(e.path);
    case "after":
      return env.after ? env.after(e.ms) : false;
    case "not":
      return !bool(evaluate(e.a, env));
    case "neg":
      return -num(evaluate(e.a, env));
    case "cmp": {
      const a = num(evaluate(e.a, env));
      const b = num(evaluate(e.b, env));
      return e.op === "=" ? a === b : e.op === "<>" ? a !== b : e.op === "<" ? a < b : e.op === ">" ? a > b : e.op === "<=" ? a <= b : a >= b;
    }
    case "bin": {
      if (e.op === "AND") return bool(evaluate(e.a, env)) && bool(evaluate(e.b, env));
      if (e.op === "OR") return bool(evaluate(e.a, env)) || bool(evaluate(e.b, env));
      if (e.op === "XOR") return bool(evaluate(e.a, env)) !== bool(evaluate(e.b, env));
      const a = num(evaluate(e.a, env));
      const b = num(evaluate(e.b, env));
      switch (e.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return b === 0 ? 0 : a / b;
        case "MOD":
          return b === 0 ? 0 : a % b;
        default:
          return a ** b;
      }
    }
    default:
      return false;
  }
}

export const truthy = bool;

// ---- satisfiability (logic checks, SPEC §9 W700-W704) ------------------------------------------

/** An atom of a condition: a Boolean tag / member, an `after`, or a comparison of a tag with a number. */
interface Atoms {
  bools: Set<string>;
  /** Numeric tags compared with constants, and the constants they meet. */
  nums: Map<string, Set<number>>;
}

function collect(e: Expr, out: Atoms): boolean {
  switch (e.k) {
    case "var":
      out.bools.add(e.path);
      return true;
    case "after":
      out.bools.add(`after:${e.ms}`);
      return true;
    case "num":
    case "bool":
      return true;
    case "not":
      return collect(e.a, out);
    case "cmp": {
      const v = e.a.k === "var" && e.b.k === "num" ? [e.a.path, e.b.v] : e.b.k === "var" && e.a.k === "num" ? [e.b.path, e.a.v] : undefined;
      if (!v) return false;
      const set = out.nums.get(v[0] as string) ?? new Set<number>();
      set.add(v[1] as number);
      out.nums.set(v[0] as string, set);
      return true;
    }
    case "bin":
      if (!["AND", "OR", "XOR"].includes(e.op)) return false;
      return collect(e.a, out) && collect(e.b, out);
    default:
      return false;
  }
}

export interface Witness {
  bools: Map<string, boolean>;
  nums: Map<string, number>;
}

/**
 * A valuation that makes every condition of `all` true at once, or null when there is none;
 * undefined when it can't be decided (functions, arithmetic on tags, too many atoms).
 */
export function satisfiable(all: readonly Expr[], maxAtoms = 14): Witness | null | undefined {
  const atoms: Atoms = { bools: new Set(), nums: new Map() };
  for (const e of all) if (!collect(e, atoms)) return undefined;
  // a numeric tag is also used as a Boolean somewhere: undecidable here
  for (const n of atoms.nums.keys()) if (atoms.bools.has(n)) return undefined;
  const bools = [...atoms.bools];
  const nums = [...atoms.nums].map(([name, cs]) => {
    const sorted = [...cs].sort((a, b) => a - b);
    const cand = new Set<number>();
    for (const c of sorted) [c - 1, c - 0.5, c, c + 0.5, c + 1].forEach((x) => cand.add(x));
    return { name, cand: [...cand] };
  });
  let combos = 2 ** bools.length;
  for (const n of nums) combos *= n.cand.length;
  if (bools.length > maxAtoms || combos > 200000) return undefined;
  const valB = new Map<string, boolean>();
  const valN = new Map<string, number>();
  const env: Env = { get: (p) => (valN.has(p) ? valN.get(p)! : (valB.get(p) ?? false)), after: () => false };
  const afterEnv = (ms: number) => valB.get(`after:${ms}`) ?? false;
  env.after = afterEnv;
  const tryNums = (k: number): boolean => {
    if (k === nums.length) return all.every((e) => truthy(evaluate(e, env)));
    for (const c of nums[k]!.cand) {
      valN.set(nums[k]!.name, c);
      if (tryNums(k + 1)) return true;
    }
    return false;
  };
  for (let mask = 0; mask < 2 ** bools.length; mask++) {
    bools.forEach((b, j) => valB.set(b, (mask & (1 << j)) !== 0));
    // a longer `after` can't be true while a shorter one is false
    const afters = bools.filter((b) => b.startsWith("after:")).map((b) => [Number(b.slice(6)), valB.get(b)!] as const);
    if (afters.some(([ms, v]) => v && afters.some(([ms2, v2]) => ms2 < ms && !v2))) continue;
    if (tryNums(0)) return { bools: new Map(valB), nums: new Map(valN) };
  }
  return null;
}

/** A short reading of a witness, limited to the atoms of `of`: `ok AND big AND count = 5`. */
export function describeWitness(w: Witness, of: readonly Expr[]): string {
  const atoms: Atoms = { bools: new Set(), nums: new Map() };
  for (const e of of) collect(e, atoms);
  // the names as written (`Step_001.T`), not the lower-case paths
  const written = new Map<string, string>();
  const names = (e: Expr): void => {
    if (e.k === "var" && !written.has(e.path)) written.set(e.path, e.text);
    if (e.k === "not" || e.k === "neg") names(e.a);
    if (e.k === "bin" || e.k === "cmp") {
      names(e.a);
      names(e.b);
    }
  };
  of.forEach(names);
  const parts: string[] = [];
  for (const b of atoms.bools) {
    const v = w.bools.get(b);
    const name = b.startsWith("after:") ? `after ${Number(b.slice(6)) / 1000}s` : (written.get(b) ?? b);
    parts.push(v ? name : `NOT ${name}`);
  }
  for (const n of atoms.nums.keys()) parts.push(`${written.get(n) ?? n} = ${w.nums.get(n)}`);
  return parts.join(" AND ");
}
