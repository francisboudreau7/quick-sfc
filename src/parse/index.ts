/**
 * Line-based parser for qSFC v2 (SPEC §3, §4, §5 syntax, §10).
 * Never throws: always returns a best-effort Chart plus diagnostics (E1xx and the
 * line-level E2xx codes: E204 E205 E206 E209 E210 E219).
 */
import type {
  BranchNode,
  Chart,
  Name,
  Sequence,
  SourceText,
  StepNode,
  TagDecl,
  TagType,
  TransitionNode,
} from "../model/ast.js";
import { key } from "../model/ast.js";
import { error, sortDiagnostics, type Diagnostic, type Span } from "../model/diagnostics.js";
import { checkName, NAME_RE } from "./names.js";
import { checkCdata, contentEnd, isWs, mask, parseDuration, readString, skipWs } from "./text.js";

export { checkName, closest, editDistance, isKeyword, NAME_RE } from "./names.js";

export interface ParseResult {
  chart: Chart;
  diagnostics: Diagnostic[];
}

export function parse(source: string): ParseResult {
  const p = new Parser(source);
  try {
    p.run();
  } catch (e) {
    // Defensive: the parser must never throw (live coding). Report and return what we have.
    p.diags.push(error("E000", { line: 1, col: 1 }, `internal parser error: ${String(e)}`));
  }
  return { chart: p.chart, diagnostics: sortDiagnostics(p.diags) };
}

const TAG_TYPES: readonly TagType[] = ["BOOL", "DINT", "REAL", "TIMER"];
const QUALIFIERS = new Set(["n", "s", "r", "l", "d", "p", "p0", "p1", "sd", "ds", "sl"]);
const TRANSITION_NAME_RE = /^\s*([A-Za-z_]\w*)\s*:(?!=)/;

interface BufferedLine {
  line: number;
  raw: string;
  kind: "st" | "blank" | "comment";
}

interface Frame {
  node: BranchNode;
  leg: Sequence;
}

function lineSpan(line: number, start: number, end: number): Span {
  return { line, col: start + 1, endLine: line, endCol: end + 1 };
}

/** qSFC version 1 forms (SPEC §11). */
function looksLikeV1(t: string): boolean {
  if (/^(SI|S|T)@/i.test(t)) return true;
  const trimmed = t.trim();
  if (trimmed === "/\\" || trimmed === "\\/" || trimmed === "//\\\\" || trimmed === "\\\\//") return true;
  const { masked } = mask(t);
  return /@[A-Za-z_]\w*\s*\(/.test(masked) || /(->|>>)\s*@/.test(masked);
}

class Parser {
  readonly diags: Diagnostic[] = [];
  readonly chart: Chart = { tagDecls: [], body: [] };
  private readonly lines: string[];
  private readonly stack: Frame[] = [];
  private seenContent = false;

  /** Step whose action lines are being collected. */
  private owner: StepNode | null = null;
  private buffer: BufferedLine[] = [];
  /** What came last, for the E209 message. */
  private after = "it comes before the first step";
  private orphanReported = false;

  private readonly unnamed: TransitionNode[] = [];
  private readonly used = new Set<string>();

  constructor(source: string) {
    this.lines = source.split(/\r?\n/);
  }

  private get current(): Sequence {
    const top = this.stack[this.stack.length - 1];
    return top ? top.leg : this.chart.body;
  }

  run(): void {
    this.lines.forEach((rawLine, i) => {
      const raw = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      this.line(i + 1, raw);
    });
    this.flush();
    for (const f of this.stack) {
      this.diags.push(
        error("E206", f.node.span, `\`${f.node.kind}\` at line ${f.node.span.line} is never closed: add \`end\``),
      );
    }
    this.assignAutoNames();
  }

  private line(n: number, raw: string): void {
    const indent = /^[ \t]*/.exec(raw)![0].length;
    const t = raw.slice(indent);
    if (t.trim() === "") {
      if (this.owner) this.buffer.push({ line: n, raw, kind: "blank" });
      return;
    }
    if (looksLikeV1(t)) {
      this.diags.push(
        error("E100", lineSpan(n, indent, raw.trimEnd().length),
          "this looks like qSFC version 1 syntax (`S@name(...)`); see SPEC §11 for the new form"),
      );
      this.seenContent = true;
      return;
    }
    if (t.startsWith("//")) {
      if (this.owner) this.buffer.push({ line: n, raw, kind: "comment" });
      return;
    }
    if (t.startsWith("--")) {
      this.structure("a transition");
      this.transition(n, raw, indent);
      return;
    }
    if (t.startsWith("|")) {
      this.structure("`|`");
      this.bar(n, raw, indent);
      return;
    }
    const word = /^[A-Za-z_]\w*/.exec(t)?.[0].toLowerCase();
    switch (word) {
      case "sfc":
        this.flush();
        this.header(n, raw, indent);
        this.structure("the `sfc` header");
        return;
      case "tag":
        this.structure("a `tag` line");
        this.tag(n, raw, indent);
        return;
      case "init":
      case "step":
        this.structure("a step");
        this.step(n, raw, indent, word === "init");
        return;
      case "select":
      case "parallel":
        this.structure(`\`${word}\``);
        this.branchStart(n, raw, indent, word);
        return;
      case "end":
        this.structure("`end`");
        this.branchEnd(n, raw, indent);
        return;
      default:
        this.seenContent = true;
        if (this.owner) {
          this.buffer.push({ line: n, raw, kind: "st" });
        } else if (!this.orphanReported) {
          this.orphanReported = true;
          this.diags.push(
            error("E209", lineSpan(n, indent, raw.trimEnd().length),
              `this action line has no step above it (${this.after})`,
              "action lines belong to the step written above them"),
          );
        }
    }
  }

  /** Common bookkeeping for every structure line. */
  private structure(what: string): void {
    this.flush();
    this.seenContent = true;
    this.owner = null;
    this.orphanReported = false;
    this.after = `it follows ${what}`;
  }

  private extraText(n: number, raw: string, from: number, end: number, after: string): void {
    const i = skipWs(raw, from, end);
    if (i < end) {
      const text = raw.slice(i, end);
      this.diags.push(error("E107", lineSpan(n, i, end), `unexpected text \`${text}\` after ${after}`));
    }
  }

  // ---- header -------------------------------------------------------------

  private header(n: number, raw: string, indent: number): void {
    const end = contentEnd(raw);
    const span = lineSpan(n, indent, end);
    if (this.chart.header) {
      this.diags.push(error("E210", span, "the `sfc` header can appear only once"));
      return;
    }
    if (this.seenContent) {
      this.diags.push(error("E210", span, "the `sfc` header must be the first line of the file (comments and blank lines may come before it)"));
    }
    let i = skipWs(raw, indent + 3, end);
    const start = i;
    while (i < end && !isWs(raw[i])) i++;
    if (start === i) {
      this.diags.push(error("E101", span, "the `sfc` header needs a routine name: `sfc name`"));
      return;
    }
    const name: Name = { text: raw.slice(start, i), span: lineSpan(n, start, i) };
    this.diags.push(...checkName(name.text, name.span));
    this.chart.header = name;
    this.extraText(n, raw, i, end, `the routine name \`${name.text}\``);
  }

  // ---- tag ----------------------------------------------------------------

  private tag(n: number, raw: string, indent: number): void {
    const end = contentEnd(raw);
    const span = lineSpan(n, indent, end);
    let i = skipWs(raw, indent + 3, end);
    const start = i;
    while (i < end && !isWs(raw[i]) && raw[i] !== ":" && raw[i] !== '"') i++;
    if (start === i) {
      this.diags.push(error("E101", span, "a `tag` line needs a tag name: `tag name [: TYPE] [\"description\"]`"));
      return;
    }
    const name: Name = { text: raw.slice(start, i), span: lineSpan(n, start, i) };
    this.diags.push(...checkName(name.text, name.span));
    const decl: TagDecl = { name, span };
    i = skipWs(raw, i, end);
    if (raw[i] === ":") {
      i = skipWs(raw, i + 1, end);
      const ts = i;
      while (i < end && /\w/.test(raw[i]!)) i++;
      const typeText = raw.slice(ts, i);
      if (typeText === "") {
        this.diags.push(error("E409", lineSpan(n, ts, ts + 1), "missing type after `:` (Phase 1 types: BOOL, DINT, REAL, TIMER)"));
      } else {
        const upper = typeText.toUpperCase() as TagType;
        if (TAG_TYPES.includes(upper)) decl.type = upper;
        else {
          this.diags.push(
            error("E409", lineSpan(n, ts, i), `unknown type \`${typeText}\` (Phase 1 types: BOOL, DINT, REAL, TIMER)`),
          );
        }
      }
      i = skipWs(raw, i, end);
    }
    if (raw[i] === '"') {
      const d = this.description(n, raw, i, end);
      decl.description = d.value;
      i = d.next;
    }
    this.extraText(n, raw, i, end, `the declaration of tag \`${name.text}\``);
    this.chart.tagDecls.push(decl);
  }

  private description(n: number, raw: string, i: number, end: number): { value: string; next: number } {
    const s = readString(raw, i, end);
    if (!s.closed) {
      this.diags.push(error("E106", lineSpan(n, i, end), "string not closed: add `\"`"));
    }
    checkCdata(s.value, { line: n, col: i + 2 }, this.diags);
    return { value: s.value, next: s.next };
  }

  // ---- step ---------------------------------------------------------------

  private step(n: number, raw: string, indent: number, initial: boolean): void {
    const end = contentEnd(raw);
    const span = lineSpan(n, indent, end);
    const kwLen = 4; // "init" and "step"
    let i = skipWs(raw, indent + kwLen, end);
    const start = i;
    while (i < end && !isWs(raw[i]) && raw[i] !== '"') i++;
    let name: Name;
    if (start === i) {
      name = { text: "", span: { line: n, col: start + 1 } };
      this.diags.push(error("E101", span, `a step needs a name: \`${initial ? "init" : "step"} name\``));
    } else {
      name = { text: raw.slice(start, i), span: lineSpan(n, start, i) };
      this.diags.push(...checkName(name.text, name.span, { reserved: true }));
    }
    const step: StepNode = { kind: "step", initial, name, action: [], span };
    this.current.push(step);
    this.owner = step;
    this.buffer = [];
    if (name.text) this.used.add(key(name.text));

    i = skipWs(raw, i, end);
    if (i < end && raw[i] !== '"') {
      const ds = i;
      while (i < end && !isWs(raw[i]) && raw[i] !== '"') i++;
      const tok = raw.slice(ds, i);
      if (/^\d/.test(tok)) {
        const ms = parseDuration(tok, lineSpan(n, ds, i), this.diags);
        if (ms !== undefined) step.presetMs = ms;
      } else {
        this.diags.push(
          error("E107", lineSpan(n, ds, end), `unexpected text \`${raw.slice(ds, end)}\` after the step name`,
            "a step line is `step name [duration] [\"description\"]`"),
        );
        return;
      }
      i = skipWs(raw, i, end);
    }
    if (i < end && raw[i] === '"') {
      const d = this.description(n, raw, i, end);
      step.description = d.value;
      i = d.next;
    }
    i = skipWs(raw, i, end);
    if (i < end) {
      this.diags.push(
        error("E107", lineSpan(n, i, end), `unexpected text \`${raw.slice(i, end)}\` after the step's duration/description`,
          "a step line is `step name [duration] [\"description\"]`"),
      );
    }
  }

  /** Close the action block of the current step (SPEC §4.3). */
  private flush(): void {
    const owner = this.owner;
    if (!owner) return;
    const buf = this.buffer;
    this.buffer = [];
    const first = buf.findIndex((b) => b.kind !== "blank");
    let last = -1;
    for (let k = buf.length - 1; k >= 0; k--) {
      if (buf[k]!.kind === "st") {
        last = k;
        break;
      }
    }
    if (first < 0 || last < 0) {
      owner.action = [];
      return;
    }
    const kept = buf.slice(first, last + 1);
    let prefix: string | undefined;
    for (const b of kept) {
      if (b.kind === "blank") continue;
      const ws = /^[ \t]*/.exec(b.raw)![0];
      if (prefix === undefined) prefix = ws;
      else {
        let k = 0;
        while (k < prefix.length && k < ws.length && prefix[k] === ws[k]) k++;
        prefix = prefix.slice(0, k);
      }
    }
    const cut = (prefix ?? "").length;
    const action: SourceText[] = kept.map((b) => {
      if (b.kind === "blank") return { text: "", span: { line: b.line, col: 1 } };
      const text = b.raw.slice(cut).trimEnd();
      return { text, span: { line: b.line, col: cut + 1, endLine: b.line, endCol: cut + 1 + text.length } };
    });
    owner.action = action;
    action.forEach((a, k) => {
      if (kept[k]!.kind === "blank") return;
      checkCdata(a.text, a.span, this.diags);
      this.scanIdentifiers(a.text);
      if (kept[k]!.kind === "st") this.checkQualifier(a);
    });
  }

  /** E110: IEC action qualifiers are [Later] (SPEC §4.3). */
  private checkQualifier(a: SourceText): void {
    const m = /^([A-Za-z_]\w*)/.exec(a.text);
    if (!m || !QUALIFIERS.has(m[1]!.toLowerCase())) return;
    const rest = a.text.slice(m[1]!.length).trimStart();
    if (rest === "" || rest.startsWith("//")) return;
    if (/^[:\[.(=<>]/.test(rest)) return; // := [:=] . [ ( = < > : can follow a tag name
    const dur = /^\d+[A-Za-z]+/.exec(rest);
    const shown = dur ? `${m[1]} ${dur[0]}` : m[1]!;
    this.diags.push(
      error("E110", { line: a.span.line, col: a.span.col, endLine: a.span.line, endCol: a.span.col + m[1]!.length },
        `action qualifiers are not supported yet: write the ST without \`${shown}\` (N is used)`),
    );
  }

  private scanIdentifiers(text: string): void {
    const { masked } = mask(text);
    for (const m of masked.matchAll(/[A-Za-z_]\w*/g)) this.used.add(key(m[0]));
  }

  // ---- transition -----------------------------------------------------------

  private transition(n: number, raw: string, indent: number): void {
    const { masked, comment } = mask(raw);
    const end = raw.slice(0, comment < 0 ? raw.length : comment).trimEnd().length;
    const span = lineSpan(n, indent, end);
    const start = indent + 2;
    let arrow = masked.indexOf("->", start);
    if (arrow >= end) arrow = -1;
    const condEnd = arrow >= 0 ? arrow : end;
    const body = raw.slice(start, condEnd);

    let name: Name | undefined;
    let condStart = start;
    const m = TRANSITION_NAME_RE.exec(body);
    if (m) {
      const ns = start + m[0].indexOf(m[1]!);
      name = { text: m[1]!, span: lineSpan(n, ns, ns + m[1]!.length) };
      this.diags.push(...checkName(name.text, name.span, { reserved: true }));
      this.used.add(key(name.text));
      condStart = start + m[0].length;
    }
    const condRaw = raw.slice(condStart, condEnd);
    const lead = condRaw.length - condRaw.trimStart().length;
    const condText = condRaw.trim();
    const condCol = condStart + lead;
    const condition: SourceText = {
      text: condText,
      span: { line: n, col: condCol + 1, endLine: n, endCol: condCol + 1 + condText.length },
    };
    checkCdata(condText, condition.span, this.diags);
    this.scanIdentifiers(condText);

    const node: TransitionNode = {
      kind: "transition",
      name: name ?? { text: "", span: { line: n, col: indent + 1, endLine: n, endCol: indent + 3 } },
      auto: name === undefined,
      condition,
      span,
    };

    if (arrow >= 0) {
      let i = skipWs(raw, arrow + 2, end);
      const ts = i;
      while (i < end && /\w/.test(raw[i]!)) i++;
      const target = raw.slice(ts, i);
      node.jump = { text: target, span: target ? lineSpan(n, ts, i) : lineSpan(n, arrow, arrow + 2) };
      if (target === "") {
        this.diags.push(error("E101", lineSpan(n, arrow, end), "missing jump target after `->`: write `-> step_name`"));
      } else {
        if (!NAME_RE.test(target)) {
          this.diags.push(error("E101", node.jump.span, `\`${target}\` is not a valid name: names start with a letter or \`_\``));
        }
        const rest = skipWs(raw, i, end);
        if (rest < end) {
          this.diags.push(
            error("E219", lineSpan(n, rest, end), `unexpected text \`${raw.slice(rest, end)}\` after the jump target \`${target}\``),
          );
        }
      }
    }
    if (!name) this.unnamed.push(node);
    this.current.push(node);
  }

  // ---- branches -------------------------------------------------------------

  private branchStart(n: number, raw: string, indent: number, kind: "select" | "parallel"): void {
    const end = contentEnd(raw);
    const node: BranchNode = { kind, legs: [[]], span: lineSpan(n, indent, indent + kind.length) };
    this.extraText(n, raw, indent + kind.length, end, `\`${kind}\``);
    this.current.push(node);
    this.stack.push({ node, leg: node.legs[0]! });
  }

  private bar(n: number, raw: string, indent: number): void {
    const end = contentEnd(raw);
    const span = lineSpan(n, indent, indent + 1);
    const top = this.stack[this.stack.length - 1];
    if (!top) {
      this.diags.push(error("E204", span, "`|` outside a `select` or `parallel` block"));
    } else {
      const leg: Sequence = [];
      top.node.legs.push(leg);
      top.leg = leg;
    }
    this.extraText(n, raw, indent + 1, end, "`|`");
  }

  private branchEnd(n: number, raw: string, indent: number): void {
    const end = contentEnd(raw);
    const span = lineSpan(n, indent, indent + 3);
    const top = this.stack.pop();
    if (!top) {
      this.diags.push(error("E205", span, "`end` without a matching `select` or `parallel`"));
    } else {
      top.node.endSpan = span;
    }
    this.extraText(n, raw, indent + 3, end, "`end`");
  }

  // ---- auto names -------------------------------------------------------------

  private assignAutoNames(): void {
    for (const d of this.chart.tagDecls) this.used.add(key(d.name.text));
    let k = 1;
    for (const t of this.unnamed) {
      while (this.used.has(`t${k}`)) k++;
      t.name = { text: `T${k}`, span: t.name.span };
      this.used.add(`t${k}`);
      k++;
    }
  }
}
