/**
 * Tag analysis (SPEC §7, §9.2 E400-E410, W302, W400-W404): scans every action and condition,
 * creates tags, infers their types and reports ST slips.
 */
import {
  type ActionLine,
  type ActionNode,
  type AfterTerm,
  type Chart,
  type IoEntry,
  type ProgramNode,
  type SourceText,
  type StepNode,
  type Sugar,
  type TagDecl,
  type TagType,
  isBitAddress,
  key,
  READABLE_MEMBERS,
  walk,
} from "../model/ast.js";
import { type Diagnostic, type Span, error, sortDiagnostics, warning } from "../model/diagnostics.js";
import type { TagInfo } from "../model/graph.js";
import { type LineIn, type Scan, type Tok, scan } from "./lexer.js";

const STEP_MEMBERS = [
  "X", "FS", "SA", "LS", "DN", "OV", "T", "PRE", "TMax", "Count", "Reset", "PauseTimer",
  "AlarmEn", "AlarmLow", "AlarmHigh", "LimitLow", "LimitHigh", "Status",
];
/** Readable members (SPEC §7.3, Phase 4c): `.active` `.done` `.time` `.first`. */
const READABLE = Object.keys(READABLE_MEMBERS);
const MEMBER_BY_KEY = new Map<string, string>([
  ...STEP_MEMBERS.map((m): [string, string] => [m.toLowerCase(), m]),
  ...Object.entries(READABLE_MEMBERS),
]);

const QSFC_KEYWORDS = new Set([
  "program", "sfc", "st", "call", "tag", "init", "step", "select", "parallel", "end", "course", "author", "io",
]);
const RESERVED_RE = /^(step|tran|action)_\d+$/i;
const MAX_TAG_NAME = 40;

type EvType = "BOOL" | "DINT" | "REAL";

interface Use {
  name: string;
  span: Span;
}
interface Ev {
  type: EvType;
  /** Weak evidence: only `0`/`1` assigned (compatible with every numeric type). */
  weak: boolean;
  span: Span;
  tag: string;
}
interface Rec {
  key: string;
  uses: Use[];
  decls: TagDecl[];
  ev: Ev[];
  /** The `io` line mapping this tag (SPEC §7.6), the first one when it is mapped twice (E415). */
  io?: IoEntry;
}
interface Ref {
  key: string;
  name: string;
  span: Span;
}
type Cls = "tag" | "arith" | "bool" | "lit" | "call" | "unk";
interface E {
  cls: Cls;
  tag?: Ref;
  /** arith: tags directly under the arithmetic expression */
  tags: Ref[];
  /** contains a decimal literal */
  real: boolean;
  lit?: "int01" | "int" | "real" | "bool" | "other";
}
type SegKind = "stmt" | "bool" | "int" | "for";
interface Seg {
  toks: Tok[];
  kind: SegKind;
  semi?: Tok;
}

const spanOf = (t: Tok): Span => ({ line: t.line, col: t.col, endLine: t.line, endCol: t.end });
const cmpSpan = (a: Span, b: Span): number => a.line - b.line || a.col - b.col;

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] ?? 0;
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      prev[j] = Math.min(up + 1, (prev[j - 1] ?? 0) + 1, diag + cost);
      diag = up;
    }
  }
  return prev[b.length] ?? 0;
}

/** Closest candidate within `max` edits, case-insensitive; ties keep the first. */
function closest(name: string, candidates: string[], max: number): string | undefined {
  let best: string | undefined;
  let bestD = max + 1;
  for (const c of candidates) {
    const d = distance(name.toLowerCase(), c.toLowerCase());
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/** A `call name;` statement or a `JSR(name, ...)` call found in the ST (SPEC §4.5). */
export interface CallRef {
  /** Called routine, as written. */
  name: string;
  span: Span;
  via: "call" | "jsr";
  /** Routine the call is written in (as written; "" for a header-less first routine). */
  from: string;
}

export interface TagAnalysis {
  tags: TagInfo[];
  diagnostics: Diagnostic[];
  /** Every routine call, in file order. Checked against the routines by src/validate. */
  calls: CallRef[];
}

/**
 * Analyzes the tags of a chart or of a whole program (every SFC routine and ST routine;
 * one namespace, SPEC §3.4 and §4.5).
 */
export function analyzeTags(input: Chart | ProgramNode): TagAnalysis {
  const program: ProgramNode =
    "routines" in input ? input : { routines: [{ kind: "sfc", chart: input }], tagDecls: input.tagDecls };
  const charts = program.routines.flatMap((r) => (r.kind === "sfc" ? [r.chart] : []));
  const diags: Diagnostic[] = [];
  const calls: CallRef[] = [];
  const recs = new Map<string, Rec>();
  const parent = new Map<string, string>();

  // ---- namespaces -------------------------------------------------------------------------
  const stepsByKey = new Map<string, { name: string; presetMs?: number }>();
  const transKeys = new Set<string>();
  const routineKeys = new Set<string>();
  for (const r of program.routines) {
    const name = r.kind === "sfc" ? r.name?.text : r.name.text;
    if (name) routineKeys.add(key(name));
  }
  for (const chart of charts) {
    for (const el of walk(chart.body)) {
      if (el.kind === "step") {
        if (!stepsByKey.has(key(el.name.text))) stepsByKey.set(key(el.name.text), { name: el.name.text, presetMs: el.presetMs });
      } else if (el.kind === "transition") transKeys.add(key(el.name.text));
    }
  }
  /** Routine the unit being analyzed belongs to. */
  let currentRoutine = "";

  const getRec = (k: string): Rec => {
    let r = recs.get(k);
    if (!r) {
      r = { key: k, uses: [], decls: [], ev: [] };
      recs.set(k, r);
      parent.set(k, k);
    }
    return r;
  };
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r) ?? r;
    return r;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };

  // ---- declarations -----------------------------------------------------------------------
  const declType = new Map<string, TagType>();
  for (const d of program.tagDecls) {
    const k = key(d.name.text);
    const r = getRec(k);
    r.decls.push(d);
    if (d.type) {
      const prev = declType.get(k);
      if (!prev) declType.set(k, d.type);
      else if (prev !== d.type) {
        const first = r.decls.find((x) => x.type === prev);
        diags.push(
          error(
            "E408",
            d.name.span,
            `tag \`${d.name.text}\` declared twice with different types (${prev} at line ${first?.name.span.line ?? "?"}, ${d.type} here)`,
            "keep a single `tag` line with the right type",
          ),
        );
      }
    }
  }

  // ---- io block (SPEC §7.6) ---------------------------------------------------------------
  // An I/O point makes its tag exist (an alias tag). A bit address is BOOL evidence.
  const ioByKey = new Map<string, IoEntry>();
  for (const e of program.io ?? []) {
    const k = key(e.name.text);
    const prev = ioByKey.get(k);
    if (prev) {
      diags.push(
        error("E415", e.name.span, `\`${e.name.text}\` is already mapped to \`${prev.address.text}\` (line ${prev.span.line})`,
          "keep one `io` line per tag"),
      );
      continue;
    }
    ioByKey.set(k, e);
    const r = getRec(k);
    r.io = e;
    if (!isBitAddress(e.address.text)) continue;
    const declared = declType.get(k);
    if (declared && declared !== "BOOL") {
      const d = r.decls.find((x) => x.type === declared);
      diags.push(
        error("E414", e.address.span,
          `\`${e.name.text}\` is mapped to the bit \`${e.address.text}\` but declared as ${declared} (line ${d?.name.span.line ?? "?"})`,
          "a bit is a BOOL: remove the type from the `tag` line, or map a word address"),
      );
      continue;
    }
    r.ev.push({ type: "BOOL", weak: false, span: e.address.span, tag: e.name.text });
  }

  // ---- evidence ---------------------------------------------------------------------------
  const use = (t: Tok): Ref => {
    const k = key(t.t);
    getRec(k).uses.push({ name: t.t, span: spanOf(t) });
    return { key: k, name: t.t, span: spanOf(t) };
  };
  const evid = (r: Ref, type: EvType, weak = false): void => {
    getRec(r.key).ev.push({ type, weak, span: r.span, tag: r.name });
  };

  // ---- expression parsing -----------------------------------------------------------------
  const E_UNK = (): E => ({ cls: "unk", tags: [], real: false });
  const numericTags = (e: E): Ref[] => (e.cls === "tag" && e.tag ? [e.tag] : e.cls === "arith" ? e.tags : []);
  const emitNumeric = (e: E, real: boolean): void => {
    for (const r of numericTags(e)) evid(r, real ? "REAL" : "DINT");
  };
  const consumeBool = (e: E): void => {
    if (e.cls === "tag" && e.tag) evid(e.tag, "BOOL");
    else if (e.cls === "arith") emitNumeric(e, e.real);
  };
  const consumeInt = (e: E): void => {
    if (e.cls === "tag" && e.tag) evid(e.tag, "DINT");
    else if (e.cls === "arith") emitNumeric(e, e.real);
  };
  const consumeArg = (e: E): void => {
    if (e.cls === "arith") emitNumeric(e, e.real);
  };

  class Parser {
    pos = 0;
    constructor(
      readonly toks: Tok[],
      readonly sc: Scan,
    ) {}

    peek(): Tok | undefined {
      return this.toks[this.pos];
    }
    isP(t: Tok | undefined, s: string): boolean {
      return t !== undefined && t.k === "p" && t.t === s;
    }
    isOp(t: Tok | undefined, s: string): boolean {
      return t !== undefined && t.k === "op" && t.t === s;
    }
    isKw(t: Tok | undefined, s: string): boolean {
      return t !== undefined && t.k === "kw" && t.u === s;
    }

    top(): E[] {
      const out: E[] = [];
      while (this.pos < this.toks.length) {
        const before = this.pos;
        out.push(this.or());
        if (this.pos === before) this.pos++;
      }
      return out;
    }

    or(): E {
      let l = this.xor();
      while (this.isKw(this.peek(), "OR")) {
        this.pos++;
        const r = this.xor();
        consumeBool(l);
        consumeBool(r);
        l = { cls: "bool", tags: [], real: false };
      }
      return l;
    }
    xor(): E {
      let l = this.and();
      while (this.isKw(this.peek(), "XOR")) {
        this.pos++;
        const r = this.and();
        consumeBool(l);
        consumeBool(r);
        l = { cls: "bool", tags: [], real: false };
      }
      return l;
    }
    and(): E {
      let l = this.eq();
      while (this.isKw(this.peek(), "AND") || this.isOp(this.peek(), "&")) {
        this.pos++;
        const r = this.eq();
        consumeBool(l);
        consumeBool(r);
        l = { cls: "bool", tags: [], real: false };
      }
      return l;
    }
    eq(): E {
      let l = this.rel();
      while (this.isOp(this.peek(), "=") || this.isOp(this.peek(), "<>")) {
        this.pos++;
        const r = this.rel();
        const real = l.real || r.real;
        const side = (s: E, o: E): void => {
          if (s.cls === "tag" && s.tag) {
            let t: EvType | undefined;
            if (real) t = "REAL";
            else if (o.lit === "int") t = "DINT";
            else if (o.lit === "bool" || o.cls === "bool") t = "BOOL";
            else if (o.cls === "arith") t = "DINT";
            if (t) evid(s.tag, t);
            else if (o.cls === "tag" && o.tag) union(s.tag.key, o.tag.key);
          } else if (s.cls === "arith") emitNumeric(s, real);
        };
        side(l, r);
        side(r, l);
        l = { cls: "bool", tags: [], real: false };
      }
      return l;
    }
    rel(): E {
      let l = this.add();
      for (;;) {
        const t = this.peek();
        if (!(this.isOp(t, "<") || this.isOp(t, ">") || this.isOp(t, "<=") || this.isOp(t, ">="))) break;
        this.pos++;
        const r = this.add();
        const real = l.real || r.real;
        emitNumeric(l, real);
        emitNumeric(r, real);
        l = { cls: "bool", tags: [], real: false };
      }
      return l;
    }
    arith(l: E, r: E): E {
      return { cls: "arith", tags: [...numericTags(l), ...numericTags(r)], real: l.real || r.real };
    }
    add(): E {
      let l = this.mul();
      while (this.isOp(this.peek(), "+") || this.isOp(this.peek(), "-")) {
        this.pos++;
        l = this.arith(l, this.mul());
      }
      return l;
    }
    mul(): E {
      let l = this.pow();
      while (this.isOp(this.peek(), "*") || this.isOp(this.peek(), "/") || this.isKw(this.peek(), "MOD")) {
        this.pos++;
        l = this.arith(l, this.pow());
      }
      return l;
    }
    pow(): E {
      let l = this.unary();
      while (this.isOp(this.peek(), "**")) {
        this.pos++;
        l = this.arith(l, this.unary());
      }
      return l;
    }
    unary(): E {
      const t = this.peek();
      if (this.isKw(t, "NOT")) {
        this.pos++;
        consumeBool(this.unary());
        return { cls: "bool", tags: [], real: false };
      }
      if (this.isOp(t, "-") || this.isOp(t, "+")) {
        this.pos++;
        const e = this.unary();
        if (e.cls === "lit") return { ...e, lit: e.lit === "int01" ? "int" : e.lit };
        return { cls: "arith", tags: numericTags(e), real: e.real };
      }
      return this.primary();
    }

    primary(): E {
      const t = this.peek();
      if (!t) return E_UNK();
      if (t.k === "num") {
        this.pos++;
        if (t.real) return { cls: "lit", lit: "real", tags: [], real: true };
        if (t.val === null || t.val === undefined) return { cls: "lit", lit: "other", tags: [], real: false };
        return { cls: "lit", lit: t.val === 0 || t.val === 1 ? "int01" : "int", tags: [], real: false };
      }
      if (t.k === "str") {
        this.pos++;
        return { cls: "lit", lit: "other", tags: [], real: false };
      }
      if (t.k === "kw" && (t.u === "TRUE" || t.u === "FALSE")) {
        this.pos++;
        return { cls: "lit", lit: "bool", tags: [], real: false };
      }
      if (this.isP(t, "(")) {
        this.pos++;
        const e = this.or();
        if (this.isP(this.peek(), ")")) this.pos++;
        return e;
      }
      if (t.k === "id") return this.ident();
      this.pos++;
      return E_UNK();
    }

    args(): void {
      while (this.pos < this.toks.length) {
        const t = this.peek();
        if (this.isP(t, ")")) {
          this.pos++;
          return;
        }
        const nx = this.toks[this.pos + 1];
        if (t && t.k === "id" && (this.isOp(nx, ":=") || this.isOp(nx, "=>"))) this.pos += 2;
        const before = this.pos;
        consumeArg(this.or());
        if (this.pos === before) this.pos++;
        if (this.isP(this.peek(), ",")) this.pos++;
      }
    }

    sliceText(a: Tok, b: Tok): string {
      if (a.line === b.line) {
        const li = this.sc.lines.get(a.line);
        if (li) return li.text.slice(a.col - li.col, b.end - li.col);
      }
      return a.t;
    }

    ident(): E {
      const idTok = this.toks[this.pos++] as Tok;
      if (this.isP(this.peek(), "(")) {
        this.pos++;
        // JSR(routine, ...): the first argument is a routine, not a tag (SPEC §4.5)
        const target = this.peek();
        if (key(idTok.t) === "jsr" && target && target.k === "id" && !this.isP(this.toks[this.pos + 1], ".")) {
          calls.push({ name: target.t, span: spanOf(target), via: "jsr", from: currentRoutine });
          this.pos++;
          if (this.isP(this.peek(), ",")) this.pos++;
        }
        this.args();
        return { cls: "call", tags: [], real: false };
      }
      type Post = { kind: "member" | "bit"; tok: Tok } | { kind: "index"; open: Tok; close?: Tok };
      const post: Post[] = [];
      for (;;) {
        const t = this.peek();
        if (this.isP(t, ".")) {
          const nx = this.toks[this.pos + 1];
          if (nx && (nx.k === "id" || nx.k === "kw")) {
            post.push({ kind: "member", tok: nx });
            this.pos += 2;
            continue;
          }
          if (nx && nx.k === "num") {
            post.push({ kind: "bit", tok: nx });
            this.pos += 2;
            continue;
          }
          break;
        }
        if (this.isP(t, "[") && t) {
          this.pos++;
          for (;;) {
            const before = this.pos;
            consumeInt(this.or());
            if (this.pos === before) break;
            if (this.isP(this.peek(), ",")) this.pos++;
            else break;
          }
          let close: Tok | undefined;
          if (this.isP(this.peek(), "]")) close = this.toks[this.pos++];
          post.push({ kind: "index", open: t, close });
          continue;
        }
        break;
      }
      const k = key(idTok.t);
      const lastTok = (): Tok => {
        const p = post[post.length - 1];
        if (!p) return idTok;
        return p.kind === "index" ? (p.close ?? p.open) : p.tok;
      };
      const step = stepsByKey.get(k);
      if (step) {
        const first = post[0];
        const sp: Span = { line: idTok.line, col: idTok.col, endLine: lastTok().line, endCol: lastTok().end };
        if (!first || first.kind === "index") {
          diags.push(
            error("E400", sp, `\`${idTok.t}\` is a step; use \`${idTok.t}.X\` (active) or another member`, `use \`${idTok.t}.X\` for "the step is active"`),
          );
        } else {
          const canon = MEMBER_BY_KEY.get(first.tok.t.toLowerCase());
          if (first.kind === "bit" || !canon) {
            const sug = first.kind === "member" ? closest(first.tok.t, [...STEP_MEMBERS, ...READABLE], 2) : undefined;
            diags.push(
              error(
                "E401",
                sp,
                `\`${idTok.t}.${first.tok.t}\`: steps have no member \`${first.tok.t}\`${sug ? ` (did you mean \`${sug}\`?)` : ""}`,
                sug ? undefined : `valid members: ${STEP_MEMBERS.join(", ")}, and ${READABLE.join(", ")}`,
              ),
            );
          } else if (canon === "DN" && !(step.presetMs !== undefined)) {
            diags.push(
              warning("W302", sp, `\`${idTok.t}.${first.tok.t}\` is used but \`${idTok.t}\` has no preset, so it is TRUE immediately`, "add a duration to the step, e.g. `step name 5s`"),
            );
          }
        }
        return E_UNK();
      }
      // a tag
      const ref = use(idTok);
      const index = post.find((p) => p.kind === "index");
      const member = post.find((p) => p.kind === "member");
      if (index && index.kind === "index") {
        const text = index.close ? this.sliceText(idTok, index.close) : `${idTok.t}[`;
        diags.push(
          error("E403", { line: idTok.line, col: idTok.col, endLine: lastTok().line, endCol: lastTok().end }, `\`${text}\` needs a declared array tag (not supported yet)`),
        );
        return E_UNK();
      }
      const first = post[0];
      if (first && first.kind === "bit") {
        evid(ref, "DINT");
        return E_UNK();
      }
      if (member && member.kind === "member") {
        if (!declType.has(k)) {
          diags.push(
            error("E402", spanOf(idTok), `type of \`${idTok.t}\` unknown (it has member \`.${member.tok.t}\`): add \`tag ${idTok.t} : TIMER\``, "declare the type with a `tag` line"),
          );
        }
        return E_UNK();
      }
      return { cls: "tag", tag: ref, tags: [], real: false };
    }
  }

  // ---- unit (action or condition) ---------------------------------------------------------
  const boundary = (u: string): SegKind | undefined => {
    switch (u) {
      case "IF":
      case "ELSIF":
      case "WHILE":
      case "UNTIL":
        return "bool";
      case "CASE":
      case "TO":
      case "BY":
        return "int";
      case "FOR":
        return "for";
      case "THEN":
      case "ELSE":
      case "DO":
      case "OF":
      case "REPEAT":
      case "END_IF":
      case "END_CASE":
      case "END_FOR":
      case "END_WHILE":
      case "END_REPEAT":
      case "EXIT":
      case "RETURN":
        return "stmt";
      default:
        return undefined;
    }
  };

  const segments = (toks: Tok[], initial: SegKind): Seg[] => {
    const out: Seg[] = [];
    let cur: Tok[] = [];
    let kind = initial;
    const flush = (semi?: Tok): void => {
      if (cur.length) out.push({ toks: cur, kind, semi });
      cur = [];
    };
    for (const t of toks) {
      if (t.k === "p" && t.t === ";") {
        flush(t);
        kind = initial === "bool" ? "bool" : "stmt";
      } else if (t.k === "kw" && boundary(t.u) !== undefined) {
        flush();
        kind = boundary(t.u) as SegKind;
      } else cur.push(t);
    }
    flush();
    return out;
  };

  const isAssign = (t: Tok): boolean => t.k === "op" && (t.t === ":=" || t.t === "[:=]");
  const depth0 = (toks: Tok[], pred: (t: Tok) => boolean): number => {
    let depth = 0;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i] as Tok;
      if (t.k === "p" && (t.t === "(" || t.t === "[")) depth++;
      else if (t.k === "p" && (t.t === ")" || t.t === "]")) depth = Math.max(0, depth - 1);
      else if (depth === 0 && pred(t)) return i;
    }
    return -1;
  };

  const assignEvidence = (lhs: E, rhs: E): void => {
    const a = lhs.cls === "tag" ? lhs.tag : undefined;
    switch (rhs.cls) {
      case "lit":
        if (!a) return;
        if (rhs.lit === "real") evid(a, "REAL");
        else if (rhs.lit === "int") evid(a, "DINT");
        else if (rhs.lit === "int01") evid(a, "BOOL", true);
        else if (rhs.lit === "bool") evid(a, "BOOL");
        return;
      case "tag":
        if (a && rhs.tag) union(a.key, rhs.tag.key);
        return;
      case "arith":
        emitNumeric(rhs, rhs.real);
        if (a) evid(a, rhs.real ? "REAL" : "DINT");
        return;
      case "bool":
        if (a) evid(a, "BOOL");
        return;
      default:
    }
  };

  /**
   * Tokens of a sugar line (SPEC §4.3): `name [:=] 1 ;` / `name := 1 ;` / `name := 0 ;` per
   * name. The name tokens sit on the names; the others are empty, at the end of each name.
   */
  const sugarTokens = (line: number, sg: Sugar): Tok[] => {
    const out: Tok[] = [];
    const op = sg.verb === "on" ? "[:=]" : ":=";
    const v = sg.verb === "reset" ? 0 : 1;
    for (const nm of sg.names) {
      const col = nm.span.col;
      const end = nm.span.endCol ?? col + nm.text.length;
      out.push(
        { k: "id", t: nm.text, u: nm.text.toUpperCase(), line, col, end },
        { k: "op", t: op, u: op, line, col: end, end },
        { k: "num", t: String(v), u: String(v), line, col: end, end, real: false, val: v },
        { k: "p", t: ";", u: ";", line, col: end, end },
      );
    }
    return out;
  };

  /**
   * `label`: what the W402 message names, e.g. "the action of `fill`".
   * `sugar`: sugar lines of the unit (by line number), analyzed as their expansion.
   */
  /**
   * `after`: the `after 5s` terms of a condition (SPEC §4.4), analyzed as a Boolean operand
   * (they become `step.T >= ms` on export and hold no tag).
   */
  const processUnit = (
    lines: LineIn[],
    isCond: boolean,
    label = "the action",
    sugar: ReadonlyMap<number, Sugar> = new Map(),
    after: readonly AfterTerm[] = [],
  ): void => {
    let input = sugar.size ? lines.map((l) => (sugar.has(l.line) ? { ...l, text: "" } : l)) : lines;
    if (after.length && input[0]) {
      let text = input[0].text;
      for (const a of after) text = text.slice(0, a.start) + " ".repeat(a.end - a.start) + text.slice(a.end);
      input = [{ ...input[0], text }, ...input.slice(1)];
    }
    const sc = scan(input);
    if (sugar.size) {
      const synth = [...sugar].flatMap(([line, sg]) => sugarTokens(line, sg));
      // a sugar line has no tokens of its own: a stable sort by line puts its tokens in place
      sc.toks = [...sc.toks, ...synth].sort((a, b) => a.line - b.line);
    }
    if (after.length && input[0]) {
      const { line, col } = input[0];
      const synth = after.map((a): Tok => ({ k: "kw", t: "TRUE", u: "TRUE", line, col: col + a.start, end: col + a.end }));
      sc.toks = [...sc.toks, ...synth].sort((a, b) => a.line - b.line || a.col - b.col);
    }
    const toks = sc.toks;
    const mkParser = (ts: Tok[]): Parser => new Parser(ts, sc);

    // E407: unterminated string, else unbalanced brackets (one per unit)
    const bad = sc.unterminated[0];
    if (bad) {
      const q = bad.t.charAt(0);
      diags.push(error("E407", spanOf(bad), `ST string ${q} is not closed: add ${q}`));
    } else {
      const stack: Tok[] = [];
      let problem: Diagnostic | undefined;
      for (const t of toks) {
        if (t.k !== "p") continue;
        if (t.t === "(" || t.t === "[") stack.push(t);
        else if (t.t === ")" || t.t === "]") {
          const open = stack.pop();
          const want = t.t === ")" ? "(" : "[";
          if (!open) {
            problem = error("E407", spanOf(t), `unbalanced \`${t.t}\`: there is no matching \`${want}\``);
            break;
          }
          if (open.t !== want) {
            problem = error("E407", spanOf(open), `unbalanced \`${open.t}\`: it is closed by \`${t.t}\``);
            break;
          }
        }
      }
      if (!problem && stack.length) {
        const open = stack[stack.length - 1] as Tok;
        problem = error("E407", spanOf(open), `unbalanced \`${open.t}\`: missing \`${open.t === "(" ? ")" : "]"}\``);
      }
      if (problem) diags.push(problem);
    }

    // E602: `call` anywhere in a condition (SPEC §4.5)
    if (isCond) {
      const callTok = toks.find((t) => t.k === "id" && key(t.t) === "call");
      if (callTok) {
        diags.push(error("E602", spanOf(callTok), "`call` is a statement: it can't be used in a condition", "call the routine from an action, or test its result in the condition"));
        return;
      }
    }

    // W402: the last code token of an action must be `;`
    if (!isCond && toks.length) {
      const last = toks[toks.length - 1] as Tok;
      if (!(last.k === "p" && last.t === ";")) {
        diags.push(warning("W402", spanOf(last), `${label} doesn't end with \`;\``, "end the last statement with `;`"));
      }
    }

    for (const seg of segments(toks, isCond ? "bool" : "stmt")) {
      let ts = seg.toks;
      const ai0 = depth0(ts, isAssign);
      if (!isCond && seg.kind === "stmt") {
        // CASE label (`1, 2:` or `3..5:`): skipped
        const ci = depth0(ts, (t) => t.k === "p" && t.t === ":");
        if (ci >= 0 && (ai0 < 0 || ci < ai0)) ts = ts.slice(ci + 1);
      }
      if (!ts.length) continue;
      // `call routine;` (SPEC §4.5)
      const c0 = ts[0] as Tok;
      if (c0.k === "id" && key(c0.t) === "call") {
        const target = ts[1];
        const end = ts[ts.length - 1] as Tok;
        const whole = { line: c0.line, col: c0.col, endLine: end.line, endCol: end.end };
        if (isCond) {
          diags.push(error("E602", whole, "`call` is a statement: it can't be used in a condition", "call the routine from an action, or test its result in the condition"));
        } else if (ts.length === 2 && target && target.k === "id") {
          calls.push({ name: target.t, span: spanOf(target), via: "call", from: currentRoutine });
        } else {
          diags.push(error("E601", whole, "write `call routine_name;`", "one routine name after `call`, then `;`"));
        }
        continue;
      }
      const ai = depth0(ts, isAssign);
      if (ai >= 0) {
        const opTok = ts[ai] as Tok;
        const lp = mkParser(ts.slice(0, ai));
        const lhsAll = lp.top();
        const lhs = lhsAll[0] ?? E_UNK();
        for (const x of lhsAll.slice(1)) consumeArg(x);
        const rp = mkParser(ts.slice(ai + 1));
        const rhsAll = rp.top();
        const rhs = rhsAll[0] ?? E_UNK();
        for (const x of rhsAll.slice(1)) consumeArg(x);
        if (isCond) {
          diags.push(error("E406", spanOf(opTok), `\`${opTok.t}\` in a condition: did you mean \`=\`?`, "a condition compares with `=`; assignments belong in actions"));
          consumeArg(rhs);
        } else if (seg.kind === "for") {
          if (lhs.tag) evid(lhs.tag, "DINT");
          consumeInt(rhs);
        } else assignEvidence(lhs, rhs);
        continue;
      }
      const p = mkParser(ts);
      const es = p.top();
      const first = es[0] ?? E_UNK();
      if (seg.kind === "bool") consumeBool(first);
      else if (seg.kind === "int" || seg.kind === "for") consumeInt(first);
      else if (isCond) consumeBool(first);
      else consumeArg(first);
      for (const x of es.slice(1)) consumeArg(x);
      if (!isCond && seg.kind === "stmt" && depth0(ts, (t) => t.k === "op" && t.t === "=") >= 0) {
        const a = ts[0] as Tok;
        const b = seg.semi ?? (ts[ts.length - 1] as Tok);
        diags.push(warning("W403", spanOf(a), `\`${p.sliceText(a, b)}\` compares and does nothing; did you mean \`:=\`?`, "assignment is `:=`; `=` only compares"));
      }
    }
  };

  const toLines = (st: SourceText): LineIn => ({ text: st.text, line: st.span.line, col: st.span.col });

  /** W402 names the qualifier when the step has several actions or a non-N one (SPEC §4.3). */
  const actionLabel = (step: StepNode, a: ActionNode): string =>
    step.actions.length === 1 && a.qualifier === "N"
      ? `the action of \`${step.name.text}\``
      : `the ${a.qualifier} action of \`${step.name.text}\``;

  const processAction = (step: StepNode, a: ActionNode): void => {
    const sugar = new Map<number, Sugar>();
    for (const l of a.lines as ActionLine[]) if (l.sugar) sugar.set(l.span.line, l.sugar);
    processUnit(a.lines.map(toLines), false, actionLabel(step, a), sugar);
    // sugar tags are BOOL (SPEC §4.3); a name that is not a tag (a step: E400) gets none
    for (const sg of sugar.values()) {
      for (const nm of sg.names) {
        const k = key(nm.text);
        if (recs.has(k) && !stepsByKey.has(k)) evid({ key: k, name: nm.text, span: nm.span }, "BOOL");
      }
    }
  };

  for (const r of program.routines) {
    if (r.kind === "st") {
      currentRoutine = r.name.text;
      if (r.body.length) processUnit(r.body.map(toLines), false, `routine \`${r.name.text}\``);
      continue;
    }
    currentRoutine = r.name?.text ?? "";
    for (const el of walk(r.chart.body)) {
      if (el.kind === "step") {
        for (const a of el.actions) processAction(el, a);
      } else if (el.kind === "transition") {
        if (el.condition.text.length) processUnit([toLines(el.condition)], true, undefined, undefined, el.after);
      }
    }
  }

  // ---- unification groups and types -------------------------------------------------------
  const typedDecl = (r: Rec): TagDecl | undefined => r.decls.find((d) => d.type);
  const sortedRecs = [...recs.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const groups = new Map<string, Rec[]>();
  for (const r of sortedRecs) {
    const g = groups.get(find(r.key));
    if (g) g.push(r);
    else groups.set(find(r.key), [r]);
  }
  const typeOf = new Map<string, TagType>();
  for (const members of groups.values()) {
    const declRec = members.find((m) => typedDecl(m));
    const D = declRec ? typedDecl(declRec) : undefined;
    const evs = members.flatMap((m) => m.ev).sort((a, b) => cmpSpan(a.span, b.span));
    let T: TagType = "BOOL";
    if (D?.type) {
      T = D.type;
      const conflicts = (e: Ev): boolean => {
        if (T === "TIMER") return true;
        if (T === "BOOL") return e.type !== "BOOL";
        if (T === "DINT") return (e.type === "BOOL" && !e.weak) || e.type === "REAL";
        return e.type === "BOOL" && !e.weak;
      };
      const badEv = evs.find(conflicts);
      if (badEv) {
        diags.push(
          error(
            "E404",
            badEv.span,
            `\`${badEv.tag}\` is used as ${badEv.type} (line ${badEv.span.line}) but declared as ${D.type} (line ${D.name.span.line})`,
            "fix the use or the `tag` line",
          ),
        );
      }
    } else {
      const strong = evs.filter((e) => !e.weak);
      const e1 = strong[0];
      if (e1) {
        const isB = (e: Ev): boolean => e.type === "BOOL";
        const e2 = strong.find((e) => isB(e) !== isB(e1));
        const numeric = strong.filter((e) => !isB(e));
        const numT: TagType = numeric.some((e) => e.type === "REAL") ? "REAL" : "DINT";
        T = isB(e1) ? "BOOL" : numT;
        if (e2) {
          const num = isB(e1) ? e2 : e1;
          const sug = numeric.some((e) => e.type === "REAL") ? "REAL" : num.type;
          const msg =
            e1.tag.toLowerCase() === e2.tag.toLowerCase()
              ? `\`${e1.tag}\` is used as ${e1.type} (line ${e1.span.line}) and as ${e2.type} (line ${e2.span.line}): add \`tag ${e1.tag} : ${sug}\``
              : `\`${e2.tag}\` is used as ${e2.type} (line ${e2.span.line}) but \`${e1.tag}\` (same type through an assignment) is used as ${e1.type} (line ${e1.span.line}): add a \`tag\` line`;
          diags.push(error("E404", e2.span, msg, `declare the type, e.g. \`tag ${e1.tag} : ${sug}\``));
        }
      }
    }
    for (const m of members) typeOf.set(m.key, typedDecl(m)?.type ?? T);
  }

  // ---- per tag: spelling, reserved names, namespace, warnings ------------------------------
  const flagged = new Set<string>();
  const infos: TagInfo[] = [];
  const occurrences = (r: Rec): { name: string; span: Span; decl: boolean }[] =>
    [
      ...r.decls.map((d) => ({ name: d.name.text, span: d.name.span, decl: true })),
      ...(r.io ? [{ name: r.io.name.text, span: r.io.name.span, decl: true }] : []),
      ...r.uses.map((u) => ({ name: u.name, span: u.span, decl: false })),
    ].sort((a, b) => cmpSpan(a.span, b.span));

  for (const r of sortedRecs) {
    r.uses.sort((a, b) => cmpSpan(a.span, b.span));
    const occ = occurrences(r);
    const firstDecl = r.decls[0];
    const canonical = firstDecl ? firstDecl.name.text : (r.io?.name.text ?? r.uses[0]?.name ?? r.key);
    const firstOcc = firstDecl ? { span: firstDecl.name.span } : r.io ? { span: r.io.name.span } : occ[0];

    if (firstOcc && (RESERVED_RE.test(canonical) || QSFC_KEYWORDS.has(r.key))) {
      flagged.add(r.key);
      diags.push(error("E405", firstOcc.span, `\`${canonical}\` is a reserved name (${RESERVED_RE.test(canonical) ? "used for generated operands" : "qSFC keyword"})`));
    }
    if (firstOcc && routineKeys.has(r.key) && !stepsByKey.has(r.key) && !transKeys.has(r.key)) {
      flagged.add(r.key);
      diags.push(
        error("E410", firstOcc.span, `\`${canonical}\` is a routine, not a tag`,
          r.decls.length ? "names are shared by routines, steps, transitions and tags: rename one" : `run it with \`call ${canonical};\``),
      );
    } else if (firstOcc && (stepsByKey.has(r.key) || transKeys.has(r.key))) {
      flagged.add(r.key);
      const what = stepsByKey.has(r.key) ? "step" : "transition";
      diags.push(error("E410", firstOcc.span, `\`${canonical}\` is both a ${what} and a tag`, "names are shared by steps, transitions and tags: rename one"));
    }
    // Studio naming rules (SPEC §3.4) for tags that only appear in ST; declared names are
    // already checked by the parser. Only length and underscores can fail here: the ST
    // scanner guarantees the character set.
    if (!firstDecl && !r.io && firstOcc) {
      if (canonical.length > MAX_TAG_NAME) {
        flagged.add(r.key);
        diags.push(error("E102", firstOcc.span, `name \`${canonical}\` is ${canonical.length} characters long; the maximum is ${MAX_TAG_NAME}`));
      }
      if (canonical.includes("__") || canonical.endsWith("_")) {
        flagged.add(r.key);
        diags.push(error("E103", firstOcc.span, `name \`${canonical}\` can't contain \`__\` or end with \`_\` (Studio 5000 rule)`));
      }
    }
    // W401: other spellings
    const seen = new Set<string>([canonical]);
    for (const o of occ) {
      if (seen.has(o.name)) continue;
      seen.add(o.name);
      diags.push(warning("W401", o.span, `\`${canonical}\` and \`${o.name}\` are the same tag; the first spelling is used`, `write it as \`${canonical}\``));
    }
    // a `tag` line with a value makes the tag exist even when unused (SPEC §7.4: a timer set up
    // for later, or a Studio tag brought back by the import)
    if (!r.uses.length && !r.io && !r.decls.some((d) => d.initial !== undefined)) {
      if (r.decls.length && !flagged.has(r.key)) {
        diags.push(warning("W404", (firstDecl as TagDecl).name.span, `tag \`${canonical}\` is declared but never used`));
      }
      continue;
    }
    // an io description wins over a `tag` line's (SPEC §7.6)
    const description = r.io?.description ?? r.decls.find((d) => d.description !== undefined)?.description;
    const info: TagInfo = {
      name: canonical,
      type: typeOf.get(r.key) ?? "BOOL",
      declared: typedDecl(r) !== undefined,
      uses: r.uses.map((u) => u.span),
    };
    if (description !== undefined) info.description = description;
    if (r.io) info.address = r.io.address.text;
    const valued = r.decls.find((d) => d.valueSpan !== undefined);
    if (valued && r.io) {
      diags.push(error("E417", valued.valueSpan!, `\`${canonical}\` is an I/O point: its value comes from the module, it can't have one of its own`));
    } else if (valued?.initial !== undefined) info.initial = valued.initial;
    infos.push(info);
  }

  // W400: a likely typo = a tag used once whose name is close to an established tag
  // (used at least twice, or declared). Tags used once with no such neighbour are normal
  // in a draft (most outputs are written once), so they get no warning; neither do
  // pairs like valve_a / valve_b that are both used once.
  const allNames = sortedRecs.map((r) => ({
    key: r.key,
    name: r.decls[0]?.name.text ?? r.io?.name.text ?? r.uses[0]?.name ?? r.key,
    uses: r.uses.length,
    established: r.uses.length >= 2 || r.decls.length > 0 || r.io !== undefined,
  }));
  for (const r of sortedRecs) {
    if (r.uses.length !== 1 || r.decls.length || r.io || flagged.has(r.key)) continue;
    const mine = allNames.find((n) => n.key === r.key) as { name: string };
    let best: { name: string; d: number; uses: number } | undefined;
    for (const o of allNames) {
      if (o.key === r.key || !o.established || flagged.has(o.key)) continue;
      const d = distance(r.key, o.key);
      if (d > 2 || d * 2 > Math.max(r.key.length, o.key.length)) continue;
      if (!best || d < best.d || (d === best.d && o.uses > best.uses)) best = { name: o.name, d, uses: o.uses };
    }
    if (!best) continue;
    const span = (r.uses[0] as Use).span;
    diags.push(
      warning(
        "W400",
        span,
        `\`${mine.name}\` is used only once; did you mean \`${best.name}\`?`,
        `if it is a typo, write \`${best.name}\``,
      ),
    );
  }

  infos.sort((a, b) => {
    const x = a.name.toLowerCase();
    const y = b.name.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return { tags: infos, diagnostics: sortDiagnostics(diags), calls };
}
