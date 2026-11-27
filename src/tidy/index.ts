/**
 * Tidy (Phase 4a, SPEC §8.6): re-lays out the SFC routines of an L5X exported from Studio 5000
 * with the qSFC layout engine, and writes back only coordinates and the Show flags of wires.
 *
 * For every `<Routine Type="SFC">`:
 *   1. read the chart (src/tidy/read.ts) and check its shape;
 *   2. recover a qSFC structure (src/tidy/recover.ts) and run parse → validate → lower → layout;
 *   3. safety net: the lowered links, mapped back to the original IDs, must equal the original
 *      DirectedLinks exactly (same pairs, same branches and legs), else the routine is untouched;
 *   4. positions as the qSFC export computes them (studioPositions in src/compile.ts);
 *   5. patch the original text: X, Y, DescX, DescY of Step / Transition / Stop, Y of Branch,
 *      X / Y of attached TextBoxes, Show of DirectedLink. Every other byte stays.
 *
 * Pure, no I/O, never throws.
 */
import { studioPositions } from "../compile.js";
import { parseXml } from "../l5x/xml.js";
import type { ActionNode } from "../model/ast.js";
import type { GAction, Graph } from "../model/graph.js";
import { parse } from "../parse/index.js";
import { validate } from "../validate/index.js";
import { lower } from "../lower/index.js";
import { layout as computeLayout, type Layout } from "../layout/index.js";
import { readSfc, type SfcChart, type SfcLink } from "./read.js";
import { checkShape, describeId, indexLinks, recover, stepName, transName } from "./recover.js";
import { attr, attrRef, scanDescendants, scanXml, type ScanElement } from "./scan.js";

export interface TidyReport {
  /** Routine name (`Program/Routine` when two SFC routines of the file have the same name). */
  name: string;
  /** "unchanged": already tidy. "skipped": left byte for byte as it was, see `reason`. */
  status: "tidied" | "unchanged" | "skipped";
  reason?: string;
  /** Elements whose coordinates changed (steps, transitions, Stops, branches, text boxes). */
  moved: number;
  /** Wires written Show="false" (hidden, with connector labels). */
  hidden: number;
}

export interface TidyResult {
  /** The tidied text; equal to the input when nothing was tidied. */
  text: string;
  routines: TidyReport[];
  /** Set when the file itself can't be read (not XML); `routines` is then empty. */
  error?: string;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

export interface TidyOptions {
  /**
   * Write only these routines (names as in TidyReport.name, case-insensitive); the others keep
   * their text byte for byte. The reports are the same as without the option (what Tidy would do).
   */
  only?: readonly string[];
}

export function tidyL5X(xml: string, options: TidyOptions = {}): TidyResult {
  const only = options.only && new Set(options.only.map((n) => n.toLowerCase()));
  try {
    parseXml(xml);
  } catch (e) {
    return { text: xml, routines: [], error: `the file is not valid XML: ${(e as Error).message}` };
  }
  let root: ScanElement;
  try {
    root = scanXml(xml);
  } catch (e) {
    return { text: xml, routines: [], error: `the file can't be read: ${(e as Error).message}` };
  }

  const programOf = new Map<ScanElement, ScanElement>();
  for (const p of scanDescendants(root, "Program")) for (const r of scanDescendants(p, "Routine")) programOf.set(r, p);
  const sfcRoutines = scanDescendants(root, "Routine").filter((r) => attr(r, "Type") === "SFC");
  const names = sfcRoutines.map((r) => attr(r, "Name") ?? "?");
  const reports: TidyReport[] = [];
  const edits: Edit[] = [];
  sfcRoutines.forEach((r, i) => {
    const program = programOf.get(r);
    let name = names[i]!;
    if (names.filter((n) => n.toLowerCase() === name.toLowerCase()).length > 1 && program) name = `${attr(program, "Name") ?? "?"}/${name}`;
    const content = r.children.find((c) => c.name === "SFCContent");
    if (!content) {
      reports.push({ name, status: "skipped", reason: "the routine has no SFC content", moved: 0, hidden: 0 });
      return;
    }
    let result: RoutineResult;
    try {
      result = tidyRoutine(xml, content, tagHints(program ?? root));
    } catch (e) {
      result = { reason: `internal error: ${(e as Error).message}` };
    }
    if (result.reason !== undefined) {
      reports.push({ name, status: "skipped", reason: result.reason, moved: 0, hidden: 0 });
      return;
    }
    if (!only || only.has(name.toLowerCase())) edits.push(...result.edits!);
    reports.push({ name, status: result.edits!.length ? "tidied" : "unchanged", moved: result.moved!, hidden: result.hidden! });
  });
  return { text: applyEdits(xml, edits), routines: reports };
}

function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const e of sorted) {
    out += text.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + text.slice(at);
}

// ---- hints for the diagram text widths (which jump wires get hidden) ----------------------

interface TagHints {
  preset: Map<string, number>;
  description: Map<string, string>;
}

function tagHints(scope: ScanElement): TagHints {
  const hints: TagHints = { preset: new Map(), description: new Map() };
  for (const t of scanDescendants(scope, "Tag")) {
    const name = (attr(t, "Name") ?? "").toLowerCase();
    const desc = t.children.find((c) => c.name === "Description");
    if (desc) hints.description.set(name, desc.text.replace(/^\s+/, "").split(/\r?\n/)[0]!.trim());
    if (attr(t, "DataType") === "SFC_STEP") {
      const pre = scanDescendants(t, "DataValueMember").find((m) => attr(m, "Name") === "PRE");
      const v = Number(pre ? attr(pre, "Value") : NaN);
      if (Number.isFinite(v)) hints.preset.set(name, v);
    }
  }
  return hints;
}

const NAME_COMMENT = /^\/\/\s*([A-Za-z_]\w*)(\s+-\s.*)?\s*$/;

/** The lowered graph with the routine's real texts, so the diagram measures what Studio shows. */
function withTexts(graph: Graph, chart: SfcChart, toOrig: Map<string, string>, hints: TagHints): Graph {
  return {
    ...graph,
    steps: graph.steps.map((s) => {
      const n = chart.nodes.get(toOrig.get(s.id)!)!;
      const m = NAME_COMMENT.exec(n.text[0] ?? "");
      // Every action's lines in one N box, as before Phase 4b (only the measuring uses them).
      const lines = m ? n.text.slice(1) : n.text;
      const actions: GAction[] = lines.length ? [{ qualifier: "N", lines, index: s.index, node: {} as ActionNode }] : [];
      return { ...s, name: m ? m[1]! : n.operand, actions, presetMs: hints.preset.get(n.operand.toLowerCase()) ?? 0 };
    }),
    transitions: graph.transitions.map((t) => {
      const n = chart.nodes.get(toOrig.get(t.id)!)!;
      const name = hints.description.get(n.operand.toLowerCase()) || n.operand;
      return { ...t, name, auto: /^T\d+$/.test(name), condition: n.text[0] ?? "" };
    }),
  };
}

// ---- one routine -----------------------------------------------------------------------------

interface RoutineResult {
  reason?: string;
  edits?: Edit[];
  moved?: number;
  hidden?: number;
}

interface Built {
  graph: Graph;
  layout: Layout;
  /** Lowered step / transition id -> original ID. */
  toOrig: Map<string, string>;
  /** Lowered branch id -> original branch ID. */
  branchOrig: Map<string, string>;
  /** Lowered link `from-to` -> original link. */
  linkOrig: Map<string, SfcLink>;
}

function tidyRoutine(text: string, content: ScanElement, hints: TagHints): RoutineResult {
  const chart = readSfc(content);
  if (typeof chart === "string") return { reason: chart };
  const shape = checkShape(chart);
  if (shape) return { reason: shape };

  let built: Built | undefined;
  let reason: string | undefined;
  for (const mode of ["strict", "free"] as const) {
    const rec = recover(chart, mode);
    if (!rec.candidates.length && mode === "free") reason ??= rec.reason;
    for (const c of rec.candidates) {
      const b = build(c.source, chart);
      if (typeof b === "string") reason ??= b;
      else {
        built = b;
        break;
      }
    }
    if (built) break;
  }
  if (!built) return { reason: reason ?? "the chart's structure can't be rebuilt" };
  return routineEdits(text, chart, built, hints);
}

function routineEdits(text: string, chart: SfcChart, built: Built, hints: TagHints): RoutineResult {
  const { graph, layout, toOrig, branchOrig, linkOrig } = built;
  const actionLines = new Map(graph.steps.map((s) => [s.id, chart.nodes.get(toOrig.get(s.id)!)!.actionLines] as const));
  const { positions, hiddenLinks } = studioPositions(withTexts(graph, chart, toOrig, hints), layout, actionLines);

  const edits: Edit[] = [];
  let moved = 0;
  const delta = new Map<string, { dx: number; dy: number }>();
  const set = (el: ScanElement, name: string, value: number): boolean => {
    const a = attrRef(el, name);
    if (!a || a.value === String(value)) return false;
    edits.push({ start: a.start, end: a.end, text: String(value) });
    return true;
  };
  const num = (el: ScanElement, name: string): number | undefined => {
    const v = attr(el, name);
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  for (const [gid, p] of positions.nodes) {
    const el = chart.nodes.get(toOrig.get(gid)!)!.el;
    const ox = num(el, "X");
    const oy = num(el, "Y");
    const dx = ox === undefined ? 0 : p.x - ox;
    const dy = oy === undefined ? 0 : p.y - oy;
    delta.set(toOrig.get(gid)!, { dx, dy });
    let changed = set(el, "X", p.x) || false;
    changed = set(el, "Y", p.y) || changed;
    const descX = num(el, "DescX");
    const descY = num(el, "DescY");
    if (descX !== undefined) changed = set(el, "DescX", descX + dx) || changed;
    if (descY !== undefined) changed = set(el, "DescY", descY + dy) || changed;
    if (changed) moved++;
  }
  for (const [gid, p] of positions.branches) {
    const id = branchOrig.get(gid)!;
    const el = chart.branches.get(id)!.el;
    const oy = num(el, "Y");
    delta.set(id, { dx: 0, dy: oy === undefined ? 0 : p.y - oy });
    if (set(el, "Y", p.y)) moved++;
  }
  for (const box of chart.textBoxes) {
    const target = chart.attached.get(attr(box, "ID")!);
    const d = target === undefined ? undefined : delta.get(target);
    if (!d || (d.dx === 0 && d.dy === 0)) continue;
    const ox = num(box, "X");
    const oy = num(box, "Y");
    let changed = ox !== undefined && set(box, "X", ox + d.dx);
    changed = (oy !== undefined && set(box, "Y", oy + d.dy)) || changed;
    if (changed) moved++;
  }
  const hiddenOrig = new Set([...hiddenLinks].map((k) => linkOrig.get(k)!));
  for (const l of chart.links) {
    const want = hiddenOrig.has(l) ? "false" : "true";
    const show = attrRef(l.el, "Show");
    if (show) {
      if (show.value !== want) edits.push({ start: show.start, end: show.end, text: want });
    } else if (want === "false") {
      const close = text.lastIndexOf(text[l.el.tagEnd - 2] === "/" ? "/>" : ">", l.el.tagEnd);
      edits.push({ start: close, end: close, text: ' Show="false"' });
    }
  }
  return { edits, moved, hidden: hiddenOrig.size };
}

/** Compiles a recovered source and maps it onto the original chart; a string says why it can't. */
function build(source: string, chart: SfcChart): Built | string {
  const parsed = parse(source);
  const errors = [...parsed.diagnostics, ...validate(parsed.chart)].filter((d) => d.severity === "error");
  const nameToId = new Map<string, string>();
  for (const n of chart.nodes.values()) nameToId.set((n.kind === "transition" ? transName(n.id) : stepName(n.id)).toLowerCase(), n.id);
  if (errors.length) {
    const msg = errors[0]!.message.replace(/`([A-Za-z_]\w*)`/g, (m, name: string) => {
      const id = nameToId.get(name.toLowerCase());
      return id === undefined ? m : chart.nodes.get(id)!.operand;
    });
    return `qSFC can't draw this chart: ${msg}`;
  }
  const graph = lower(parsed.chart);
  const lay = computeLayout(graph, parsed.chart);

  const mismatch = "the rebuilt chart would not have exactly the same wires";
  const toOrig = new Map<string, string>();
  for (const n of [...graph.steps, ...graph.transitions]) {
    const id = nameToId.get(n.name.toLowerCase());
    if (id === undefined) return mismatch;
    toOrig.set(n.id, id);
  }
  if (toOrig.size !== chart.nodes.size || graph.branches.length !== chart.branches.size) return mismatch;

  const { out: oOut, inn: oIn } = indexLinks(chart);
  const lOut = new Map<string, string[]>();
  const lIn = new Map<string, string[]>();
  for (const l of graph.links) {
    (lOut.get(l.from) ?? lOut.set(l.from, []).get(l.from)!).push(l.to);
    (lIn.get(l.to) ?? lIn.set(l.to, []).get(l.to)!).push(l.from);
  }
  const branchOrig = new Map<string, string>();
  const legOrig = new Map<string, string>();
  const usedBranch = new Set<string>();
  for (const b of graph.branches) {
    const diverge = b.flow === "diverge";
    const end = diverge ? lIn.get(b.id) : lOut.get(b.id);
    if (end?.length !== 1 || !toOrig.has(end[0]!)) return mismatch;
    const node = toOrig.get(end[0]!)!;
    const cands = (diverge ? oOut.get(node) : oIn.get(node)) ?? [];
    const ob = cands.map((id) => chart.branches.get(id)).find((x) => x && x.type === b.type && x.flow === b.flow);
    if (!ob || usedBranch.has(ob.id) || ob.legs.length !== b.legs.length) return mismatch;
    usedBranch.add(ob.id);
    branchOrig.set(b.id, ob.id);
  }
  const usedLeg = new Set<string>();
  const legLinks: Array<[string, string]> = [];
  for (const b of graph.branches) {
    const diverge = b.flow === "diverge";
    const ob = chart.branches.get(branchOrig.get(b.id)!)!;
    for (const leg of b.legs) {
      const far = diverge ? lOut.get(leg.id) : lIn.get(leg.id);
      if (far?.length !== 1) return mismatch;
      // a parallel leg starting with an automatic convergence: leg to leg, matched below
      if (!toOrig.has(far[0]!)) {
        if (diverge) legLinks.push([leg.id, far[0]!]);
        continue;
      }
      const farOrig = toOrig.get(far[0]!)!;
      const ol = ob.legs.find((L) => (diverge ? oOut.get(L) : oIn.get(L))?.[0] === farOrig);
      if (ol === undefined || usedLeg.has(ol)) return mismatch;
      usedLeg.add(ol);
      legOrig.set(leg.id, ol);
    }
  }
  const legsOf = (gid: string): string[] => {
    const id = branchOrig.get(gid.slice(0, gid.lastIndexOf(".")));
    return id === undefined ? [] : chart.branches.get(id)!.legs.filter((L) => !usedLeg.has(L));
  };
  for (const [from, to] of legLinks) {
    const pairs = legsOf(from).flatMap((a) => legsOf(to).filter((b) => oOut.get(a)?.[0] === b).map((b) => [a, b] as const));
    if (pairs.length !== 1) return mismatch;
    const [a, b] = pairs[0]!;
    usedLeg.add(a);
    usedLeg.add(b);
    legOrig.set(from, a);
    legOrig.set(to, b);
  }
  const tr = (id: string): string | undefined => toOrig.get(id) ?? branchOrig.get(id) ?? legOrig.get(id);
  const origByKey = new Map(chart.links.map((l) => [`${l.from}>${l.to}`, l] as const));
  if (graph.links.length !== chart.links.length) return mismatch;
  const linkOrig = new Map<string, SfcLink>();
  for (const l of graph.links) {
    const a = tr(l.from);
    const b = tr(l.to);
    const o = a === undefined || b === undefined ? undefined : origByKey.get(`${a}>${b}`);
    if (!o) return `${mismatch} (a wire to ${b === undefined ? "?" : describeId(chart, b)} would change)`;
    linkOrig.set(`${l.from}-${l.to}`, o);
  }
  if (new Set(linkOrig.values()).size !== chart.links.length) return mismatch;
  return { graph, layout: lay, toOrig, branchOrig, linkOrig };
}

/** Internals for tests and experiments (not part of the contract). */
export const tidyInternals = { build, routineEdits, tagHints };
