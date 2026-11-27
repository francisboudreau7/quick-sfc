/**
 * L5X import (Phase 4d, SPEC §8.7): one Program of a Studio 5000 L5X back to qSFC text.
 *
 *   1. read the Program: tags, routines (SFC and ST; ladder and FBD are reported, not imported);
 *   2. every SFC chart: rebuild its qSFC structure with Tidy's recovery (src/tidy), which checks
 *      that the structure gives exactly the chart's wires;
 *   3. names: the step / transition tag descriptions (what the qSFC export writes), else the
 *      step's `// name - description` comment, else a plain name from the operand (`Step_003` →
 *      `s3`, which pins the operand again on export, SPEC §8.2). Unnamed transitions stay
 *      unnamed unless their operand needs pinning (`tr5:`) or the code refers to them;
 *   4. text: Studio's ST as is, with operands replaced by names; sugar (`on`, `set`, `reset`,
 *      `call`, `after`) only where the export gives back exactly the same text (checked by
 *      compiling both versions);
 *   5. anything qSFC can't hold (text boxes, Stop elements, step alarms and limits, tag types,
 *      other routine types...) is a note in the report, and a comment at the top of the file.
 *
 * Pure, no I/O, never throws.
 */
import { compile, exportedTexts } from "../compile.js";
import { key } from "../model/ast.js";
import { hasErrors } from "../model/diagnostics.js";
import type { Graph } from "../model/graph.js";
import { parseXml } from "../l5x/xml.js";
import { QUALIFIER_NAMES, stepNameComment } from "../l5x/index.js";
import { operandName, pinnedOperand } from "../model/ast.js";
import { IO_ADDRESS_RE, TAG_PATH_RE } from "../model/ast.js";
import { checkName } from "../parse/names.js";
import { formatDuration } from "../render/ascii.js";
import { renameIdentifiers } from "../tags/rewrite.js";
import { rebuild } from "../tidy/index.js";
import { readSfc, type SfcChart, type SfcNode } from "../tidy/read.js";
import { stepName, transName } from "../tidy/recover.js";
import { attr, scanDescendants, scanXml, type ScanElement } from "../tidy/scan.js";

export interface ImportNote {
  /** "warning": something was dropped or changed; "info": good to know. */
  level: "info" | "warning";
  /** Routine the note is about, when it is about one. */
  routine?: string;
  text: string;
}

export interface ImportedRoutine {
  name: string;
  /** Studio's routine type: SFC, ST, RLL (ladder), FBD... */
  type: string;
  imported: boolean;
  /** Why it was not imported. */
  reason?: string;
}

export interface ImportResult {
  /** The .qsfc text ("" when the file can't be read). */
  source: string;
  /** The imported Program. */
  program: string;
  /** Every Program of the file, in document order. */
  programs: string[];
  routines: ImportedRoutine[];
  notes: ImportNote[];
  /** Errors left in `source` (shown in the editor; 0 normally). */
  errors: number;
  /** Steps and transitions whose tags are controller tags in the file (SPEC §7.7), moved or not. */
  controllerSfcTags: number;
  /** Set when the file itself can't be read. */
  error?: string;
}

export interface ImportOptions {
  /** Program to import (case-insensitive). Default: the exported Program (Use="Target"), else the first. */
  program?: string;
  /**
   * Step and transition tags that are controller tags in the file become program tags (no
   * `sfc tags` line, SPEC §7.7). Default false: the import mirrors the L5X.
   */
  sfcTagsAtProgram?: boolean;
}

// ---- reading -----------------------------------------------------------------------------------

interface L5XTag {
  name: string;
  alias?: string;
  dataType: string;
  description?: string;
  /** Decorated data: a plain value, or structure members (lower-case names). */
  value?: string;
  members: Map<string, string>;
  /** Array or nested data that qSFC can't describe. */
  complex: boolean;
  /** A controller tag (the `<Controller><Tags>` of the file, SPEC §7.7). */
  controller?: boolean;
}

const lineText = (el: ScanElement): string => el.text.replace(/^\r?\n|\r?\n$/g, "");

function stLines(el: ScanElement | undefined): string[] {
  if (!el) return [];
  const lines = scanDescendants(el, "Line");
  const num = (l: ScanElement) => Number(attr(l, "Number") ?? 0);
  return [...lines].sort((a, b) => num(a) - num(b)).map(lineText);
}

function descriptionOf(el: ScanElement): string | undefined {
  const d = el.children.find((c) => c.name === "Description");
  if (!d) return undefined;
  const text = d.text.replace(/\r\n/g, "\n").replace(/^\s*\n|\n\s*$/g, "").trim();
  return text || undefined;
}

function readTags(scope: ScanElement | undefined): L5XTag[] {
  const tags: L5XTag[] = [];
  for (const t of scope?.children.filter((c) => c.name === "Tag") ?? []) {
    const tag: L5XTag = { name: attr(t, "Name") ?? "", dataType: attr(t, "DataType") ?? "", members: new Map(), complex: false };
    if (attr(t, "TagType") === "Alias") tag.alias = attr(t, "AliasFor") ?? "";
    const desc = descriptionOf(t);
    if (desc !== undefined) tag.description = desc;
    const data = t.children.find((c) => c.name === "Data" && attr(c, "Format") === "Decorated");
    const top = data?.children[0];
    if (top?.name === "DataValue") tag.value = attr(top, "Value");
    else if (top?.name === "Structure") {
      for (const m of top.children) {
        if (m.name === "DataValueMember") tag.members.set((attr(m, "Name") ?? "").toLowerCase(), attr(m, "Value") ?? "");
        else tag.complex = true;
      }
    } else if (top) tag.complex = true;
    tags.push(tag);
  }
  return tags;
}

// ---- names ------------------------------------------------------------------------------------

const EXTRA_KEYWORDS = new Set(["program", "st", "call"]);
const AUTO_NAME = /^T\d+$/;
const NAME_COMMENT = /^\/\/\s*([A-Za-z_]\w*)(?:\s+-\s(.*))?\s*$/;

const validName = (name: string): boolean =>
  checkName(name, { line: 1, col: 1 }, { reserved: true }).length === 0 && !EXTRA_KEYWORDS.has(name.toLowerCase());

const opNumber = (operand: string, prefix: string): number | undefined => {
  const m = new RegExp(`^${prefix}_(\\d+)$`, "i").exec(operand);
  return m ? Number(m[1]) : undefined;
};

const quote = (s: string): string => `"${s.replace(/\s*\n\s*/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

interface Element {
  /** `routine index/ID` */
  uid: string;
  routine: number;
  node: SfcNode;
  name?: string;
  description?: string;
  /** Transitions: the name was given by the import (pin or reference), not by Studio. */
  given?: boolean;
  /** Steps: named from the operand (no name in Studio). */
  plain?: boolean;
}

interface SfcPart {
  kind: "sfc";
  name: string;
  chart: SfcChart;
  skeleton: string;
}

interface StPart {
  kind: "st";
  name: string;
  lines: string[];
}

type Part = SfcPart | StPart;

// ---- entry ------------------------------------------------------------------------------------

export function importL5X(xml: string, options: ImportOptions = {}): ImportResult {
  const empty = (error: string, programs: string[] = []): ImportResult => ({
    source: "", program: "", programs, routines: [], notes: [], errors: 0, controllerSfcTags: 0, error,
  });
  try {
    parseXml(xml);
  } catch (e) {
    return empty(`the file is not valid XML: ${(e as Error).message}`);
  }
  let root: ScanElement;
  try {
    root = scanXml(xml);
  } catch (e) {
    return empty(`the file can't be read: ${(e as Error).message}`);
  }
  const programEls = scanDescendants(root, "Program");
  const programs = programEls.map((p) => attr(p, "Name") ?? "?");
  if (!programEls.length) return empty("the file has no Program (export a program, or the whole controller, from Studio 5000)");
  const wanted = options.program?.toLowerCase();
  const program =
    (wanted !== undefined ? programEls.find((p) => (attr(p, "Name") ?? "").toLowerCase() === wanted) : undefined) ??
    (wanted === undefined ? (programEls.find((p) => attr(p, "Use") === "Target") ?? programEls[0]) : undefined);
  if (!program) return empty(`the file has no program named ${options.program}`, programs);
  try {
    const content = root.children.find((c) => c.name === "RSLogix5000Content");
    const controllerEl = content?.children.find((c) => c.name === "Controller");
    const controllerTags = readTags(controllerEl?.children.find((c) => c.name === "Tags"));
    const whole = content !== undefined && attr(content, "TargetType") === "Controller";
    return { ...importProgram(program, controllerTags, whole, options), programs };
  } catch (e) {
    return empty(`internal error: ${(e as Error).message}`, programs);
  }
}

/**
 * `controllerTags`: the file's controller tags (SPEC §7.7). `whole`: a controller export, whose
 * controller tags are not limited to the ones the program uses.
 */
function importProgram(
  program: ScanElement,
  controllerTags: L5XTag[],
  whole: boolean,
  options: ImportOptions,
): Omit<ImportResult, "programs"> {
  const programName = attr(program, "Name") ?? "program";
  const notes: ImportNote[] = [];
  const warn = (text: string, routine?: string) => notes.push(routine ? { level: "warning", routine, text } : { level: "warning", text });
  const info = (text: string, routine?: string) => notes.push(routine ? { level: "info", routine, text } : { level: "info", text });

  const programTags = readTags(program.children.find((c) => c.name === "Tags"));
  // a program tag hides a controller tag of the same name inside the program (Studio 5000)
  const programKeys = new Set(programTags.map((t) => key(t.name)));
  const shadowed = controllerTags.filter((t) => programKeys.has(key(t.name))).map((t) => t.name);
  if (shadowed.length) info(`controller tag${shadowed.length > 1 ? "s" : ""} ${shadowed.slice(0, 4).join(", ")}${shadowed.length > 4 ? "…" : ""} also exist${shadowed.length > 1 ? "" : "s"} as program tag${shadowed.length > 1 ? "s" : ""}: the program one is kept`);
  const tags = [...programTags, ...controllerTags.filter((t) => !programKeys.has(key(t.name))).map((t) => ({ ...t, controller: true }))];
  const tagByKey = new Map(tags.map((t) => [key(t.name), t] as const));

  // ---- routines: main first, then document order
  const routineEls = program.children.find((c) => c.name === "Routines")?.children.filter((c) => c.name === "Routine") ?? [];
  const mainName = attr(program, "MainRoutineName") ?? "";
  const ordered = [...routineEls].sort((a, b) => Number(attr(b, "Name") === mainName) - Number(attr(a, "Name") === mainName));
  const report: ImportedRoutine[] = [];
  const parts: Part[] = [];
  const skipped = new Map<string, string>();
  for (const r of ordered) {
    const name = attr(r, "Name") ?? "?";
    const type = attr(r, "Type") ?? "?";
    const skip = (reason: string) => {
      report.push({ name, type, imported: false, reason });
      skipped.set(key(name), type);
      warn(`routine ${name} not imported: ${reason}; named on the \`uses\` line`, name);
    };
    if (attr(r, "Use") === "Reference") {
      // a routine export lists the routines its code names, without their content
      report.push({ name, type, imported: false, reason: "not in this export (only named by the code)" });
      skipped.set(key(name), type);
      info(`routine ${name} is not in this export (only named by the code): named on the \`uses\` line`, name);
    } else if (type === "ST") {
      const lines = stLines(r.children.find((c) => c.name === "STContent"));
      while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
      parts.push({ kind: "st", name, lines });
      report.push({ name, type, imported: true });
    } else if (type === "SFC") {
      const content = r.children.find((c) => c.name === "SFCContent");
      const chart = content ? readSfc(content) : "the routine has no SFC content";
      if (typeof chart === "string") {
        skip(chart);
        continue;
      }
      const rb = rebuild(chart);
      if (typeof rb === "string") {
        skip(rb);
        continue;
      }
      parts.push({ kind: "sfc", name, chart, skeleton: rb.source });
      report.push({ name, type, imported: true });
    } else {
      skip(type === "RLL" ? "ladder routines come with Phase 5" : `qSFC has no ${type} routines`);
    }
  }
  if (!parts.length) {
    return { source: "", program: programName, routines: report, notes, errors: 0, controllerSfcTags: 0, error: "the program has no SFC or ST routine that can be imported" };
  }
  const usesNames = ordered.map((r) => attr(r, "Name") ?? "").filter((n) => skipped.has(key(n)));
  if (mainName && key(parts[0]!.name) !== key(mainName) && !skipped.has(key(mainName))) {
    warn(`the main routine ${mainName} is not in the file, so ${parts[0]!.name} becomes the main routine (the first routine of the file)`);
  }

  // ---- elements and names
  const taken = new Set<string>();
  for (const p of parts) taken.add(key(p.name));
  for (const name of skipped.keys()) taken.add(name);
  const sfcOperands = new Set<string>();
  const elements: Element[] = [];
  const byUid = new Map<string, Element>();
  parts.forEach((p, ri) => {
    if (p.kind !== "sfc") return;
    for (const node of p.chart.nodes.values()) {
      const el: Element = { uid: `${ri}/${node.id}`, routine: ri, node };
      elements.push(el);
      byUid.set(el.uid, el);
      sfcOperands.add(key(node.operand));
      for (const a of node.el.children) if (a.name === "Action") sfcOperands.add(key(attr(a, "Operand") ?? ""));
    }
  });
  const isSfcTag = (t: L5XTag) =>
    sfcOperands.has(key(t.name)) ||
    operandName(t.name) !== undefined ||
    ["SFC_STEP", "SFC_ACTION", "SFC_STOP"].includes(t.dataType.toUpperCase());
  for (const t of tags) if (!isSfcTag(t)) taken.add(key(t.name));
  const take = (name: string): boolean => {
    if (!validName(name) || taken.has(key(name))) return false;
    taken.add(key(name));
    return true;
  };
  const tagDesc = (el: Element) => tagByKey.get(key(el.node.operand))?.description;
  const steps = elements.filter((e) => e.node.kind !== "transition");
  const transitions = elements.filter((e) => e.node.kind === "transition");

  // 1. tag descriptions (the qSFC export puts the name on the first line)
  for (const el of elements) {
    const desc = tagDesc(el);
    if (desc === undefined) continue;
    const [first, ...rest] = desc.split("\n");
    const candidate = first!.trim();
    if (el.node.kind === "transition" && AUTO_NAME.test(candidate)) continue;
    if (take(candidate)) {
      el.name = candidate;
      if (rest.length && el.node.kind !== "transition") el.description = rest.join(" ").trim();
    } else if (el.node.kind !== "transition") el.description = desc.replace(/\s*\n\s*/g, " ").trim();
  }
  // 2. the step's name comment
  for (const el of steps) {
    if (el.name !== undefined) continue;
    const m = NAME_COMMENT.exec(firstActionLines(el.node)[0] ?? "");
    if (m && take(m[1]!)) {
      el.name = m[1]!;
      if (m[2]?.trim() && el.description === undefined) el.description = m[2].trim();
    }
  }
  // 3. plain names from the operand
  let k = 1;
  const fresh = (prefix: string): string => {
    while (!take(`${prefix}${k}`)) k++;
    return `${prefix}${k}`;
  };
  for (const el of steps) {
    if (el.name !== undefined) continue;
    const prefix = el.node.kind === "stop" ? "stop" : "s";
    const n = opNumber(el.node.operand, el.node.kind === "stop" ? "Stop" : "Step");
    if (n !== undefined && take(`${prefix}${n}`)) el.name = `${prefix}${n}`;
    else if (take(el.node.operand)) el.name = el.node.operand;
    else el.name = fresh(prefix === "s" ? "step" : "stop");
    el.plain = true;
  }

  // ---- code texts: transitions the code refers to need a name
  const codeTexts: string[] = [];
  for (const p of parts) {
    if (p.kind === "st") codeTexts.push(...p.lines);
    else for (const n of p.chart.nodes.values()) codeTexts.push(...n.text);
  }
  const code = codeTexts.join("\n");
  const ident = (name: string) => new RegExp(`(^|[^\\w.])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i");
  for (const el of transitions) {
    if (el.name !== undefined || !ident(el.node.operand).test(code)) continue;
    const n = opNumber(el.node.operand, "Tran");
    el.name = n !== undefined && take(`tr${n}`) ? `tr${n}` : fresh("tr");
    el.given = true;
  }
  // elements whose tags are controller tags (SPEC §7.7) are listed on `sfc tags`: they need a name
  const atController = (el: Element) => !options.sfcTagsAtProgram && el.node.kind !== "stop" && tagByKey.get(key(el.node.operand))?.controller === true;
  for (const el of transitions) {
    if (el.name !== undefined || !atController(el)) continue;
    const n = opNumber(el.node.operand, "Tran");
    el.name = n !== undefined && take(`tr${n}`) ? `tr${n}` : fresh("tr");
    el.given = true;
  }

  // operands of routines that aren't in the file (SPEC §7.3): kept as written, numbers reserved
  const knownOperands = new Set([...elements.map((e) => key(e.node.operand))]);
  const strays = new Set<string>();
  const reserved = { step: new Set<number>(), transition: new Set<number>() };
  for (const m of code.matchAll(/(?<![\w.])((?:Step|Tran|Action)_\d+)(?!\w)/gi)) {
    if (knownOperands.has(key(m[1]!))) continue;
    strays.add(m[1]!);
    const op = operandName(m[1]!);
    if (op && op.kind !== "action") reserved[op.kind].add(op.number);
  }
  if (strays.size) {
    info(`the code refers to ${[...strays].slice(0, 4).join(", ")}${strays.size > 4 ? "…" : ""}, ${strays.size > 1 ? "elements" : "an element"} of routines that aren't in the file: kept as written (their numbers aren't given to the imported elements)`);
  }

  // ---- operands: pin unnamed transitions whose number would change (SPEC §8.2)
  const order = skeletonOrder(parts, byUid);
  const pinPass = (): boolean => {
    const nums = numbering(order, reserved);
    let changed = false;
    // a step named from its tag description whose operand would change becomes s<N>, the name
    // going back into the description: the operand matters more (HMIs, other routines)
    for (const el of order.steps) {
      const want = opNumber(el.node.operand, "Step");
      if (el.node.kind !== "step" || el.name === undefined || el.plain || want === undefined || nums.get(el) === want) continue;
      if (pinnedOperand("step", el.name) !== undefined || !take(`s${want}`)) continue;
      el.description = el.description ? `${el.name} ${el.description}` : el.name;
      el.name = `s${want}`;
      el.plain = true;
      changed = true;
    }
    for (const el of order.transitions) {
      const want = opNumber(el.node.operand, "Tran");
      if (el.name !== undefined || want === undefined || nums.get(el) === want) continue;
      if (take(`tr${want}`)) {
        el.name = `tr${want}`;
        el.given = true;
        changed = true;
      }
    }
    return changed;
  };
  for (let i = 0; i < 50 && pinPass(); i++);
  const nums = numbering(order, reserved);
  const moved: string[] = [];
  const blocked: string[] = [];
  for (const el of order.transitions) {
    const want = opNumber(el.node.operand, "Tran");
    if (el.name === undefined && want !== undefined && nums.get(el) !== want) blocked.push(`tr${want}`);
  }
  for (const el of [...order.steps, ...order.transitions]) {
    const prefix = el.node.kind === "transition" ? "Tran" : "Step";
    if (el.node.kind === "stop") continue;
    const now = `${prefix}_${String(nums.get(el)).padStart(3, "0")}`;
    if (key(now) !== key(el.node.operand)) moved.push(`${el.node.operand} (${el.name ?? "a transition"}) → ${now}`);
  }
  if (moved.length) {
    warn(`operands renumbered on export: ${moved.slice(0, 5).join(", ")}${moved.length > 5 ? `, and ${moved.length - 5} more` : ""} (a step named s<N> or a transition tr<N> keeps its operand${blocked.length ? `; ${blocked.slice(0, 4).join(", ")} ${blocked.length > 1 ? "are" : "is"} already used by other names here` : ""})`);
  }
  const plainNamed = steps.filter((e) => e.plain).length;
  if (plainNamed) info(`${plainNamed} step${plainNamed > 1 ? "s have" : " has"} no name in Studio: named from the operand (Step_003 → s3), which keeps the operand on export`);

  // ---- operand → name map for the code
  const rename = new Map<string, string>();
  for (const el of elements) if (el.name !== undefined) rename.set(key(el.node.operand), el.name);

  // ---- leftovers that are not per element
  const stops = steps.filter((e) => e.node.kind === "stop");
  if (stops.length) warn(`${stops.length} Stop element${stops.length > 1 ? "s" : ""} (${stops.map((s) => s.node.operand).join(", ")}): written as a step that ends the chain`);
  for (const el of steps) {
    if (el.node.kind !== "step") continue;
    const t = tagByKey.get(key(el.node.operand));
    const extras = ["alarmen", "limitlow", "limithigh"].filter((m) => (t?.members.get(m) ?? "0") !== "0");
    const exprs = ["PresetUsesExpr", "LimitHighUsesExpr", "LimitLowUsesExpr"].filter((a) => attr(el.node.el, a) === "true");
    if (extras.length || exprs.length) {
      warn(`step ${el.name}: ${[...extras.map((m) => ({ alarmen: "alarm", limitlow: "LimitLow", limithigh: "LimitHigh" })[m]), ...exprs.map((a) => a.replace("UsesExpr", " expression"))].join(", ")} not kept`, partName(parts, el));
    }
  }

  // ---- tags, io (program and controller scope, SPEC §7.7)
  const scoped = { program: { tagLines: [] as string[], io: [] as Array<[string, string, string]> }, controller: { tagLines: [] as string[], io: [] as Array<[string, string, string]> } };
  const values: string[] = [];
  const unusedSfc: string[] = [];
  const renamedCode = renameIdentifiers(code, rename);
  const aliasBases = new Set(tags.flatMap((t) => (t.alias !== undefined ? [key(/^\w+/.exec(t.alias)?.[0] ?? "")] : [])));
  let unusedController = 0;
  const strayKeys = new Set([...strays].map(key));
  for (const t of tags) {
    // the tag of an element of another routine, named by the code (`Step_016.Count`): declared,
    // so the export creates it (SPEC §7.3)
    const op = strayKeys.has(key(t.name)) ? operandName(t.name) : undefined;
    if (op) {
      const type = op.kind === "step" ? "SFC_STEP" : op.kind === "action" ? "SFC_ACTION" : "BOOL";
      const pre = op.kind === "step" ? Number(t.members.get("pre") ?? 0) : 0;
      const value = pre > 0 && Number.isInteger(pre) ? ` ${formatDuration(pre)}` : "";
      (t.controller ? scoped.controller : scoped.program).tagLines.push(`tag ${t.name} : ${type}${value}${t.description ? ` ${quote(t.description)}` : ""}`);
      continue;
    }
    if (isSfcTag(t)) {
      if (!sfcOperands.has(key(t.name)) && !t.controller) unusedSfc.push(t.name);
      continue;
    }
    // a controller export holds every controller tag: keep the ones the program uses
    if (t.controller && whole && !ident(t.name).test(renamedCode) && !aliasBases.has(key(t.name))) {
      unusedController++;
      continue;
    }
    // with the element tags moved to the program, an alias of one moves too (a controller tag
    // can't alias a program tag)
    const aliasOfElement = t.alias !== undefined && knownOperands.has(key(/^\w+/.exec(t.alias)?.[0] ?? ""));
    const { tagLines, io } = t.controller && !(options.sfcTagsAtProgram && aliasOfElement) ? scoped.controller : scoped.program;
    if (t.alias !== undefined) {
      if (IO_ADDRESS_RE.test(t.alias) || TAG_PATH_RE.test(t.alias)) io.push([t.name, renameIdentifiers(t.alias, rename), t.description ? quote(t.description) : ""]);
      else warn(`alias tag ${t.name} (for ${t.alias}) not kept: qSFC aliases I/O addresses and tag members`);
      continue;
    }
    const type = t.dataType.toUpperCase();
    if (!["BOOL", "DINT", "REAL", "TIMER"].includes(type) || t.complex) {
      warn(`tag ${t.name} : ${t.dataType} can't be declared in qSFC yet: its type will be inferred from its use`);
      continue;
    }
    // the initial value (SPEC §7.4): a TIMER's preset, else the tag's value
    const raw = type === "TIMER" ? t.members.get("pre") : t.value;
    const num = raw === undefined || raw === "" ? 0 : Number(raw);
    let value = "";
    if (!Number.isFinite(num) || (type === "TIMER" && (!Number.isInteger(num) || num < 0))) values.push(`${t.name} = ${raw}`);
    else if (num !== 0) value = type === "TIMER" ? ` ${formatDuration(num)}` : ` = ${type === "BOOL" ? (num ? 1 : 0) : raw}`;
    const used = ident(t.name).test(renamedCode);
    if (type === "BOOL" && !t.description && !value && used && !t.controller) {
      // created by its use (SPEC §7.1); a controller tag is always declared, for its scope
    } else tagLines.push(`tag ${t.name} : ${type}${value}${t.description ? ` ${quote(t.description)}` : ""}`);
  }
  if (values.length) warn(`values not kept: ${values.join(", ")}`);
  const ioBlock = (io: Array<[string, string, string]>, indent: string): string[] => {
    const w1 = Math.max(0, ...io.map((x) => x[0].length));
    const w2 = Math.max(0, ...io.map((x) => x[1].length));
    return io.map(([n, a, d]) => (d ? `${indent}${n.padEnd(w1)}  ${a.padEnd(w2)}  ${d}` : `${indent}${n.padEnd(w1)}  ${a}`));
  };
  const sfcTags = elements.filter((e) => e.name !== undefined && atController(e)).map((e) => e.name!);
  if (sfcTags.length) info(`${sfcTags.length} step and transition tag${sfcTags.length > 1 ? "s are" : " is"} at controller scope in Studio: listed on the controller block's \`sfc tags\` line, so the export keeps ${sfcTags.length > 1 ? "them" : "it"} there`);
  if (unusedController) info(`${unusedController} controller tag${unusedController > 1 ? "s" : ""} not used by this program left out`);
  if (unusedSfc.length) info(`${unusedSfc.length} step or action tag${unusedSfc.length > 1 ? "s" : ""} not used by any chart (${unusedSfc.slice(0, 3).join(", ")}${unusedSfc.length > 3 ? "…" : ""}) left out`);

  // ---- writing, with sugar checked against the plain text
  const header: Header = {
    programName,
    description: descriptionOf(program),
    uses: usesNames,
    mainName,
    tagLines: scoped.program.tagLines,
    ioLines: ioBlock(scoped.program.io, "  "),
    controller: { tagLines: scoped.controller.tagLines.map((l) => `  ${l}`), ioLines: ioBlock(scoped.controller.io, "    "), sfcTags },
  };
  const ctx: GenContext = { parts, byUid, rename, tagByKey, skipped, header, notes: [] };
  const plain = generate(ctx, "all");
  const plainCompiled = compile(plain.source);
  let final = plain;
  if (!hasErrors(plainCompiled.diagnostics)) {
    const reference = exportedTexts(plainCompiled);
    const off = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const sugar = generate(ctx, off);
      const compiled = compile(sugar.source);
      const bad = hasErrors(compiled.diagnostics)
        ? new Set(compiled.diagnostics.filter((d) => d.severity === "error").map((d) => sugar.owner[d.span.line - 1]).filter((o): o is string => !!o))
        : differing(sugar, exportedTexts(compiled), reference);
      if (!bad.size && !hasErrors(compiled.diagnostics)) {
        final = sugar;
        break;
      }
      const before = off.size;
      for (const b of bad) off.add(b);
      if (off.size === before) break;
    }
  }
  notes.push(...dedupe(final.notes));
  const source = withSummary(final.source, notes);
  const errors = compile(source).diagnostics.filter((d) => d.severity === "error");
  if (errors.length) {
    warn(`${errors.length} error${errors.length > 1 ? "s" : ""} left in the imported text (first: line ${errors[0]!.span.line}, ${errors[0]!.message}); fix ${errors.length > 1 ? "them" : "it"} in the editor`);
  }
  const controllerSfcTags = elements.filter((e) => e.node.kind !== "stop" && tagByKey.get(key(e.node.operand))?.controller === true).length;
  return { source, program: programName, routines: report, notes, errors: errors.length, controllerSfcTags };
}

function dedupe(notes: ImportNote[]): ImportNote[] {
  const seen = new Set<string>();
  return notes.filter((n) => {
    const k = `${n.level}|${n.routine ?? ""}|${n.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function partName(parts: Part[], el: Element): string {
  return parts[el.routine]!.name;
}

function firstActionLines(node: SfcNode): string[] {
  const a = node.el.children.find((c) => c.name === "Action");
  return a ? stLines(a) : [];
}

/** Steps and transitions in the order of the generated file (the skeleton's line order). */
function skeletonOrder(parts: Part[], byUid: Map<string, Element>): { steps: Element[]; transitions: Element[] } {
  const steps: Element[] = [];
  const transitions: Element[] = [];
  parts.forEach((p, ri) => {
    if (p.kind !== "sfc") return;
    const ids = synthetic(p.chart);
    for (const line of p.skeleton.split("\n")) {
      const s = /^\s*(?:init|step) (\S+)$/.exec(line);
      const t = /^\s*-- (\S+): TRUE/.exec(line);
      const id = ids.get((s?.[1] ?? t?.[1] ?? "").toLowerCase());
      if (id === undefined) continue;
      (s ? steps : transitions).push(byUid.get(`${ri}/${id}`)!);
    }
  });
  return { steps, transitions };
}

/** Operand numbers as the export gives them (assignOperands in src/lower), Stops left out. */
function numbering(
  order: { steps: Element[]; transitions: Element[] },
  reserved: Record<"step" | "transition", ReadonlySet<number>>,
): Map<Element, number> {
  const out = new Map<Element, number>();
  const run = (list: Element[], kind: "step" | "transition") => {
    const pin = (e: Element) => (e.name === undefined ? undefined : pinnedOperand(kind, e.name));
    const pinned = new Set([...reserved[kind], ...list.map(pin).filter((n): n is number => n !== undefined)]);
    let next = 0;
    for (const e of list) {
      const p = pin(e);
      if (p !== undefined) out.set(e, p);
      else {
        while (pinned.has(next)) next++;
        out.set(e, next++);
      }
    }
  };
  // Stops are written as steps, so they take step operands too
  run(order.steps, "step");
  run(order.transitions, "transition");
  return out;
}

/** Synthetic skeleton name (`s12`, `t39`) → element ID. */
function synthetic(chart: SfcChart): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of chart.nodes.values()) m.set((n.kind === "transition" ? transName(n.id) : stepName(n.id)).toLowerCase(), n.id);
  return m;
}

// ---- generation -------------------------------------------------------------------------------

interface Header {
  programName: string;
  description: string | undefined;
  /** Routines not imported (SPEC §4.5 `uses`), in file order. */
  uses: string[];
  /** The `controller` block (SPEC §7.7): indented tag and io lines, `sfc tags` names. */
  controller: { tagLines: string[]; ioLines: string[]; sfcTags: string[] };
  mainName: string;
  tagLines: string[];
  ioLines: string[];
}

interface GenContext {
  parts: Part[];
  byUid: Map<string, Element>;
  rename: Map<string, string>;
  tagByKey: Map<string, L5XTag>;
  skipped: Map<string, string>;
  header: Header;
  notes: ImportNote[];
}

interface Generated {
  source: string;
  /** Output line (0-based) → owner key (`uid` of a step / transition, `st:<routine>:<line>`). */
  owner: Array<string | undefined>;
  /** Per routine: owners of the steps and transitions in file order, and of the ST lines. */
  order: Array<{ steps: string[]; transitions: string[]; lines: string[] }>;
  notes: ImportNote[];
}

const QUALIFIER_LETTER = new Map(Object.entries(QUALIFIER_NAMES).map(([q, word]) => [word.toLowerCase(), q] as const));

/** `plain`: "all" = no sugar anywhere; else the owners that must stay plain. */
function generate(ctx: GenContext, plain: "all" | Set<string>): Generated {
  const out: string[] = [];
  const owner: Array<string | undefined> = [];
  const notes: ImportNote[] = [];
  const order: Generated["order"] = [];
  const push = (line: string, who?: string) => {
    out.push(line);
    owner.push(who);
  };
  const sugarOn = (who: string) => plain !== "all" && !plain.has(who);
  const { header, parts } = ctx;

  const ctl = header.controller;
  if (ctl.tagLines.length || ctl.ioLines.length || ctl.sfcTags.length) {
    push("controller");
    for (const l of ctl.tagLines) push(l);
    if (ctl.ioLines.length) {
      push("  io");
      for (const l of ctl.ioLines) push(l);
      push("  end");
    }
    if (ctl.sfcTags.length) push(`  sfc tags ${ctl.sfcTags.join(", ")}`);
    push("end");
    push("");
  }
  const first = parts[0]!.name;
  if (key(header.programName) !== key(first) || header.description) {
    push(`program ${header.programName}${header.description ? ` ${quote(header.description)}` : ""}`);
  }
  if (header.uses.length) {
    push(`uses ${header.uses.map((n) => (key(n) === key(header.mainName) ? `${n} (main)` : n)).join(", ")}`);
  }
  if (header.tagLines.length) {
    if (out.length) push("");
    for (const l of header.tagLines) push(l);
  }
  if (header.ioLines.length) {
    if (out.length) push("");
    push("io");
    for (const l of header.ioLines) push(l);
    push("end");
  }

  parts.forEach((p, ri) => {
    if (out.length) push("");
    const ord = { steps: [] as string[], transitions: [] as string[], lines: [] as string[] };
    order.push(ord);
    if (p.kind === "st") {
      push(`st ${p.name}`);
      p.lines.forEach((raw, i) => {
        const who = `st:${ri}:${i}`;
        ord.lines.push(who);
        const line = codeLine(ctx, raw, sugarOn(who), notes, p.name);
        push(line.trim() ? `  ${line}` : "", who);
      });
      return;
    }
    push(`sfc ${p.name}`);
    const ids = synthetic(p.chart);
    const el = (name: string) => ctx.byUid.get(`${ri}/${ids.get(name.toLowerCase())}`)!;
    const boxes = textBoxes(p.chart);
    for (const text of boxes.get("") ?? []) for (const l of text) push(`// ${l}`);
    const frames: Array<{ kind: string; before: string | undefined }> = [];
    let prev: string | undefined;
    for (const line of p.skeleton.replace(/\n$/, "").split("\n")) {
      const ind = /^\s*/.exec(line)![0];
      const body = line.slice(ind.length);
      const sm = /^(init|step) (\S+)$/.exec(body);
      const tm = /^-- (\S+): TRUE(?: -> (\S+))?$/.exec(body);
      if (sm) {
        const e = el(sm[2]!);
        ord.steps.push(e.uid);
        for (const text of boxes.get(e.node.id) ?? []) for (const l of text) push(`${ind}// ${l}`, e.uid);
        writeStep(ctx, e, sm[1]!, ind, sugarOn(e.uid), push, notes, p.name);
        prev = e.name;
      } else if (tm) {
        const e = el(tm[1]!);
        ord.transitions.push(e.uid);
        for (const text of boxes.get(e.node.id) ?? []) for (const l of text) push(`${ind}// ${l}`, e.uid);
        const cond = condition(ctx, e, sugarOn(e.uid) ? prev : undefined, notes, p.name);
        const label = e.name !== undefined ? `${e.name}: ` : "";
        const jump = tm[2] !== undefined ? ` -> ${el(tm[2]).name}` : "";
        push(`${ind}-- ${label}${cond}${jump}`, e.uid);
      } else {
        push(line);
        if (body === "select" || body === "parallel") frames.push({ kind: body, before: prev });
        else if (body === "|") prev = frames[frames.length - 1]?.kind === "select" ? frames[frames.length - 1]!.before : undefined;
        else if (body === "end") {
          frames.pop();
          prev = undefined;
        }
      }
    }
  });
  return { source: out.join("\n") + "\n", owner, order, notes };
}

type Push = (line: string, who?: string) => void;

function writeStep(ctx: GenContext, e: Element, kw: string, ind: string, sugar: boolean, push: Push, notes: ImportNote[], routine: string): void {
  const node = e.node;
  const preset = Number(ctx.tagByKey.get(key(node.operand))?.members.get("pre") ?? 0);
  if (node.kind === "stop") push(`${ind}// Studio Stop element ${node.operand}`, e.uid);
  const dur = node.kind === "step" && preset > 0 ? ` ${formatDuration(preset)}` : "";
  const desc = e.description ? ` ${quote(e.description)}` : "";
  push(`${ind}${kw} ${e.name}${dur}${desc}`, e.uid);
  const actions = node.el.children.filter((c) => c.name === "Action");
  let written = 0;
  actions.forEach((a, i) => {
    let lines = stLines(a);
    if (i === 0 && lines[0] !== undefined && lines[0].trim() === stepNameComment(e.name!, e.description)) lines = lines.slice(1);
    while (lines.length && !lines[0]!.trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
    const word = (attr(a, "Qualifier") ?? "NonStored").toLowerCase();
    let q = QUALIFIER_LETTER.get(word);
    if (q === undefined) {
      notes.push({ level: "warning", routine, text: `step ${e.name}: qualifier ${attr(a, "Qualifier")} has no qSFC form yet, written as N` });
      lines = [`// Studio qualifier: ${attr(a, "Qualifier")}`, ...lines];
      q = "N";
    }
    if (attr(a, "IsBoolean") === "true") notes.push({ level: "warning", routine, text: `step ${e.name}: a Boolean action (no ST) is written as a normal action` });
    if (attr(a, "PresetUsesExpr") === "true") notes.push({ level: "warning", routine, text: `step ${e.name}: an action time expression is not kept` });
    if (written === 0 && q === "N" && lines.length === 0) return;
    const timed = q === "L" || q === "D";
    const time = timed ? ` ${formatDuration(Number(ctx.tagByKey.get(key(attr(a, "Operand") ?? ""))?.members.get("pre") ?? 0))}` : "";
    const headed = written > 0 || q !== "N";
    if (headed) push(`${ind}  ${q}${time}`, e.uid);
    const bodyInd = `${ind}${headed ? "    " : "  "}`;
    if (!lines.length) lines = ["// (empty action in Studio)"];
    for (const raw of lines) {
      const line = codeLine(ctx, raw, sugar, notes, routine);
      push(line.trim() ? bodyInd + line : "", e.uid);
    }
    written++;
  });
}

/** One ST line: operands → names, then sugar. A JSR to a routine not imported stays (`uses`). */
function codeLine(ctx: GenContext, raw: string, sugar: boolean, notes: ImportNote[], routine: string): string {
  const line = renameIdentifiers(raw, ctx.rename);
  if (!sugar) return line;
  const indent = /^\s*/.exec(line)![0];
  const rest = line.slice(indent.length);
  const at = rest.indexOf("//");
  const codePart = (at < 0 ? rest : rest.slice(0, at)).trimEnd();
  const comment = at < 0 ? "" : rest.slice(at);
  // exactly as the export writes a sugar line: `a [:=] 1; b [:=] 1;`, then ` // comment`
  if (/^[A-Za-z_]\w* (?:\[:=\]|:=) [01];(?: [A-Za-z_]\w* (?:\[:=\]|:=) [01];)*$/.test(codePart) && (comment ? `${codePart} ${comment}` : codePart) === rest) {
    const stmts = [...codePart.matchAll(/([A-Za-z_]\w*) (\[:=\]|:=) ([01]);/g)];
    const kinds = new Set(stmts.map((x) => `${x[2]}${x[3]}`));
    const names = stmts.map((x) => x[1]!);
    const word = kinds.size !== 1 ? undefined : ({ "[:=]1": "on", ":=1": "set", ":=0": "reset" } as Record<string, string>)[[...kinds][0]!];
    if (word && names.every((n) => isBool(ctx, n))) return `${indent}${word} ${names.join(", ")}${comment ? ` ${comment}` : ""}`;
  }
  return line.replace(/\bJSR\(([A-Za-z_]\w*),0\)/g, (all, name: string, at: number) =>
    ctx.parts.some((p) => key(p.name) === key(name)) && !line.slice(0, at).includes("//") ? `call ${name}` : all,
  );
}

function isBool(ctx: GenContext, name: string): boolean {
  const t = ctx.tagByKey.get(key(name));
  if (!t) return false;
  if (t.alias !== undefined) return /\.\d+$/.test(t.alias);
  return t.dataType.toUpperCase() === "BOOL";
}

function condition(ctx: GenContext, e: Element, after: string | undefined, notes: ImportNote[], routine: string): string {
  const lines = e.node.el.children.find((c) => c.name === "Condition");
  const raw = lines ? stLines(lines) : e.node.text;
  const parts = raw.map((l, i) => {
    const t = l.trim();
    const c = t.indexOf("//");
    return i < raw.length - 1 && c >= 0 ? `${t.slice(0, c)}(* ${t.slice(c + 2).trim()} *)` : t;
  });
  let cond = renameIdentifiers(parts.filter(Boolean).join(" "), ctx.rename).replace(/\s*;\s*(\/\/.*)?$/, (_m, c?: string) => (c ? ` ${c}` : ""));
  if (!cond.trim() || /^\/\//.test(cond.trim())) {
    notes.push({ level: "warning", routine, text: `transition ${e.name ?? e.node.operand} has no condition in Studio: written TRUE` });
    return `TRUE${cond.trim() ? ` ${cond.trim()}` : ""}`;
  }
  if (/^1(\s*\/\/.*)?$/.test(cond)) cond = cond.replace(/^1/, "TRUE");
  else if (/^0(\s*\/\/.*)?$/.test(cond)) cond = cond.replace(/^0/, "FALSE");
  if (after !== undefined) {
    const re = new RegExp(`(?<![\\w.])${after}\\.T >= (\\d+)(?![\\w.])`, "gi");
    cond = cond.replace(re, (_m, ms: string) => `after ${formatDuration(Number(ms))}`);
  }
  return cond;
}

/** Text box lines by the ID of the element they are attached to ("" = not attached). */
function textBoxes(chart: SfcChart): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  for (const box of chart.textBoxes) {
    const texts = [box.text, ...scanDescendants(box).filter((d) => d.name !== "Attachment").map((d) => d.text)];
    const lines = texts.join("\n").replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const at = chart.attached.get(attr(box, "ID") ?? "") ?? "";
    const target = chart.nodes.has(at) ? at : "";
    (out.get(target) ?? out.set(target, []).get(target)!).push(lines);
  }
  return out;
}

/** Owners whose exported text differs from the plain version's. */
function differing(gen: Generated, got: ReturnType<typeof exportedTexts>, want: ReturnType<typeof exportedTexts>): Set<string> {
  const bad = new Set<string>();
  gen.order.forEach((o, ri) => {
    const a = got[ri];
    const b = want[ri];
    if (!a || !b) return;
    if (a.lines && b.lines) {
      o.lines.forEach((who, i) => {
        if (a.lines![i] !== b.lines![i]) bad.add(who);
      });
      if (a.lines.length !== b.lines.length) for (const who of o.lines) bad.add(who);
      return;
    }
    const ga = a.graph as Graph | undefined;
    const gb = b.graph as Graph | undefined;
    if (!ga || !gb) return;
    o.steps.forEach((who, i) => {
      if (JSON.stringify(ga.steps[i]?.actions.map((x) => [x.qualifier, x.timeMs, x.lines])) !== JSON.stringify(gb.steps[i]?.actions.map((x) => [x.qualifier, x.timeMs, x.lines]))) bad.add(who);
    });
    o.transitions.forEach((who, i) => {
      if (ga.transitions[i]?.condition !== gb.transitions[i]?.condition) bad.add(who);
    });
  });
  return bad;
}

/** The warnings as a comment block at the top of the file (SPEC §8.7). */
function withSummary(source: string, notes: ImportNote[]): string {
  const warnings = notes.filter((n) => n.level === "warning");
  const head = ["// Imported from a Studio 5000 L5X by QuickSFC."];
  if (warnings.length) {
    head.push("// Not kept or changed:");
    for (const w of warnings) head.push(`//  - ${w.routine ? `${w.routine}: ` : ""}${w.text}`);
  }
  return `${head.join("\n")}\n\n${source}`;
}
