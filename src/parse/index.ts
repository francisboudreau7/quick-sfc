/**
 * Line-based parser for qSFC v2 (SPEC §3, §4, §5 syntax, §10).
 * Never throws: always returns a best-effort Chart plus diagnostics (E1xx and the
 * line-level E2xx codes: E204 E205 E206 E209 E210 E219).
 */
import type {
  ActionLine,
  ActionNode,
  AfterTerm,
  BranchNode,
  Chart,
  IoEntry,
  Name,
  ProgramNode,
  Qualifier,
  Sequence,
  SourceText,
  StepNode,
  StRoutineNode,
  Sugar,
  TagDecl,
  UsesEntry,
  TagType,
  TransitionNode,
} from "../model/ast.js";
import { IO_ADDRESS_RE, key, TAG_PATH_RE } from "../model/ast.js";
import { error, sortDiagnostics, type Diagnostic, type Span } from "../model/diagnostics.js";
import { checkName, NAME_RE } from "./names.js";
import { checkCdata, contentEnd, isWs, mask, parseDuration, readString, skipWs } from "./text.js";

export { checkName, closest, editDistance, isKeyword, NAME_RE } from "./names.js";

export interface ParseResult {
  /** The whole file (SPEC §4.5). */
  program: ProgramNode;
  /**
   * The first SFC routine (an empty chart when there is none). Its `tagDecls` hold every
   * `tag` line of the file. Shortcut for one-routine files.
   */
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
  const first = p.program.routines.find((r) => r.kind === "sfc");
  const chart: Chart = first?.kind === "sfc" ? first.chart : { tagDecls: p.program.tagDecls, body: [] };
  return { program: p.program, chart, diagnostics: sortDiagnostics(p.diags) };
}

const TAG_TYPES: readonly TagType[] = ["BOOL", "DINT", "REAL", "TIMER", "SFC_STEP", "SFC_ACTION"];
const QUALIFIERS = new Set(["n", "s", "r", "l", "d", "p", "p0", "p1", "sd", "ds", "sl"]);
/** Supported today (SPEC §4.3); the others give E110. */
const SUPPORTED: ReadonlySet<string> = new Set(["N", "S", "R", "L", "D", "P"]);
/** Qualifiers that need a duration (E111). */
const TIMED: ReadonlySet<string> = new Set(["L", "D"]);
/** A qualifier line: only the qualifier, optionally a duration, optionally a comment (SPEC §4.3). */
const QUALIFIER_LINE_RE = /^([A-Za-z]\w*)(?:[ \t]+(\d\S*))?[ \t]*(?:\/\/.*)?$/;
/** A sugar line: keyword, names separated by commas, optional `;`, optional comment (SPEC §4.3). */
const SUGAR_RE = /^(on|set|reset)[ \t]+([A-Za-z_]\w*(?:[ \t]*,[ \t]*[A-Za-z_]\w*)*)[ \t]*;?[ \t]*(\/\/.*)?$/i;

/** A qualifier line, read when it is buffered. */
interface QualifierLine {
  qualifier: Qualifier;
  timeMs?: number;
  span: Span;
  /** P0, P1, SL, SD, DS (E110): its lines are kept as an N action, and no E112. */
  unsupported?: boolean;
}

/** The sugar of an action line (SPEC §4.3), or undefined when the line is ordinary ST. */
export function readSugar(line: SourceText): Sugar | undefined {
  const m = SUGAR_RE.exec(line.text);
  if (!m) return undefined;
  const verb = m[1]!.toLowerCase() as Sugar["verb"];
  const listStart = line.text.indexOf(m[2]!, m[1]!.length);
  const names = [...m[2]!.matchAll(/[A-Za-z_]\w*/g)].map((w) => {
    const col = line.span.col + listStart + w.index!;
    return { text: w[0], span: { line: line.span.line, col, endLine: line.span.line, endCol: col + w[0].length } };
  });
  const sugar: Sugar = { verb, names };
  if (m[3]) sugar.comment = m[3].trimEnd();
  return sugar;
}
const TRANSITION_NAME_RE = /^\s*([A-Za-z_]\w*)\s*:(?!=)/;
export { IO_ADDRESS_RE } from "../model/ast.js";
/** `after <duration>` in a condition (SPEC §4.4): `after` not after a dot or a name character. */
const AFTER_RE = /(?<![\w.])after[ \t]+(\d\w*)/gi;
/** First words that end an `io` block that is missing its `end` (E206). */
const IO_BREAKERS: ReadonlySet<string> = new Set([
  "program", "sfc", "st", "tag", "init", "step", "select", "parallel", "course", "author", "io", "uses", "controller",
]);

interface BufferedLine {
  line: number;
  raw: string;
  kind: "st" | "blank" | "comment" | "qualifier";
  qualifier?: QualifierLine;
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

/**
 * Dedent a block of lines (SPEC §4.3): drop blank lines at the start and blank or comment
 * lines at the end, remove the common leading whitespace. Blank lines get text "".
 */
function dedent(buf: BufferedLine[]): SourceText[] {
  const first = buf.findIndex((b) => b.kind !== "blank");
  let last = -1;
  for (let k = buf.length - 1; k >= 0; k--) {
    if (buf[k]!.kind === "st") {
      last = k;
      break;
    }
  }
  if (first < 0 || last < 0) return [];
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
  return kept.map((b) => {
    if (b.kind === "blank") return { text: "", span: { line: b.line, col: 1 } };
    const text = b.raw.slice(cut).trimEnd();
    return { text, span: { line: b.line, col: cut + 1, endLine: b.line, endCol: cut + 1 + text.length } };
  });
}

class Parser {
  readonly diags: Diagnostic[] = [];
  readonly program: ProgramNode = { routines: [], tagDecls: [] };
  /** Current SFC routine (null before the first one, or while in an ST routine). */
  private sfc: Chart | null = null;
  /** Current ST routine. */
  private st: StRoutineNode | null = null;
  private stBuffer: BufferedLine[] = [];
  private readonly lines: string[];
  private stack: Frame[] = [];

  /** Step whose action lines are being collected. */
  private owner: StepNode | null = null;
  private buffer: BufferedLine[] = [];
  /** What came last, for the E209 message. */
  private after = "it comes before the first step";
  private orphanReported = false;

  private readonly unnamed: TransitionNode[] = [];
  private readonly used = new Set<string>();
  /** The open `io` block (SPEC §7.6), if any. */
  private ioBlock: { span: Span; scope?: "controller" } | null = null;
  /** The open `controller` block (SPEC §7.7), if any. */
  private ctrlBlock: { span: Span } | null = null;

  constructor(source: string) {
    this.lines = source.split(/\r?\n/);
  }

  /** The SFC chart new elements go into; starts a header-less SFC routine when needed. */
  private get chart(): Chart {
    if (!this.sfc) {
      this.closeRoutine();
      const chart: Chart = { tagDecls: this.program.tagDecls, body: [] };
      this.program.routines.push({ kind: "sfc", chart });
      this.sfc = chart;
    }
    return this.sfc;
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
    this.closeRoutine();
    this.closeIo();
    this.closeController();
    this.assignAutoNames();
  }

  /** E206 for a `controller` block without `end`. */
  private closeController(): void {
    if (!this.ctrlBlock) return;
    this.closeIo();
    this.diags.push(
      error("E206", this.ctrlBlock.span, `\`controller\` at line ${this.ctrlBlock.span.line} is never closed: add \`end\``),
    );
    this.ctrlBlock = null;
  }

  /** E206 for an `io` block without `end` (at the end of the file, or before a structure line). */
  private closeIo(): void {
    if (!this.ioBlock) return;
    this.diags.push(
      error("E206", this.ioBlock.span, `\`io\` at line ${this.ioBlock.span.line} is never closed: add \`end\``),
    );
    this.ioBlock = null;
  }

  /** Ends the current routine: closes its action block or ST body, reports open branches. */
  private closeRoutine(): void {
    this.flush();
    this.owner = null;
    for (const f of this.stack) {
      this.diags.push(
        error("E206", f.node.span, `\`${f.node.kind}\` at line ${f.node.span.line} is never closed: add \`end\``),
      );
    }
    this.stack = [];
    this.flushSt();
    this.sfc = null;
    this.st = null;
    this.after = "it comes before the first step";
    this.orphanReported = false;
  }

  private line(n: number, raw: string): void {
    const indent = /^[ \t]*/.exec(raw)![0].length;
    const t = raw.slice(indent);
    const word = /^[A-Za-z_]\w*/.exec(t)?.[0].toLowerCase();
    const rest = t.slice(word?.length ?? 0);
    // `st := 1;` is ST, `st main` is a header
    const headerShape = rest.trim() === "" || /^\s+(?![:=])\S/.test(rest) || /^\s*\/\//.test(rest);
    if (this.ioBlock && this.ioLine(n, raw, indent, t, word, headerShape)) return;
    if (this.ctrlBlock && this.controllerLine(n, raw, indent, t, word, headerShape)) return;
    if (word === "controller" && headerShape) {
      this.controllerStart(n, raw, indent);
      return;
    }
    if (word === "io" && headerShape) {
      if (!this.st) this.structure("an `io` block");
      this.ioStart(n, raw, indent);
      return;
    }
    if ((word === "course" || word === "author") && (headerShape || /^\s*"/.test(rest))) {
      this.metaLine(n, raw, indent, word);
      return;
    }
    if (word === "program" && headerShape) {
      this.programHeader(n, raw, indent);
      return;
    }
    if (word === "uses" && headerShape) {
      this.usesLine(n, raw, indent);
      return;
    }
    if ((word === "sfc" || word === "st") && headerShape) {
      this.closeRoutine();
      this.header(n, raw, indent, word);
      return;
    }
    if (this.st) {
      this.stLine(n, raw, indent, t, word);
      return;
    }
    if (t.trim() === "") {
      if (this.owner) this.buffer.push({ line: n, raw, kind: "blank" });
      return;
    }
    if (looksLikeV1(t)) {
      this.diags.push(
        error("E100", lineSpan(n, indent, raw.trimEnd().length),
          "this looks like qSFC version 1 syntax (`S@name(...)`); see SPEC §11 for the new form"),
      );
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
    switch (word) {
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
        if (this.owner) {
          const qualifier = this.qualifierLine(n, indent, t);
          if (qualifier) this.buffer.push({ line: n, raw, kind: "qualifier", qualifier });
          else this.buffer.push({ line: n, raw, kind: "st" });
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

  /**
   * Reads `keyword name`; reports E101 / E107 and returns the name. With `title`, a `"string"`
   * may follow the name (`program tank "Tank filling"`, SPEC §4.5); it is passed to `title`.
   */
  private headerName(
    n: number,
    raw: string,
    indent: number,
    keyword: string,
    what: string,
    title?: (value: string) => void,
  ): Name | undefined {
    const end = contentEnd(raw);
    const span = lineSpan(n, indent, end);
    let i = skipWs(raw, indent + keyword.length, end);
    const start = i;
    while (i < end && !isWs(raw[i]) && !(title && raw[i] === '"')) i++;
    if (start === i) {
      this.diags.push(error("E101", span, `\`${keyword}\` needs a ${what} name: \`${keyword} name\``));
      return undefined;
    }
    const name: Name = { text: raw.slice(start, i), span: lineSpan(n, start, i) };
    // a routine (or program) may be named like a qSFC keyword (`sfc SFC`, common in Studio)
    this.diags.push(...checkName(name.text, name.span, { reserved: true, keywordName: true }));
    this.used.add(key(name.text));
    if (title) {
      const j = skipWs(raw, i, end);
      if (raw[j] === '"') {
        const d = this.description(n, raw, j, end);
        title(d.value);
        i = d.next;
      }
    }
    this.extraText(n, raw, i, end, `the ${what} name \`${name.text}\``);
    return name;
  }

  private programHeader(n: number, raw: string, indent: number): void {
    const span = lineSpan(n, indent, contentEnd(raw));
    if (this.program.header) {
      this.diags.push(error("E210", span, "the `program` line can appear only once"));
      return;
    }
    if (this.program.routines.length > 0) {
      this.diags.push(
        error("E210", span, "the `program` line must come before the first routine (comments, blank lines and `tag` lines may come before it)"),
      );
    }
    let title: string | undefined;
    const name = this.headerName(n, raw, indent, "program", "program", (v) => (title = v));
    if (name) {
      this.program.header = name;
      if (title !== undefined) this.program.title = title;
    }
  }

  /**
   * `uses INIT, PRODUCTION_NORMALE, MainRoutine (main)` (SPEC §4.5): routines of the program that
   * aren't in the file. Before the first routine; several lines add up.
   */
  private usesLine(n: number, raw: string, indent: number): void {
    const end = contentEnd(raw);
    const span = lineSpan(n, indent, end);
    if (this.program.routines.length > 0) {
      this.diags.push(error("E210", span, "the `uses` line must come before the first routine"));
    }
    const list = (this.program.uses ??= []);
    let i = skipWs(raw, indent + 4, end);
    if (i >= end) {
      this.diags.push(error("E101", span, "`uses` needs routine names: `uses INIT, MainRoutine (main)`"));
      return;
    }
    while (i < end) {
      const start = i;
      while (i < end && /\w/.test(raw[i]!)) i++;
      if (start === i) {
        this.diags.push(error("E107", lineSpan(n, i, end), `unexpected text \`${raw.slice(i, end)}\` in the \`uses\` line`,
          "write routine names separated by commas: `uses INIT, MainRoutine (main)`"));
        return;
      }
      const name: Name = { text: raw.slice(start, i), span: lineSpan(n, start, i) };
      this.diags.push(...checkName(name.text, name.span, { reserved: true, keywordName: true }));
      this.used.add(key(name.text));
      const entry: UsesEntry = { name, main: false };
      i = skipWs(raw, i, end);
      const m = /^\(\s*main\s*\)/i.exec(raw.slice(i, end));
      if (m) {
        const mainSpan = lineSpan(n, i, i + m[0].length);
        const other = list.find((u) => u.main);
        if (other) this.diags.push(error("E210", mainSpan, `the main routine is already \`${other.name.text}\` (line ${other.name.span.line})`));
        else entry.main = true;
        i = skipWs(raw, i + m[0].length, end);
      }
      list.push(entry);
      if (raw[i] === ",") i = skipWs(raw, i + 1, end);
      else if (i < end) {
        this.diags.push(error("E107", lineSpan(n, i, end), `unexpected text \`${raw.slice(i, end)}\` in the \`uses\` line`,
          "separate the routine names with commas"));
        return;
      }
    }
  }

  /** `course "…"` / `author "…"` (SPEC §4.5): before the first routine, once each; printing only. */
  private metaLine(n: number, raw: string, indent: number, word: "course" | "author"): void {
    const end = contentEnd(raw);
    const span = lineSpan(n, indent, end);
    const meta = this.program.meta;
    if (meta?.[word] !== undefined) {
      this.diags.push(error("E210", span, `the \`${word}\` line can appear only once`));
      return;
    }
    if (this.program.routines.length > 0) {
      this.diags.push(
        error("E210", span, `the \`${word}\` line must come before the first routine (comments, blank lines and \`tag\` lines may come before it)`),
      );
    }
    let i = skipWs(raw, indent + word.length, end);
    const example = word === "course" ? '"GEI-243"' : '"Your name"';
    if (raw[i] !== '"') {
      this.diags.push(
        i < end
          ? error("E107", lineSpan(n, i, end), `unexpected text \`${raw.slice(i, end)}\` after \`${word}\``, `write the text in quotes: ${word} ${example}`)
          : error("E107", span, `\`${word}\` needs a text in quotes: \`${word} ${example}\``),
      );
      return;
    }
    const d = this.description(n, raw, i, end);
    i = d.next;
    this.extraText(n, raw, i, end, `the \`${word}\` text`);
    this.program.meta = { ...meta, [word]: d.value };
  }

  // ---- io block (SPEC §7.6) ---------------------------------------------------------

  // ---- controller block (SPEC §7.7) ---------------------------------------------------

  private controllerStart(n: number, raw: string, indent: number): void {
    const span = lineSpan(n, indent, indent + 10);
    if (this.program.routines.length > 0) {
      this.diags.push(error("E210", span, "the `controller` block must come before the first routine"));
    }
    this.extraText(n, raw, indent + 10, contentEnd(raw), "`controller`");
    this.ctrlBlock = { span };
  }

  /**
   * A line inside the `controller` block: `tag` lines, an `io` block, `sfc tags …`, `end`.
   * Returns false when the line ends the block (missing `end`: E206), so the caller reads it.
   */
  private controllerLine(n: number, raw: string, indent: number, t: string, word: string | undefined, headerShape: boolean): boolean {
    if (t.trim() === "" || t.startsWith("//")) return true;
    if (word === "end") {
      this.ctrlBlock = null;
      this.extraText(n, raw, indent + 3, contentEnd(raw), "`end`");
      return true;
    }
    if (word === "tag") {
      this.tag(n, raw, indent, "controller");
      return true;
    }
    if (word === "io" && headerShape) {
      this.ioStart(n, raw, indent, "controller");
      return true;
    }
    if (word === "sfc" && /^\s+tags\b/i.test(t.slice(3))) {
      this.sfcTags(n, raw, indent);
      return true;
    }
    if (t.startsWith("--") || t.startsWith("|") || (word !== undefined && IO_BREAKERS.has(word) && headerShape)) {
      this.closeController();
      return false;
    }
    this.diags.push(
      error("E223", lineSpan(n, indent, contentEnd(raw)), "only `tag` lines, an `io` block and `sfc tags` go in the `controller` block",
        "close the block with `end` first"),
    );
    return true;
  }

  /** `sfc tags s26, s27, tr29` (SPEC §7.7): elements whose operand tags are controller tags. */
  private sfcTags(n: number, raw: string, indent: number): void {
    const end = contentEnd(raw);
    let i = skipWs(raw, raw.toLowerCase().indexOf("tags", indent + 3) + 4, end);
    const list = (this.program.controllerElements ??= []);
    while (i < end) {
      const start = i;
      while (i < end && /\w/.test(raw[i]!)) i++;
      if (start === i) {
        this.diags.push(error("E107", lineSpan(n, i, end), `unexpected text \`${raw.slice(i, end)}\` in \`sfc tags\``,
          "write step and transition names separated by commas: `sfc tags fill, tr4`"));
        return;
      }
      list.push({ text: raw.slice(start, i), span: lineSpan(n, start, i) });
      i = skipWs(raw, i, end);
      if (raw[i] === ",") i = skipWs(raw, i + 1, end);
      else if (i < end) {
        this.diags.push(error("E107", lineSpan(n, i, end), `unexpected text \`${raw.slice(i, end)}\` in \`sfc tags\``,
          "separate the names with commas"));
        return;
      }
    }
  }

  private ioStart(n: number, raw: string, indent: number, scope?: "controller"): void {
    this.extraText(n, raw, indent + 2, contentEnd(raw), "`io`");
    this.ioBlock = scope ? { span: lineSpan(n, indent, indent + 2), scope } : { span: lineSpan(n, indent, indent + 2) };
    if (!this.program.io) this.program.io = [];
  }

  /**
   * A line inside an `io` block. Returns false when the line is not part of the block (the
   * block misses its `end`: E206), so the caller reads it as usual.
   */
  private ioLine(n: number, raw: string, indent: number, t: string, word: string | undefined, headerShape: boolean): boolean {
    if (t.trim() === "" || t.startsWith("//")) return true;
    if (word === "end") {
      this.ioBlock = null;
      this.extraText(n, raw, indent + 3, contentEnd(raw), "`end`");
      return true;
    }
    if (t.startsWith("--") || t.startsWith("|") || (word !== undefined && IO_BREAKERS.has(word) && headerShape)) {
      this.closeIo();
      return false;
    }
    const end = contentEnd(raw);
    const span = lineSpan(n, indent, end);
    let i = indent;
    while (i < end && !isWs(raw[i]) && raw[i] !== '"') i++;
    const name: Name = { text: raw.slice(indent, i), span: lineSpan(n, indent, i) };
    if (name.text === "") {
      this.diags.push(error("E101", span, "an `io` line starts with a tag name: `name  Local:1:I.Data.0  [\"description\"]`"));
      return true;
    }
    this.diags.push(...checkName(name.text, name.span));
    this.used.add(key(name.text));
    i = skipWs(raw, i, end);
    const as = i;
    while (i < end && !isWs(raw[i]) && raw[i] !== '"') i++;
    const address: SourceText = { text: raw.slice(as, i), span: lineSpan(n, as, i) };
    if (address.text === "") {
      this.diags.push(
        error("E413", name.span, `I/O point \`${name.text}\` has no address`, `write it after the name, e.g.  ${name.text}  Local:1:I.Data.0`),
      );
    } else if (!IO_ADDRESS_RE.test(address.text) && !TAG_PATH_RE.test(address.text)) {
      this.diags.push(
        error("E413", address.span, `\`${address.text}\` is not a valid I/O address`,
          "write a Logix I/O path, e.g. Local:1:I.Data.0 (input bit), or a tag member, e.g. Step_017.Count"),
      );
    }
    const entry: IoEntry = { name, address, span };
    if (this.ioBlock?.scope) entry.scope = this.ioBlock.scope;
    i = skipWs(raw, i, end);
    if (raw[i] === '"') {
      const d = this.description(n, raw, i, end);
      entry.description = d.value;
      i = d.next;
    }
    this.extraText(n, raw, i, end, `the I/O point \`${name.text}\``);
    (this.program.io ??= []).push(entry);
    return true;
  }

  private header(n: number, raw: string, indent: number, kind: "sfc" | "st"): void {
    const span = lineSpan(n, indent, contentEnd(raw));
    const name = this.headerName(n, raw, indent, kind, "routine");
    if (kind === "sfc") {
      const chart: Chart = { tagDecls: this.program.tagDecls, body: [] };
      if (name) chart.header = name;
      this.program.routines.push(name ? { kind, name, chart, span } : { kind, chart, span });
      this.sfc = chart;
      this.after = "it follows the `sfc` header";
    } else {
      const routine: StRoutineNode = { kind, name: name ?? { text: "", span: { line: n, col: indent + 1 } }, body: [], span };
      this.program.routines.push(routine);
      this.st = routine;
      this.stBuffer = [];
    }
  }

  // ---- ST routine body --------------------------------------------------------

  private stLine(n: number, raw: string, indent: number, t: string, word: string | undefined): void {
    if (t.trim() === "") {
      this.stBuffer.push({ line: n, raw, kind: "blank" });
      return;
    }
    if (t.startsWith("//")) {
      this.stBuffer.push({ line: n, raw, kind: "comment" });
      return;
    }
    if (word === "tag") {
      this.tag(n, raw, indent);
      return;
    }
    const structural = t.startsWith("--")
      ? "transition"
      : t.startsWith("|")
        ? "`|`"
        : word === "init" || word === "step"
          ? "step"
          : word === "select" || word === "parallel" || word === "end"
            ? `\`${word}\``
            : undefined;
    if (structural) {
      const routine = this.st!;
      this.diags.push(
        error("E222", lineSpan(n, indent, raw.trimEnd().length),
          `${structural} lines belong to an \`sfc\` routine; \`${routine.name.text}\` is an \`st\` routine`,
          "start an SFC routine with `sfc name` before this line"),
      );
      return;
    }
    this.stBuffer.push({ line: n, raw, kind: "st" });
  }

  private flushSt(): void {
    const routine = this.st;
    if (!routine) return;
    routine.body = dedent(this.stBuffer);
    this.stBuffer = [];
    for (const a of routine.body) {
      if (a.text === "") continue;
      checkCdata(a.text, a.span, this.diags);
      this.scanIdentifiers(a.text);
    }
  }

  // ---- tag ----------------------------------------------------------------

  private tag(n: number, raw: string, indent: number, scope?: "controller"): void {
    const end = contentEnd(raw);
    const span = lineSpan(n, indent, end);
    let i = skipWs(raw, indent + 3, end);
    const start = i;
    while (i < end && !isWs(raw[i]) && raw[i] !== ":" && raw[i] !== '"' && raw[i] !== "=") i++;
    if (start === i) {
      this.diags.push(error("E101", span, "a `tag` line needs a tag name: `tag name [: TYPE [value]] [\"description\"]`"));
      return;
    }
    const name: Name = { text: raw.slice(start, i), span: lineSpan(n, start, i) };
    this.diags.push(...checkName(name.text, name.span));
    const decl: TagDecl = { name, span };
    if (scope) decl.scope = scope;
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
    // initial value (SPEC §7.4): `= 5` after the type, or a duration after TIMER
    if (raw[i] === "=" || ((decl.type === "TIMER" || decl.type === "SFC_STEP") && /\d/.test(raw[i] ?? ""))) {
      const eq = i;
      if (raw[i] === "=") i = skipWs(raw, i + 1, end);
      const vs = i;
      while (i < end && !isWs(raw[i]) && raw[i] !== '"') i++;
      this.tagValue(decl, raw.slice(vs, i), lineSpan(n, vs, Math.max(i, vs + 1)), lineSpan(n, eq, Math.max(i, eq + 1)));
      i = skipWs(raw, i, end);
    }
    if (raw[i] === '"') {
      const d = this.description(n, raw, i, end);
      decl.description = d.value;
      i = d.next;
    }
    this.extraText(n, raw, i, end, `the declaration of tag \`${name.text}\``);
    this.program.tagDecls.push(decl);
  }

  /** Checks an initial value against the declared type (E417); sets decl.initial when valid. */
  private tagValue(decl: TagDecl, text: string, span: Span, whole: Span): void {
    decl.valueSpan = whole;
    const bad = (msg: string) => this.diags.push(error("E417", span, msg));
    if (decl.type === undefined) {
      bad(`a value needs the tag's type first: \`tag ${decl.name.text} : DINT = ${text || "5"}\``);
      return;
    }
    if (text === "") {
      bad("the value is missing after `=`");
      return;
    }
    switch (decl.type) {
      case "SFC_ACTION":
        bad("an SFC_ACTION tag takes no value");
        return;
      case "SFC_STEP":
      case "TIMER": {
        const ms = parseDuration(text, span, this.diags);
        if (ms !== undefined) decl.initial = ms;
        return;
      }
      case "BOOL": {
        const v = ({ "0": 0, "1": 1, false: 0, true: 1 } as Record<string, number>)[text.toLowerCase()];
        if (v === undefined) bad(`\`${text}\` is not a BOOL value: write 0, 1, TRUE or FALSE`);
        else decl.initial = v;
        return;
      }
      case "DINT": {
        const v = /^[+-]?\d+$/.test(text) ? Number(text) : NaN;
        if (!Number.isInteger(v) || v < -2147483648 || v > 2147483647) {
          bad(`\`${text}\` is not a DINT value: a whole number from -2147483648 to 2147483647`);
        } else decl.initial = v;
        return;
      }
      case "REAL": {
        const v = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text) ? Number(text) : NaN;
        if (!Number.isFinite(v)) bad(`\`${text}\` is not a REAL value, e.g. 1.5 or -2.0e3`);
        else decl.initial = v;
        return;
      }
    }
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
    const step: StepNode = { kind: "step", initial, name, actions: [], action: [], span };
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

  /**
   * A line holding only a qualifier (and a duration, and a comment) starts an action
   * (SPEC §4.3). Reports E110 (unsupported qualifier) and E111 (duration missing or not allowed).
   */
  private qualifierLine(n: number, indent: number, t: string): QualifierLine | undefined {
    const m = QUALIFIER_LINE_RE.exec(t);
    if (!m || !QUALIFIERS.has(m[1]!.toLowerCase())) return undefined;
    const written = m[1]!.toUpperCase();
    const span = lineSpan(n, indent, indent + m[1]!.length);
    if (!SUPPORTED.has(written)) {
      this.diags.push(error("E110", span, `qualifier \`${written}\` is not supported yet (N, S, R, L, D, P are)`));
      return { qualifier: "N", span, unsupported: true };
    }
    const q: QualifierLine = { qualifier: written as Qualifier, span };
    const dur = m[2];
    const durSpan = (): Span => {
      const ds = indent + t.indexOf(dur!, m[1]!.length);
      return lineSpan(n, ds, ds + dur!.length);
    };
    if (TIMED.has(written)) {
      if (dur === undefined) {
        this.diags.push(error("E111", span, `qualifier \`${written}\` needs a duration: \`${written} 10s\``));
      } else {
        const ms = parseDuration(dur, durSpan(), this.diags);
        if (ms !== undefined) q.timeMs = ms;
      }
    } else if (dur !== undefined) {
      this.diags.push(error("E111", durSpan(), `qualifier \`${written}\` takes no duration`, "only L and D take a duration"));
    }
    return q;
  }

  /** Close the action block of the current step: split it into actions (SPEC §4.3). */
  private flush(): void {
    const owner = this.owner;
    if (!owner) return;
    const buf = this.buffer;
    this.buffer = [];
    const groups: Array<{ head?: QualifierLine; lines: BufferedLine[] }> = [{ lines: [] }];
    for (const b of buf) {
      if (b.qualifier) groups.push({ head: b.qualifier, lines: [] });
      else groups[groups.length - 1]!.lines.push(b);
    }
    const actions: ActionNode[] = [];
    for (const g of groups) {
      const lines: ActionLine[] = dedent(g.lines);
      const kinds = new Map(g.lines.map((b) => [b.line, b.kind]));
      for (const a of lines) {
        const kind = kinds.get(a.span.line);
        if (kind === "blank") continue;
        checkCdata(a.text, a.span, this.diags);
        this.scanIdentifiers(a.text);
        if (kind !== "st") continue;
        const sugar = readSugar(a);
        if (sugar) a.sugar = sugar;
        else this.checkInlineQualifier(a);
      }
      const h = g.head;
      if (!h) {
        if (lines.length) actions.push({ qualifier: "N", lines, span: lines[0]!.span });
        continue;
      }
      if (lines.length === 0) {
        if (!h.unsupported) {
          const who = owner.name.text ? ` of step \`${owner.name.text}\`` : "";
          this.diags.push(
            error("E112", h.span, `the \`${h.qualifier}\` action${who} is empty`, "write its ST on the lines below the qualifier"),
          );
        }
        continue;
      }
      const node: ActionNode = { qualifier: h.qualifier, lines, header: h.span, span: h.span };
      if (h.timeMs !== undefined) node.timeMs = h.timeMs;
      actions.push(node);
    }
    owner.actions = actions;
    owner.action = actions.flatMap((a) => a.lines);
  }

  /**
   * E110: a qualifier with ST on the same line (`L 10s horn [:=] 1;`, `S x := 1;`): the
   * qualifier goes on its own line (SPEC §4.3). `S := 1;` (a tag named S) is ST.
   */
  private checkInlineQualifier(a: SourceText): void {
    const m = /^([A-Za-z_]\w*)/.exec(a.text);
    if (!m || !QUALIFIERS.has(m[1]!.toLowerCase())) return;
    const rest = a.text.slice(m[1]!.length).trimStart();
    if (rest === "" || rest.startsWith("//")) return;
    if (/^[:\[.(=<>]/.test(rest)) return; // := [:=] . [ ( = < > : can follow a tag name
    const written = m[1]!.toUpperCase();
    const span = { line: a.span.line, col: a.span.col, endLine: a.span.line, endCol: a.span.col + m[1]!.length };
    if (!SUPPORTED.has(written)) {
      this.diags.push(error("E110", span, `qualifier \`${written}\` is not supported yet (N, S, R, L, D, P are)`));
      return;
    }
    const dur = /^\d+[A-Za-z]+/.exec(rest);
    const shown = dur ? `${written} ${dur[0]}` : written;
    this.diags.push(
      error("E110", span, `write the qualifier \`${shown}\` on its own line, with the action's ST on the lines below it`),
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
    const after = this.afterTerms(condition);
    if (after.length) node.after = after;

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

  /** `after 5s` terms of a condition (SPEC §4.4); E104 / E105 for a bad duration. */
  private afterTerms(condition: SourceText): AfterTerm[] {
    const out: AfterTerm[] = [];
    const { masked } = mask(condition.text);
    const { line, col } = condition.span;
    for (const m of masked.matchAll(AFTER_RE)) {
      const start = m.index!;
      const end = start + m[0].length;
      const dur = condition.text.slice(end - m[1]!.length, end);
      const ds = col + end - dur.length;
      const term: AfterTerm = { span: { line, col: col + start, endLine: line, endCol: col + end }, start, end };
      const ms = parseDuration(dur, { line, col: ds, endLine: line, endCol: ds + dur.length }, this.diags);
      if (ms !== undefined) term.ms = ms;
      out.push(term);
    }
    return out;
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
    for (const d of this.program.tagDecls) this.used.add(key(d.name.text));
    let k = 1;
    for (const t of this.unnamed) {
      while (this.used.has(`t${k}`)) k++;
      t.name = { text: `T${k}`, span: t.name.span };
      this.used.add(`t${k}`);
      k++;
    }
  }
}
