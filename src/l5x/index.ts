/**
 * L5X writer (Studio 5000, Program-level export) and self-check.
 * Serialization follows l5xgen.py / L5X_GUIDE.md, verified by real imports.
 */
import type { Graph, GStep, TagInfo } from "../model/graph.js";
import type { L5XPositions } from "../model/positions.js";
import { descendants, parseXml, textOf, XmlError, type XmlElement } from "./xml.js";

export { parseXml, XmlError } from "./xml.js";
export type { XmlElement } from "./xml.js";

/** One routine of a program export (SPEC §4.5, §8.1). */
export type L5XRoutine =
  /** `hiddenLinks`: graph links `from-to` written with Show="false" (hidden wires). */
  | { kind: "sfc"; name: string; graph: Graph; positions: L5XPositions; hiddenLinks?: ReadonlySet<string> }
  /** ST routine: body lines, already rewritten (`call` → `JSR`, step references → operands). */
  | { kind: "st"; name: string; lines: string[] };

export interface L5XProgramOptions extends Omit<L5XOptions, "routineName"> {
  /** Default: the first routine. */
  mainRoutineName?: string;
}

export interface L5XOptions {
  programName: string;
  routineName: string;
  /** Default "32.01". */
  softwareRevision?: string;
  /** Default "QuickSFC". */
  controllerName?: string;
  /** Default: now. Injected in tests. Local time is used, as Studio does. */
  exportDate?: Date;
  /** Default true: step/transition names go to the descriptions of their tags. */
  describeElements?: boolean;
  /**
   * Default true: every step's action starts with a comment holding the step name
   * (`// fill`, or `// fill - Fill the tank` with a description). A step without an action
   * gets an action holding only that comment. Keeps the name visible in Studio even if tag
   * descriptions don't show beside the steps (test pack question).
   */
  nameComments?: boolean;
  /**
   * Default: same as `nameComments`. Hide the description boxes (HideDesc="true", the way Studio
   * stores a hidden description; verified by the tp01_hidden import, 2026-11-26). The names stay
   * in the tag descriptions, for the Tags list and the Phase 4 import.
   */
  hideDescriptions?: boolean;
}

/** First action line written when `nameComments` is on. Phase 4 import strips it. */
export function stepNameComment(name: string, description?: string): string {
  const desc = description?.replace(/\s*\r?\n\s*/g, " ").trim();
  return desc ? `// ${name} - ${desc}` : `// ${name}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function exportDate(d: Date): string {
  return (
    `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getFullYear()}`
  );
}

const EXPORT_OPTIONS =
  "References NoRawData L5KData DecoratedData Context Dependencies ForceProtectedEncoding AllProjDocTrans LogicalHierarchy";

const NAME_RULE = /^[A-Za-z_](?!.*__)[A-Za-z0-9_]{0,39}$/;

function assertName(name: string, what: string): void {
  if (!NAME_RULE.test(name) || name.endsWith("_")) {
    throw new Error(`L5X: invalid Studio name for ${what}: ${JSON.stringify(name)}`);
  }
}

function cdata(text: string): string {
  if (text.includes("]]>")) throw new Error(`L5X: text cannot contain ']]>': ${JSON.stringify(text)}`);
  return `<![CDATA[${text}]]>`;
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Description lines. Line breaks inside the text use CRLF, like the rest of the file. */
function description(text: string | undefined): string[] {
  if (!text) return [];
  return ["<Description>", cdata(text.replace(/\r\n|\r|\n/g, "\r\n")), "</Description>"];
}

type Member = [name: string, type: string, value: string | number, radix: string | null];

function data(l5k: string, decorated: string[]): string[] {
  return ['<Data Format="L5K">', cdata(l5k), "</Data>", '<Data Format="Decorated">', ...decorated, "</Data>"];
}

function structure(type: string, members: Member[]): string[] {
  return [
    `<Structure DataType="${type}">`,
    ...members.map(
      ([n, t, v, r]) => `<DataValueMember Name="${n}" DataType="${t}"${r ? ` Radix="${r}"` : ""} Value="${v}"/>`,
    ),
    "</Structure>",
  ];
}

interface TagLines {
  name: string;
  lines: string[];
}

function baseTag(name: string, type: string, body: string[], desc: string | undefined, radix: string | null): TagLines {
  const radixAttr = radix ? ` Radix="${radix}"` : "";
  return {
    name,
    lines: [
      `<Tag Name="${name}" TagType="Base" DataType="${type}"${radixAttr} Constant="false" ExternalAccess="Read/Write">`,
      ...description(desc),
      ...body,
      "</Tag>",
    ],
  };
}

const boolTag = (name: string, desc?: string) =>
  baseTag(name, "BOOL", data("0", ['<DataValue DataType="BOOL" Radix="Decimal" Value="0"/>']), desc, "Decimal");

const dintTag = (name: string, desc?: string) =>
  baseTag(name, "DINT", data("0", ['<DataValue DataType="DINT" Radix="Decimal" Value="0"/>']), desc, "Decimal");

/** UNVERIFIED: notation from L5X_GUIDE 6c (L5K 0.00000000e+000, Decorated Radix Float Value 0.0). */
const realTag = (name: string, desc?: string) =>
  baseTag(name, "REAL", data("0.00000000e+000", ['<DataValue DataType="REAL" Radix="Float" Value="0.0"/>']), desc, "Float");

const timerTag = (name: string, desc?: string) =>
  baseTag(
    name,
    "TIMER",
    data(
      "[0,0,0]",
      structure("TIMER", [
        ["PRE", "DINT", 0, "Decimal"],
        ["ACC", "DINT", 0, "Decimal"],
        ["EN", "BOOL", 0, null],
        ["TT", "BOOL", 0, null],
        ["DN", "BOOL", 0, null],
      ]),
    ),
    desc,
    null,
  );

function sfcStepTag(name: string, pre: number, desc?: string): TagLines {
  const members: Member[] = [["Status", "DINT", "16#0000_0000", "Hex"]];
  for (const m of ["X", "FS", "SA", "LS", "DN", "OV", "AlarmEn", "AlarmLow", "AlarmHigh", "Reset", "PauseTimer"]) {
    members.push([m, "BOOL", 0, null]);
  }
  members.push(["PRE", "DINT", pre, "Decimal"]);
  for (const m of ["T", "TMax", "Count", "LimitLow", "LimitHigh"]) members.push([m, "DINT", 0, "Decimal"]);
  return baseTag(name, "SFC_STEP", data(`[0,${pre},0,0,0,0,0]`, structure("SFC_STEP", members)), desc, null);
}

function sfcActionTag(name: string): TagLines {
  const members: Member[] = [
    ["Status", "DINT", "16#0000_0000", "Hex"],
    ["A", "BOOL", 0, null],
    ["Q", "BOOL", 0, null],
    ["PauseTimer", "BOOL", 0, null],
    ["PRE", "DINT", 0, "Decimal"],
    ["T", "DINT", 0, "Decimal"],
    ["Count", "DINT", 0, "Decimal"],
  ];
  return baseTag(name, "SFC_ACTION", data("[0,0,0,0]", structure("SFC_ACTION", members)), undefined, null);
}

function stLines(lines: string[]): string[] {
  const out = ["<STContent>"];
  lines.forEach((l, i) => out.push(`<Line Number="${i}">`, cdata(l), "</Line>"));
  out.push("</STContent>");
  return out;
}

const operand = (prefix: string, n: number) => `${prefix}_${pad(n, 3)}`;

function userTag(t: TagInfo): TagLines {
  assertName(t.name, "tag");
  switch (t.type) {
    case "BOOL":
      return boolTag(t.name, t.description);
    case "DINT":
      return dintTag(t.name, t.description);
    case "REAL":
      return realTag(t.name, t.description);
    case "TIMER":
      return timerTag(t.name, t.description);
    default:
      throw new Error(`L5X: unsupported tag type ${String(t.type)} for ${t.name}`);
  }
}

function stepDescription(s: GStep): string {
  return s.description ? `${s.name}\r\n${s.description}` : s.name;
}

/** One SFC routine program (the Phase 1 export). */
export function writeL5X(graph: Graph, positions: L5XPositions, tags: TagInfo[], options: L5XOptions): string {
  const { routineName, ...rest } = options;
  return writeProgramL5X([{ kind: "sfc", name: routineName, graph, positions }], tags, rest);
}

interface Counters {
  tagLines: TagLines[];
  /** Action operands are numbered across the whole program. */
  actionNo: number;
  describe: boolean;
  nameComments: boolean;
  hide: boolean;
}

function sfcRoutine(
  name: string,
  graph: Graph,
  positions: L5XPositions,
  c: Counters,
  hidden: ReadonlySet<string> = new Set(),
): string[] {
  const { tagLines, describe, nameComments, hide } = c;
  const hideAttr = hide ? "true" : "false";
  const withDesc = describe && (hide || !nameComments);
  const routine: string[] = [
    `<Routine Name="${name}" Type="SFC">`,
    '<SFCContent SheetSize="Letter - 8.5 x 11 in" SheetOrientation="Landscape" StepName="Step" TransitionName="Tran" ActionName="Action" StopName="Stop">',
  ];

  const ids = new Map<string, number>();
  let nextId = 0;
  const allocate = (key: string): number => {
    if (ids.has(key)) throw new Error(`L5X: duplicate graph id ${key}`);
    const id = nextId++;
    ids.set(key, id);
    return id;
  };
  const pos = (id: string) => {
    const p = positions.nodes.get(id);
    if (!p) throw new Error(`L5X: no position for ${id}`);
    return p;
  };

  for (const s of graph.steps) {
    const op = operand("Step", s.index);
    const sid = allocate(s.id);
    const { x, y } = pos(s.id);
    // Studio draws a tag description as a box over the action box and ignores HideDesc
    // (tp01 import, 2026-11-26): with name comments, the name lives only in the comment.
    tagLines.push(sfcStepTag(op, s.presetMs, withDesc ? stepDescription(s) : undefined));
    const head =
      `<Step ID="${sid}" X="${x}" Y="${y}" Operand="${op}" HideDesc="${hideAttr}" DescX="${x + 40}" DescY="${y - 20}" DescWidth="0" ` +
      `InitialStep="${s.initial ? "true" : "false"}" PresetUsesExpr="false" LimitHighUsesExpr="false" LimitLowUsesExpr="false" ShowActions="true"`;
    const actionLines = nameComments ? [stepNameComment(s.name, s.description), ...s.action] : s.action;
    if (actionLines.length === 0) {
      routine.push(head + "/>");
      continue;
    }
    routine.push(head + ">");
    const aop = operand("Action", c.actionNo++);
    tagLines.push(sfcActionTag(aop));
    routine.push(
      `<Action ID="${nextId++}" Operand="${aop}" Qualifier="NonStored" IsBoolean="false" PresetUsesExpr="false">`,
      "<Body>",
      ...stLines(actionLines),
      "</Body>",
      "</Action>",
      "</Step>",
    );
  }

  for (const t of graph.transitions) {
    const op = operand("Tran", t.index);
    const tid = allocate(t.id);
    const { x, y } = pos(t.id);
    // No description box for transitions either: it covers the condition text (tp01 import).
    tagLines.push(boolTag(op, withDesc ? t.name : undefined));
    routine.push(
      `<Transition ID="${tid}" X="${x}" Y="${y}" Operand="${op}" HideDesc="${hideAttr}" DescX="${x + 60}" DescY="${y - 20}" DescWidth="0">`,
      "<Condition>",
      ...stLines([t.condition]),
      "</Condition>",
      "</Transition>",
    );
  }

  for (const b of graph.branches) {
    const bid = allocate(b.id);
    const by = positions.branches.get(b.id);
    if (!by) throw new Error(`L5X: no position for branch ${b.id}`);
    const type = b.type === "selection" ? "Selection" : "Simultaneous";
    const flow = b.flow === "diverge" ? "Diverge" : "Converge";
    const priority = b.type === "selection" && b.flow === "diverge" ? ' Priority="Default"' : "";
    routine.push(`<Branch ID="${bid}" Y="${by.y}" BranchType="${type}" BranchFlow="${flow}"${priority}>`);
    for (const leg of b.legs) routine.push(`<Leg ID="${allocate(leg.id)}"/>`);
    routine.push("</Branch>");
  }

  const links = graph.links.map((l) => {
    const from = ids.get(l.from);
    const to = ids.get(l.to);
    if (from === undefined || to === undefined) throw new Error(`L5X: link ${l.from} -> ${l.to} refers to an unknown id`);
    return [from, to, !hidden.has(`${l.from}-${l.to}`)] as const;
  });
  links.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // Show="false": a hidden wire; Studio draws connector labels at both ends (tp05 import)
  for (const [a, b, show] of links) routine.push(`<DirectedLink FromID="${a}" ToID="${b}" Show="${show}"/>`);
  routine.push("</SFCContent>", "</Routine>");
  return routine;
}

/** ST routine. UNVERIFIED in Studio (test pack tp08): format taken from the ST of SFC actions. */
function stRoutine(name: string, lines: string[]): string[] {
  return [`<Routine Name="${name}" Type="ST">`, ...stLines(lines.length ? lines : [""]), "</Routine>"];
}

/** A program with one or more routines (SPEC §4.5, §8.1). Routines are written in the given order. */
export function writeProgramL5X(routines: L5XRoutine[], tags: TagInfo[], options: L5XProgramOptions): string {
  const { programName } = options;
  const revision = options.softwareRevision ?? "32.01";
  const controller = options.controllerName ?? "QuickSFC";
  if (routines.length === 0) throw new Error("L5X: a program needs at least one routine");
  const main = options.mainRoutineName ?? routines[0]!.name;
  assertName(programName, "program");
  const routineKeys = new Set<string>();
  for (const r of routines) {
    assertName(r.name, "routine");
    const k = r.name.toLowerCase();
    if (routineKeys.has(k)) throw new Error(`L5X: duplicate routine name ${r.name}`);
    routineKeys.add(k);
  }
  if (!routineKeys.has(main.toLowerCase())) throw new Error(`L5X: main routine ${main} is not in the program`);

  const counters: Counters = {
    tagLines: [],
    actionNo: 0,
    describe: options.describeElements ?? true,
    nameComments: options.nameComments ?? true,
    hide: options.hideDescriptions ?? options.nameComments ?? true,
  };
  const routineLines = routines.flatMap((r) =>
    r.kind === "sfc" ? sfcRoutine(r.name, r.graph, r.positions, counters, r.hiddenLinks) : stRoutine(r.name, r.lines),
  );
  const tagLines = counters.tagLines;

  for (const t of tags) tagLines.push(userTag(t));
  const seen = new Set<string>();
  for (const t of tagLines) {
    const k = t.name.toLowerCase();
    if (seen.has(k)) throw new Error(`L5X: duplicate tag name ${t.name} (names are case-insensitive)`);
    seen.add(k);
  }
  tagLines.sort((a, b) => {
    const x = a.name.toLowerCase();
    const y = b.name.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="${esc(revision)}" TargetName="${programName}" TargetType="Program" ContainsContext="true" ` +
      `ExportDate="${exportDate(options.exportDate ?? new Date())}" ExportOptions="${EXPORT_OPTIONS}">`,
    `<Controller Use="Context" Name="${esc(controller)}">`,
    '<DataTypes Use="Context">',
    "</DataTypes>",
    '<Modules Use="Context">',
    "</Modules>",
    '<Tags Use="Context">',
    "</Tags>",
    '<Programs Use="Context">',
    `<Program Use="Target" Name="${programName}" TestEdits="false" MainRoutineName="${main}" Disabled="false" UseAsFolder="false">`,
    "<Tags>",
    ...tagLines.flatMap((t) => t.lines),
    "</Tags>",
    "<Routines>",
    ...routineLines,
    "</Routines>",
    "</Program>",
    "</Programs>",
    "</Controller>",
    "</RSLogix5000Content>",
  ];
  return "\uFEFF" + lines.join("\r\n");
}

/** Self-check of an L5X text (SFC structure, operands, BOM and CRLF). [] = OK. */
export function checkL5X(xml: string): string[] {
  const problems: string[] = [];
  if (!xml.startsWith("﻿")) problems.push("file does not start with a UTF-8 BOM");
  if (!xml.includes("\r\n")) problems.push("file has no CRLF line endings");
  else if (/(^|[^\r])\n/.test(xml)) problems.push("file has line endings that are not CRLF");

  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (e) {
    if (e instanceof XmlError) return [...problems, `XML error: ${e.message}`];
    throw e;
  }

  const tagNames = new Set<string>();
  for (const t of descendants(root, "Tag")) {
    const name = t.attrs["Name"] ?? "";
    const k = name.toLowerCase();
    if (tagNames.has(k)) problems.push(`duplicate tag ${name}`);
    tagNames.add(k);
  }

  const routineNames = new Set<string>();
  for (const r of descendants(root, "Routine")) routineNames.add((r.attrs["Name"] ?? "").toLowerCase());
  for (const p of descendants(root, "Program")) {
    const main = p.attrs["MainRoutineName"];
    if (main !== undefined && !routineNames.has(main.toLowerCase())) problems.push(`MainRoutineName ${main} has no routine`);
  }

  // every JSR in ST must name a routine of the file
  for (const line of descendants(root, "Line")) {
    const text = textOf(line);
    for (const m of text.matchAll(/\bJSR\s*\(\s*([A-Za-z_]\w*)/gi)) {
      if (!routineNames.has(m[1]!.toLowerCase())) problems.push(`JSR to ${m[1]} has no routine`);
    }
  }

  for (const sfc of descendants(root, "SFCContent")) {
    const kinds = new Map<string, string>();
    for (const el of descendants(sfc)) {
      const id = el.attrs["ID"];
      if (id === undefined) continue;
      if (kinds.has(id)) problems.push(`SFC duplicate ID ${id}`);
      kinds.set(id, el.name);
    }
    const initial = descendants(sfc, "Step").filter((s) => s.attrs["InitialStep"] === "true");
    if (initial.length !== 1) problems.push(`SFC needs exactly one initial step, found ${initial.length}`);

    const linked = new Set<string>();
    for (const link of descendants(sfc, "DirectedLink")) {
      const a = link.attrs["FromID"] ?? "";
      const b = link.attrs["ToID"] ?? "";
      const ka = kinds.get(a);
      const kb = kinds.get(b);
      if (ka === undefined || kb === undefined) {
        problems.push(`SFC link ${a}->${b} points to an unknown ID`);
        continue;
      }
      linked.add(a);
      linked.add(b);
      if (ka === kb && (ka === "Step" || ka === "Transition")) problems.push(`SFC link ${a}->${b} joins two ${ka}s`);
    }
    for (const [id, kind] of kinds) {
      if ((kind === "Step" || kind === "Transition" || kind === "Branch" || kind === "Leg") && !linked.has(id)) {
        problems.push(`SFC ${kind} ${id} is not linked`);
      }
    }
    for (const el of descendants(sfc)) {
      if (el.name !== "Step" && el.name !== "Action" && el.name !== "Transition") continue;
      const op = el.attrs["Operand"];
      if (op === undefined) problems.push(`SFC ${el.name} ${el.attrs["ID"] ?? "?"} has no Operand`);
      else if (!tagNames.has(op.toLowerCase())) problems.push(`SFC ${el.name} operand ${op} has no matching tag`);
    }
  }
  return problems;
}
