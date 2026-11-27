/**
 * SVG view (Phase 2), drawn from the same grid Layout as the ASCII view and the L5X
 * coordinates. Pure and deterministic: returns a self-contained SVG string.
 *
 * Two looks share all the geometry below; only the drawing of the elements differs:
 *   - "studio":   Studio 5000 SFC editor style (rectangle steps with operand caption,
 *                 action box with an N / Action_nnn header, transition bar with a name box);
 *   - "textbook": IEC 60848 GRAFCET / IEC 61131-3 course style (square steps, action
 *                 rectangles with a qualifier cell, thick transition bar, wide branch lines).
 *
 * Geometry:
 *   - x: every element column gets a line x. Columns are packed row by row (like the
 *     ASCII view): a column sits as far left as the content of the columns on its left
 *     allows in the rows where both have something (text, box, line), and leaves room
 *     for the jump lanes beside it. The layout's channel columns are not used (the L5X
 *     keeps them); groups never share x.
 *   - y: every row is a band as tall as its content (step box, action box, transition
 *     text). Between two rows there is a gap ("half row" of the layout) that holds the
 *     horizontal parts of routed wires, one lane per wire when they overlap, plus a
 *     label slot under the lanes for cross-references.
 *   - Wires: graph links between neighbours are straight vertical lines; jogs follow the
 *     layout's route. Jump wires are routed here, at render time (src/render/route.ts):
 *     a lane on the side of the jump's leg (main column and leftmost legs on the left,
 *     other legs on the right), just past the widest element of the rows it passes,
 *     shortest loops innermost. A jump into a step with another input joins the line
 *     above that step with an arrowhead; automatic convergence bars are not drawn (the
 *     L5X keeps them). A jump into a step with no other input enters it from the top.
 *     A wire that would still cross something becomes a GRAFCET cross-reference: a
 *     short arrow under the transition labelled with the target, and "from T…" above
 *     the target.
 *
 * Every step, transition, branch bar and wire carries `data-id` (graph id; wires use
 * `from-to`) and a `qsfc-*` class. Colors are CSS custom properties `--qsfc-*` with a
 * dark variant (prefers-color-scheme, or `.qsfc-dark` on an ancestor; `.qsfc-light`
 * on an ancestor forces the light colors).
 */
import type { GBranch, Graph, GraphId, GStep, GTransition } from "../model/graph.js";
import type { GridPoint, Layout } from "../layout/index.js";
import { formatDuration, qualifierLabel } from "./ascii.js";
import {
  gapSpan,
  orderLanes,
  planRoutes,
  segmentHitsBox,
  segmentsCross,
  spansOverlap,
  type Box,
  type HLine,
  type Jump,
  type RoutePlan,
  type Seg,
} from "./route.js";

export type SvgLook = "studio" | "textbook";

export interface SvgOptions {
  look?: SvgLook;
  /** Draw action boxes. Default true. */
  showActions?: boolean;
  /** Textbook only: "numbers" shows GRAFCET step numbers 1, 2, 3 (file order) with the name beside. */
  numbering?: "names" | "numbers";
}

// ---------------------------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------------------------

interface Metrics {
  stepMinW: number;
  stepMaxW: number;
  stepH: number;
  stepPadX: number;
  initialInset: number;
  nameSize: number;
  nameWeight: number;
  captionSize: number;
  codeSize: number;
  lineH: number;
  labelSize: number;
  actionGap: number;
  /** Studio: header strip height. Textbook: 0 (qualifier cell instead). */
  actionHeader: number;
  actionCellW: number;
  actionPad: number;
  maxActionLines: number;
  maxCodeChars: number;
  maxCondChars: number;
  transBarW: number;
  transBarH: number;
  transTextGap: number;
  transHalfH: number;
  barOverhang: number;
  /** Half distance between the two lines of a simultaneous bar. */
  barDouble: number;
  gapBase: number;
  lanePad: number;
  laneSp: number;
  labelH: number;
  colGap: number;
  minSep: number;
  groupGap: number;
  channelGap: number;
  channelSp: number;
  wiredSp: number;
  margin: number;
  arrowL: number;
  arrowW: number;
}

const STUDIO: Metrics = {
  stepMinW: 110,
  stepMaxW: 168,
  stepH: 46,
  stepPadX: 10,
  initialInset: 3,
  nameSize: 12.5,
  nameWeight: 600,
  captionSize: 9.5,
  codeSize: 11,
  lineH: 15,
  labelSize: 10,
  actionGap: 18,
  actionHeader: 17,
  actionCellW: 18,
  actionPad: 6,
  maxActionLines: 4,
  maxCodeChars: 40,
  maxCondChars: 48,
  transBarW: 22,
  transBarH: 4,
  transTextGap: 9,
  transHalfH: 9,
  barOverhang: 0,
  barDouble: 2.5,
  gapBase: 20,
  lanePad: 9,
  laneSp: 8,
  labelH: 14,
  colGap: 26,
  minSep: 40,
  groupGap: 56,
  channelGap: 22,
  channelSp: 14,
  wiredSp: 22,
  margin: 16,
  arrowL: 8,
  arrowW: 4,
};

const TEXTBOOK: Metrics = {
  stepMinW: 44,
  stepMaxW: 100,
  stepH: 44,
  stepPadX: 7,
  initialInset: 4,
  nameSize: 13,
  nameWeight: 400,
  captionSize: 9.5,
  codeSize: 11,
  lineH: 15,
  labelSize: 10.5,
  actionGap: 18,
  actionHeader: 0,
  actionCellW: 20,
  actionPad: 7,
  maxActionLines: 4,
  maxCodeChars: 40,
  maxCondChars: 48,
  transBarW: 24,
  transBarH: 4,
  transTextGap: 9,
  transHalfH: 9,
  barOverhang: 14,
  barDouble: 3,
  gapBase: 18,
  lanePad: 9,
  laneSp: 8,
  labelH: 14,
  colGap: 26,
  minSep: 40,
  groupGap: 56,
  channelGap: 22,
  channelSp: 14,
  wiredSp: 24,
  margin: 16,
  arrowL: 8,
  arrowW: 4,
};

const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace";

// ---------------------------------------------------------------------------------------------
// Text helpers (no DOM: widths are estimates, on the generous side)
// ---------------------------------------------------------------------------------------------

const NARROW = new Set([..."iljtfr.,:;'!|()[] 1"]);
const WIDE = new Set([..."mwMW@%"]);

/** Estimated width of proportional text. */
export function sansWidth(text: string, size: number, weight = 400): number {
  let w = 0;
  for (const ch of text) {
    if (NARROW.has(ch)) w += 0.34;
    else if (WIDE.has(ch)) w += 0.9;
    else if (ch >= "A" && ch <= "Z") w += 0.68;
    else if (ch === "_") w += 0.56;
    else w += 0.57;
  }
  return w * size * (weight >= 600 ? 1.07 : 1);
}

/** Estimated width of monospace text. */
export function monoWidth(text: string, size: number): number {
  return [...text].length * size * 0.61;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface Fitted {
  text: string;
  truncated: boolean;
}

/** Cut to `max` characters with a trailing "…". */
function fitChars(text: string, max: number): Fitted {
  const chars = [...text];
  if (chars.length <= max) return { text, truncated: false };
  return { text: `${chars.slice(0, Math.max(1, max - 1)).join("").trimEnd()}…`, truncated: true };
}

/** Cut proportional text to a pixel width. */
function fitSans(text: string, maxW: number, size: number, weight: number): Fitted {
  if (sansWidth(text, size, weight) <= maxW) return { text, truncated: false };
  const chars = [...text];
  let n = chars.length - 1;
  while (n > 1 && sansWidth(`${chars.slice(0, n).join("")}…`, size, weight) > maxW) n--;
  return { text: `${chars.slice(0, n).join("").trimEnd()}…`, truncated: true };
}

/** One decimal, no "-0". */
const n = (v: number): string => {
  const r = Math.round(v * 10) / 10;
  return String(r === 0 ? 0 : r);
};

const operand = (prefix: string, i: number): string => `${prefix}_${String(i).padStart(3, "0")}`;

/** `<text>` with an optional `<title>` holding the full text. */
function textEl(cls: string, x: number, y: number, fitted: Fitted, full: string, anchor?: "middle" | "end"): string {
  const a = anchor ? ` text-anchor="${anchor}"` : "";
  const title = fitted.truncated ? `<title>${escapeXml(full)}</title>` : "";
  return `<text class="${cls}" x="${n(x)}" y="${n(y)}"${a}>${title}${escapeXml(fitted.text)}</text>`;
}

// ---------------------------------------------------------------------------------------------
// Per-element drawings with their extents around the anchor point (line x, row center y)
// ---------------------------------------------------------------------------------------------

interface Extent {
  left: number;
  right: number;
  above: number;
  below: number;
}

interface StepPlan {
  step: GStep;
  w: number;
  h: number;
  label: Fitted;
  side?: Fitted;
  /** The step's actions, stacked one under the other (SPEC §4.3). */
  action?: {
    rows: ActionRow[];
    /** Width of the qualifier cell (`N`, `L 10s`), the same for every row. */
    cellW: number;
    w: number;
    /** Total height of the stack. */
    h: number;
  };
  ext: Extent;
}

interface ActionRow {
  /** Qualifier cell text: `N`, `S`, `L 10s`. */
  label: string;
  lines: Fitted[];
  /** The action's lines in full (titles of cut lines). */
  raw: string[];
  more: boolean;
  full: string;
  operand: string;
  /** Top of the row, from the top of the stack. */
  y: number;
  h: number;
}

interface TransPlan {
  trans: GTransition;
  name?: Fitted;
  nameW: number;
  cond: Fitted;
  ext: Extent;
}

function planStep(s: GStep, M: Metrics, look: SvgLook, numbers: boolean, showActions: boolean): StepPlan {
  const labelText = numbers ? String(s.index + 1) : s.name;
  const inner = M.stepMaxW - 2 * M.stepPadX;
  const label = fitSans(labelText, inner, M.nameSize, M.nameWeight);
  let w = Math.max(M.stepMinW, sansWidth(label.text, M.nameSize, M.nameWeight) + 2 * M.stepPadX);
  if (look === "studio") {
    const cap = studioCaption(s);
    w = Math.max(w, sansWidth(cap, M.captionSize) + 2 * M.stepPadX);
  } else if (!numbers && s.presetMs > 0) {
    w = Math.max(w, sansWidth(formatDuration(s.presetMs), M.captionSize) + 2 * M.stepPadX);
  }
  w = Math.ceil(Math.min(w, M.stepMaxW));
  const h = M.stepH;
  const ext: Extent = { left: w / 2, right: w / 2, above: h / 2, below: h / 2 };
  const plan: StepPlan = { step: s, w, h, label, ext };
  if (numbers) {
    const side = fitSans(s.name, 110, M.labelSize, 400);
    plan.side = side;
    const sideW = Math.max(sansWidth(side.text, M.labelSize), s.presetMs > 0 ? sansWidth(formatDuration(s.presetMs), M.captionSize) : 0);
    ext.left += 6 + sideW;
  }
  if (showActions && s.actions.length > 0) {
    const qualifierW = (label: string): number => Math.ceil(sansWidth(label, 10.5, 700)) + 8;
    const cellW = Math.max(M.actionCellW, ...s.actions.map((x) => qualifierW(qualifierLabel(x))));
    let aw = 0;
    let top = 0;
    const rows: ActionRow[] = s.actions.map((x) => {
      const shown = x.lines.slice(0, M.maxActionLines).map((l) => fitChars(l.replace(/\s+$/, ""), M.maxCodeChars));
      const more = x.lines.length > M.maxActionLines;
      const count = shown.length + (more ? 1 : 0);
      const codeW = Math.max(...shown.map((l) => monoWidth(l.text, M.codeSize)), more ? monoWidth("…", M.codeSize) : 0);
      // Studio's action operand (the L5X writer's numbering, with its default name comments).
      const op = operand("Action", x.index);
      let rw: number;
      let rh: number;
      if (look === "studio") {
        const headW = cellW + 8 + sansWidth(op, M.captionSize + 0.5) + 8;
        rw = Math.max(headW, codeW + 2 * M.actionPad, 90);
        rh = M.actionHeader + M.actionPad + count * M.lineH - 2;
      } else {
        rw = cellW + codeW + 2 * M.actionPad;
        rh = Math.max(h, count * M.lineH + 2 * M.actionPad - 2);
      }
      aw = Math.max(aw, rw);
      const row: ActionRow = { label: qualifierLabel(x), lines: shown, raw: x.lines, more, full: x.lines.join("\n"), operand: op, y: top, h: rh };
      top += rh;
      return row;
    });
    aw = Math.ceil(aw);
    plan.action = { rows, cellW, w: aw, h: top };
    ext.right = w / 2 + M.actionGap + aw;
    ext.below = Math.max(ext.below, top - h / 2);
  }
  return plan;
}

function studioCaption(s: GStep): string {
  const op = operand("Step", s.operand);
  return s.presetMs > 0 ? `${op} · ${formatDuration(s.presetMs)}` : op;
}

function planTransition(t: GTransition, M: Metrics, look: SvgLook): TransPlan {
  const cond = fitChars(t.condition.replace(/\s+/g, " "), M.maxCondChars);
  const condW = monoWidth(cond.text, M.codeSize);
  const half = M.transBarW / 2;
  const ext: Extent = { left: half, right: half + M.transTextGap + condW, above: M.transHalfH, below: M.transHalfH };
  let name: Fitted | undefined;
  let nameW = 0;
  if (look === "studio") {
    name = fitChars(t.name, 24);
    nameW = Math.ceil(sansWidth(name.text, M.labelSize, 600) + 10);
    ext.left = half + 10 + nameW;
  } else if (!t.auto) {
    name = fitChars(`(${t.name})`, 26);
    nameW = sansWidth(name.text, M.labelSize);
    ext.left = half + 8 + nameW;
  }
  const plan: TransPlan = { trans: t, nameW, cond, ext };
  if (name) plan.name = name;
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------------------------

interface GridEnd {
  row: number;
  col: number;
  kind: "step" | "transition" | "bar";
  bar?: GraphId;
}

interface Env {
  graph: Graph;
  layout: Layout;
  look: SvgLook;
  M: Metrics;
  numbers: boolean;
  stepById: Map<GraphId, GStep>;
  transById: Map<GraphId, GTransition>;
  branchById: Map<GraphId, GBranch>;
  stepPlans: Map<GraphId, StepPlan>;
  transPlans: Map<GraphId, TransPlan>;
  routes: RoutePlan;
}

interface Pass {
  svg: string;
  /** Crossings per drawn jump wire (id -> count). */
  bad: Map<string, number>;
  total: number;
}

export function renderSvg(graph: Graph, layout: Layout, options: SvgOptions = {}): string {
  // Which wires become cross-references is decided once, in the default view (textbook look,
  // actions shown), so every view and the L5X (Show="false") hide the same ones.
  const canonical = (options.look ?? "studio") === "textbook" && (options.showActions ?? true);
  if (canonical) return decide(graph, layout, options).svg;
  return decide(graph, layout, options, hiddenJumpLinks(graph, layout)).svg;
}

/**
 * Jump wires drawn as cross-references (hidden wires) with these options, as graph link ids
 * `from-to`. The L5X export hides the same links (Show="false") with the app's default view
 * (textbook look, actions shown), so Studio and the app agree (tp05 import, 2026-11-26).
 */
export function hiddenJumpLinks(graph: Graph, layout: Layout, options: SvgOptions = { look: "textbook" }): Set<string> {
  return decide(graph, layout, options).xref;
}

function decide(graph: Graph, layout: Layout, options: SvgOptions, fixed?: Set<string>): { svg: string; xref: Set<string> } {
  const look: SvgLook = options.look ?? "studio";
  const M = look === "studio" ? STUDIO : TEXTBOOK;
  const showActions = options.showActions ?? true;
  const numbers = look === "textbook" && options.numbering === "numbers";
  const stepPlans = new Map<GraphId, StepPlan>();
  const transPlans = new Map<GraphId, TransPlan>();
  for (const s of graph.steps) stepPlans.set(s.id, planStep(s, M, look, numbers, showActions));
  for (const t of graph.transitions) transPlans.set(t.id, planTransition(t, M, look));
  const env: Env = {
    graph,
    layout,
    look,
    M,
    numbers,
    stepById: new Map(graph.steps.map((s) => [s.id, s])),
    transById: new Map(graph.transitions.map((t) => [t.id, t])),
    branchById: new Map(graph.branches.map((b) => [b.id, b])),
    stepPlans,
    transPlans,
    routes: planRoutes(graph, layout),
  };

  // Draw every jump wire; while some still cross something, turn one of them into a
  // cross-reference: the one whose removal leaves the fewest crossings.
  if (fixed) return { svg: drawPass(env, fixed).svg, xref: fixed };
  const xref = new Set<string>();
  let pass = drawPass(env, xref);
  const jumpById = new Map(env.routes.jumps.map((j) => [j.id, j]));
  while (pass.total > 0) {
    const cands = [...pass.bad.keys()].filter((id) => !xref.has(id));
    if (cands.length === 0) break;
    let best: { id: string; pass: Pass | undefined; rank: number[] } | undefined;
    for (const id of cands) {
      const j = jumpById.get(id)!;
      const trial = cands.length <= 10 ? drawPass(env, new Set([...xref, id])) : undefined;
      // Fewest crossings left, then a jump to another chain, then the most crossings, then the last one.
      const rank = [trial ? trial.total : 0, j.group !== j.targetGroup ? 0 : 1, -(pass.bad.get(id) ?? 0), -j.order];
      if (!best || lessThan(rank, best.rank)) best = { id, pass: trial, rank };
    }
    xref.add(best!.id);
    pass = best!.pass ?? drawPass(env, xref);
  }
  return { svg: pass.svg, xref };
}

function lessThan(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

function drawPass(env: Env, xref: Set<string>): Pass {
  const { graph, layout, look, M, numbers, stepById, transById, branchById, stepPlans, transPlans, routes } = env;
  const jumps = routes.jumps.filter((j) => !xref.has(j.id));
  const xrefs = routes.jumps.filter((j) => xref.has(j.id));
  const labelDx = 5;

  // ---- cross-reference labels: target at the source, "from T…" at the target ----
  const labelOf = (s: GStep): string => (numbers ? String(s.index + 1) : s.name);
  const xrefLabel = new Map<string, Fitted>();
  const fromTrans = new Map<GraphId, GTransition[]>();
  /** Targets entered by a hidden wire only: their dashed stub is centred on the step. */
  const centred = new Set<GraphId>();
  for (const j of xrefs) {
    xrefLabel.set(j.id, fitChars(labelOf(stepById.get(j.target)!), 16));
    const list = fromTrans.get(j.target) ?? [];
    list.push(transById.get(j.from)!);
    fromTrans.set(j.target, list);
    if (j.top) centred.add(j.target);
  }
  // a drawn jump entering the same step from the top takes the centre
  for (const j of jumps) if (j.top) centred.delete(j.target);
  const fromLabel = new Map<GraphId, { fitted: Fitted; full: string }>();
  for (const [t, ts] of fromTrans) {
    const full = ts.length === 1 ? `${ts[0]!.name} ${ts[0]!.condition}` : ts.map((x) => x.name).join(", ");
    fromLabel.set(t, { fitted: fitChars(full, 28), full: `from ${full}` });
  }

  // ---- graph links drawn as straight lines ----
  const resolve = (id: GraphId): GridEnd => {
    const node = layout.nodes.get(id);
    if (node) return { row: node.row, col: node.col, kind: node.kind };
    const bar = layout.bars.get(id);
    if (bar) return { row: bar.row, col: bar.col, kind: "bar", bar: bar.id };
    const leg = layout.legs.get(id);
    if (!leg) throw new Error(`SVG: no place for ${id}`);
    return { row: layout.bars.get(leg.branch)!.row, col: leg.col, kind: "bar", bar: leg.branch };
  };
  const vlinks = routes.links.map((l) => ({ id: l.id, from: resolve(l.from), to: resolve(l.to) }));
  const jogs = layout.wires.filter((w) => w.kind === "jog");

  // ---- cells: content extent left / right of each column line, per row ----
  const ncols = layout.columns.length;
  const rows = layout.rows;
  const isElem = (c: number): boolean => layout.columns[c]?.kind === "element";
  const cells = new Map<string, [number, number]>();
  const mark = (r: number, c: number, left: number, right: number): void => {
    if (!isElem(c)) return;
    const k = `${r},${c}`;
    const old = cells.get(k) ?? [0, 0];
    cells.set(k, [Math.max(old[0], left), Math.max(old[1], right)]);
  };
  for (const nd of layout.nodes.values()) {
    const ext = nd.kind === "step" ? stepPlans.get(nd.id)!.ext : transPlans.get(nd.id)!.ext;
    mark(nd.row, nd.col, ext.left, ext.right);
  }
  for (const b of layout.bars.values()) {
    if (routes.hiddenBars.has(b.id)) {
      if (layout.bars.get(b.id)!.placement !== "loop") mark(b.row, b.col, 0, 0);
      continue;
    }
    const single = b.col === b.colEnd ? 14 : 0;
    for (let c = b.col; c <= b.colEnd; c++) {
      mark(b.row, c, c === b.col ? Math.max(M.barOverhang, single) : 0, c === b.colEnd ? Math.max(M.barOverhang, single) : 0);
    }
  }
  for (const v of vlinks) {
    for (let r = v.from.row + 1; r < v.to.row; r++) mark(r, v.from.col, 0, 0);
    if (v.from.col !== v.to.col) for (let r = v.from.row + 1; r < v.to.row; r++) mark(r, v.to.col, 0, 0);
  }
  for (const w of jogs) {
    const [p0, p1, p2, p3] = w.points as [GridPoint, GridPoint, GridPoint, GridPoint];
    for (let r = p0.row + 1; r < p1.row; r++) mark(r, p0.col, 0, 0);
    for (let c = Math.min(p1.col, p2.col); c <= Math.max(p1.col, p2.col); c++) mark(p1.row, c, 0, 0);
    for (let r = p2.row + 1; r < p3.row; r++) mark(r, p2.col, 0, 0);
  }
  for (const j of xrefs) {
    mark(j.srcRow, j.srcCol, 0, labelDx + sansWidth(xrefLabel.get(j.id)!.text, M.labelSize) + 4);
  }
  for (const [t, label] of fromLabel) {
    const nd = layout.nodes.get(t)!;
    mark(nd.row, nd.col, 0, labelDx + sansWidth(label.fitted.text, M.labelSize) + 4);
  }
  const cellAt = (r: number, c: number): [number, number] | undefined => cells.get(`${r},${c}`);
  const rowsOf = (j: Jump): number[] => {
    const [g0, g1] = gapSpan(j);
    const out: number[] = [];
    for (let r = g0; r < g1; r++) if (r >= 0 && r < rows) out.push(r);
    return out;
  };

  // ---- left lanes: distance from their anchor column line, shortest loops innermost ----
  const bySpan = (a: Jump, b: Jump): number =>
    gapSpan(a)[1] - gapSpan(a)[0] - (gapSpan(b)[1] - gapSpan(b)[0]) || a.order - b.order;
  const leftD = new Map<string, number>();
  const needLeft = new Map<string, number>();
  const leftAt = new Map<number, Jump[]>();
  const rightAt = new Map<number, Jump[]>();
  for (const j of jumps) {
    const m = j.side === "left" ? leftAt : rightAt;
    m.set(j.anchor, [...(m.get(j.anchor) ?? []), j]);
  }
  for (const [c, list] of leftAt) {
    list.sort(bySpan);
    const done: Jump[] = [];
    for (const j of list) {
      let d = 0;
      for (const r of rowsOf(j)) d = Math.max(d, cellAt(r, c)?.[0] ?? 0);
      d += M.channelGap;
      for (const o of done) if (spansOverlap(o, j)) d = Math.max(d, leftD.get(o.id)! + M.channelSp);
      leftD.set(j.id, d);
      done.push(j);
      for (const r of rowsOf(j)) {
        const k = `${r},${c}`;
        needLeft.set(k, Math.max(needLeft.get(k) ?? 0, d));
      }
    }
  }

  // ---- column x, with the lanes ----
  const colX = new Array<number>(ncols).fill(0);
  const laneX = new Map<string, number>();
  let leftLimit = 0;
  layout.groups.forEach((_, g) => {
    const elems: number[] = [];
    layout.columns.forEach((col, c) => {
      if (col.group === g && col.kind === "element") elems.push(c);
    });
    const placed: number[] = [];
    const lanes: Array<{ x: number; j: Jump; rows: Set<number> }> = [];
    for (const c of elems) {
      let x = placed.length > 0 ? colX[placed[placed.length - 1]!]! + M.minSep : leftLimit;
      for (let r = 0; r < rows; r++) {
        const cell = cellAt(r, c);
        const nl = needLeft.get(`${r},${c}`);
        if (cell) {
          x = Math.max(x, leftLimit + cell[0]);
          for (const p of placed) {
            const pc = cellAt(r, p);
            if (pc) x = Math.max(x, colX[p]! + pc[1] + M.colGap + cell[0]);
          }
          for (const l of lanes) if (l.rows.has(r)) x = Math.max(x, l.x + M.channelGap + cell[0]);
        }
        if (nl !== undefined) {
          x = Math.max(x, leftLimit + nl);
          for (const p of placed) {
            const pc = cellAt(r, p);
            if (pc) x = Math.max(x, colX[p]! + pc[1] + M.channelGap + nl);
          }
          for (const l of lanes) if (l.rows.has(r)) x = Math.max(x, l.x + M.channelSp + nl);
        }
      }
      colX[c] = Math.round(x);
      placed.push(c);
      // Right lanes of the branches ending at this column: past everything placed so far.
      for (const j of (rightAt.get(c) ?? []).sort(bySpan)) {
        const rs = rowsOf(j);
        let base = colX[j.srcCol]!;
        for (const r of rs) {
          for (const p of placed) {
            const pc = cellAt(r, p);
            if (pc) base = Math.max(base, colX[p]! + pc[1]);
          }
        }
        let lx = base + M.channelGap;
        for (const l of lanes) if (spansOverlap(l.j, j)) lx = Math.max(lx, l.x + M.channelSp);
        lx = Math.round(lx);
        laneX.set(j.id, lx);
        lanes.push({ x: lx, j, rows: new Set(rs) });
      }
    }
    for (const c of elems) for (const j of leftAt.get(c) ?? []) laneX.set(j.id, colX[c]! - leftD.get(j.id)!);
    let right = leftLimit;
    for (const p of placed) {
      for (let r = 0; r < rows; r++) {
        const pc = cellAt(r, p);
        if (pc) right = Math.max(right, colX[p]! + pc[1]);
      }
    }
    for (const l of lanes) right = Math.max(right, l.x);
    leftLimit = right + M.groupGap;
  });

  // ---- horizontals of the jump wires in the gaps -> lanes ----
  interface Horiz extends HLine {
    gap: number;
  }
  const exitH = new Map<string, Horiz>();
  const entryH = new Map<string, Horiz>();
  for (const j of jumps) {
    const sx = colX[j.srcCol]!;
    const tx = colX[j.tgtCol]!;
    const lx = laneX.get(j.id)!;
    const same = j.entryGap === j.exitGap;
    const back = j.entryGap < j.exitGap;
    exitH.set(j.id, {
      gap: j.exitGap,
      x0: Math.min(sx, lx),
      x1: Math.max(sx, lx),
      ends: [
        { x: sx, dir: "up" },
        { x: lx, dir: same ? "none" : back ? "up" : "down" },
      ],
      lane: 0,
    });
    entryH.set(j.id, {
      gap: j.entryGap,
      x0: Math.min(tx, lx),
      x1: Math.max(tx, lx),
      ends: [
        { x: lx, dir: same ? "none" : back ? "down" : "up" },
        { x: tx, dir: j.top ? "down" : "none" },
      ],
      lane: 0,
    });
  }
  const lanesInGap = new Array<number>(rows + 1).fill(0);
  for (let g = 0; g <= rows; g++) {
    const inGap: Horiz[] = [];
    for (const j of jumps) {
      if (exitH.get(j.id)!.gap === g) inGap.push(exitH.get(j.id)!);
      if (entryH.get(j.id)!.gap === g) inGap.push(entryH.get(j.id)!);
    }
    lanesInGap[g] = orderLanes(inGap);
  }
  const labelInGap = new Array<boolean>(rows + 1).fill(false);
  const xrefInGap = new Array<boolean>(rows + 1).fill(false);
  for (const j of xrefs) xrefInGap[j.exitGap] = true;
  for (const t of fromLabel.keys()) labelInGap[layout.nodes.get(t)!.row] = true;

  // ---- row y ----
  const above = new Array<number>(rows).fill(4);
  const below = new Array<number>(rows).fill(4);
  const filled = new Array<boolean>(rows).fill(false);
  const need = (r: number, a: number, b: number): void => {
    above[r] = Math.max(above[r]!, a);
    below[r] = Math.max(below[r]!, b);
    filled[r] = true;
  };
  for (const nd of layout.nodes.values()) {
    const ext = nd.kind === "step" ? stepPlans.get(nd.id)!.ext : transPlans.get(nd.id)!.ext;
    need(nd.row, ext.above, ext.below);
  }
  for (const b of layout.bars.values()) {
    if (routes.hiddenBars.has(b.id)) continue;
    const d = branchById.get(b.id)!.type === "simultaneous" ? M.barDouble + 1 : 1;
    need(b.row, d, d);
  }
  // A jog's horizontal gets some room above it, so its drop does not read as the
  // continuation of a line ending just above it in the same column.
  for (const w of jogs) need(w.points[1]!.row, 12, 1);
  // Rows with nothing drawn (an automatic convergence bar only) take no room.
  for (let r = 0; r < rows; r++) {
    if (filled[r]) continue;
    above[r] = 0;
    below[r] = 0;
  }
  const lanesBottom = (g: number): number => (lanesInGap[g]! > 0 ? M.lanePad + (lanesInGap[g]! - 1) * M.laneSp : 0);
  const xrefTip = (g: number): number => Math.max(lanesBottom(g) + 4, 4) + 12;
  const gapH: number[] = [];
  for (let g = 0; g <= rows; g++) {
    const lanes = lanesInGap[g]!;
    const outer = g === 0 || g === rows;
    const empty = g < rows && !filled[g] && lanes === 0 && !labelInGap[g] && !xrefInGap[g];
    const laneNeed = lanes > 0 ? 2 * M.lanePad + (lanes - 1) * M.laneSp : 0;
    let h = empty ? 0 : Math.max(outer ? 0 : M.gapBase, laneNeed);
    if (labelInGap[g]) h = Math.max(h + M.labelH, lanesBottom(g) + 4 + M.labelH);
    if (xrefInGap[g]) h = Math.max(h + M.labelH, xrefTip(g) + 10);
    gapH.push(h);
  }
  const rowY: number[] = [];
  const gapTop: number[] = [];
  let cursor = 0;
  for (let r = 0; r < rows; r++) {
    gapTop.push(cursor);
    cursor += gapH[r]!;
    rowY.push(Math.round(cursor + above[r]!));
    cursor = rowY[r]! + below[r]!;
  }
  gapTop.push(cursor);
  cursor += gapH[rows]!;
  const totalBottom = cursor;
  const laneY = (gap: number, lane: number): number => Math.round(gapTop[gap]! + M.lanePad + lane * M.laneSp);

  // ---- endpoints ----
  const barHalf = (barId: GraphId | undefined): number =>
    barId !== undefined && branchById.get(barId)?.type === "simultaneous" && !routes.hiddenBars.has(barId) ? M.barDouble : 0;
  const topOf = (e: GridEnd): number => {
    const y = rowY[e.row]!;
    if (e.kind === "step") return y - M.stepH / 2;
    if (e.kind === "bar") return y - barHalf(e.bar);
    return y;
  };
  const bottomOf = (e: GridEnd): number => {
    const y = rowY[e.row]!;
    if (e.kind === "step") return y + M.stepH / 2;
    if (e.kind === "bar") return y + barHalf(e.bar);
    return y;
  };

  // ---- drawing, collecting the geometry for the crossing check ----
  const out: string[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const extend = (x0: number, y0: number, x1: number, y1: number): void => {
    minX = Math.min(minX, x0, x1);
    maxX = Math.max(maxX, x0, x1);
    minY = Math.min(minY, y0, y1);
    maxY = Math.max(maxY, y0, y1);
  };
  extend(0, 0, 0, totalBottom);
  const segs: Seg[] = [];
  const boxes: Box[] = [];
  const jumpSegs = new Map<string, Seg[]>();
  const addPolyline = (pts: Array<[number, number]>, owner: string, into: Seg[] = segs): void => {
    for (let k = 0; k + 1 < pts.length; k++) {
      into.push({ x0: pts[k]![0], y0: pts[k]![1], x1: pts[k + 1]![0], y1: pts[k + 1]![1], owner });
    }
  };
  const addText = (x: number, y: number, w: number, size: number, anchor: "start" | "middle" | "end", owner: string): void => {
    const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
    boxes.push({ x0, y0: y - size * 0.75, x1: x0 + w, y1: y + size * 0.22, owner });
  };
  const pathD = (pts: Array<[number, number]>): string =>
    pts.map((p, k) => (k === 0 ? `M${n(p[0])} ${n(p[1])}` : p[0] === pts[k - 1]![0] ? `V${n(p[1])}` : p[1] === pts[k - 1]![1] ? `H${n(p[0])}` : `L${n(p[0])} ${n(p[1])}`)).join("");
  const arrowD = (tip: [number, number], dx: number, dy: number): string => {
    // (dx, dy): unit direction of travel at the tip.
    const bx = tip[0] - dx * M.arrowL;
    const by = tip[1] - dy * M.arrowL;
    const px = -dy * M.arrowW;
    const py = dx * M.arrowW;
    return `M${n(tip[0])} ${n(tip[1])}L${n(bx + px)} ${n(by + py)}L${n(bx - px)} ${n(by - py)}Z`;
  };

  // Lines first (under the boxes and bars).
  const lines: string[] = [];
  for (const v of vlinks) {
    const x0 = colX[v.from.col]!;
    const x1 = colX[v.to.col]!;
    const y0 = bottomOf(v.from);
    const y1 = topOf(v.to);
    const pts: Array<[number, number]> =
      x0 === x1
        ? [
            [x0, y0],
            [x1, y1],
          ]
        : [
            [x0, y0],
            [x0, Math.round((y0 + y1) / 2)],
            [x1, Math.round((y0 + y1) / 2)],
            [x1, y1],
          ];
    extend(x0, y0, x1, y1);
    addPolyline(pts, v.id);
    lines.push(`<path class="qsfc-wire qsfc-link" data-id="${escapeXml(v.id)}" d="${pathD(pts)}"/>`);
  }
  for (const w of jogs) {
    const [p0, p1, p2, p3] = w.points as [GridPoint, GridPoint, GridPoint, GridPoint];
    const pts: Array<[number, number]> = [
      [colX[p0.col]!, rowY[p0.row]!],
      [colX[p1.col]!, rowY[p1.row]!],
      [colX[p2.col]!, rowY[p2.row]!],
      [colX[p3.col]!, topOf({ row: p3.row, col: p3.col, kind: layout.nodes.get(w.to)?.kind ?? "step" })],
    ];
    for (const p of pts) extend(p[0], p[1], p[0], p[1]);
    const id = `${w.from}-${w.to}`;
    addPolyline(pts, id);
    lines.push(`<g class="qsfc-wire qsfc-jog" data-id="${escapeXml(id)}"><path class="qsfc-wire-line" d="${pathD(pts)}"/></g>`);
  }

  // Jump wires: down from the transition, along the lane, into the target.
  const entryY = new Map<string, number>();
  for (const j of jumps) entryY.set(j.id, laneY(j.entryGap, entryH.get(j.id)!.lane));
  const stubOwner = new Map<GraphId, Jump>();
  for (const j of jumps) {
    if (!j.top) continue;
    const o = stubOwner.get(j.target);
    if (!o || entryY.get(j.id)! < entryY.get(o.id)! || (entryY.get(j.id) === entryY.get(o.id) && j.order < o.order)) {
      stubOwner.set(j.target, j);
    }
  }
  for (const j of jumps) {
    const sx = colX[j.srcCol]!;
    const tx = colX[j.tgtCol]!;
    const lx = laneX.get(j.id)!;
    const yExit = laneY(j.exitGap, exitH.get(j.id)!.lane);
    const yEntry = entryY.get(j.id)!;
    const target = stepById.get(j.target)!;
    const pts: Array<[number, number]> = [
      [sx, rowY[j.srcRow]!],
      [sx, yExit],
      [lx, yExit],
      [lx, yEntry],
      [tx, yEntry],
    ];
    if (stubOwner.get(j.target) === j) pts.push([tx, rowY[j.tgtRow]! - M.stepH / 2]);
    const clean = pts.filter((p, k) => k === 0 || p[0] !== pts[k - 1]![0] || p[1] !== pts[k - 1]![1]);
    // Another jump into the same step: the owner of the stub draws the one arrow into the step;
    // this wire ends on the stub (a T junction) without an arrowhead, so two arrows don't
    // crowd the top of the step (example "Selection", 2026-11-27).
    const owner = stubOwner.get(j.target);
    if (j.top && owner && owner !== j) {
      for (const p of clean) extend(p[0], p[1], p[0], p[1]);
      const own: Seg[] = [];
      addPolyline(clean, j.id, own);
      jumpSegs.set(j.id, own);
      lines.push(
        `<g class="qsfc-wire qsfc-jump" data-id="${escapeXml(j.id)}"><title>${escapeXml(`jump to ${target.name}`)}</title>` +
          `<path class="qsfc-wire-line" d="${pathD(clean)}"/></g>`,
      );
      continue;
    }
    const tip = clean[clean.length - 1]!;
    const prev = clean[clean.length - 2]!;
    const len = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]) || 1;
    const dx = (tip[0] - prev[0]) / len;
    const dy = (tip[1] - prev[1]) / len;
    const line = [...clean.slice(0, -1), [tip[0] - dx * (M.arrowL - 1), tip[1] - dy * (M.arrowL - 1)] as [number, number]];
    for (const p of clean) extend(p[0], p[1], p[0], p[1]);
    const own: Seg[] = [];
    addPolyline(line, j.id, own);
    jumpSegs.set(j.id, own);
    const kind = j.top ? "jump" : "jump-join";
    const title = `<title>${escapeXml(`jump to ${target.name}`)}</title>`;
    lines.push(
      `<g class="qsfc-wire qsfc-${kind}" data-id="${escapeXml(j.id)}">${title}<path class="qsfc-wire-line" d="${pathD(line)}"/>` +
        `<path class="qsfc-arrow" d="${arrowD(tip, dx, dy)}"/></g>`,
    );
  }

  // Cross-references: a short arrow under the transition, labelled with the target.
  for (const j of xrefs) {
    const sx = colX[j.srcCol]!;
    const sy = rowY[j.srcRow]!;
    const tipY = gapTop[j.exitGap]! + xrefTip(j.exitGap);
    const label = xrefLabel.get(j.id)!;
    const target = stepById.get(j.target)!;
    const line: Array<[number, number]> = [
      [sx, sy],
      [sx, tipY - M.arrowL + 1],
    ];
    addPolyline(line, j.id);
    const lx = sx + labelDx;
    const ly = tipY - 1;
    const lw = sansWidth(label.text, M.labelSize);
    addText(lx, ly, lw, M.labelSize, "start", j.id);
    extend(sx - M.arrowW, sy, lx + lw, tipY);
    lines.push(
      `<g class="qsfc-wire qsfc-xref" data-id="${escapeXml(j.id)}"><title>${escapeXml(`jump to ${target.name} (hidden wire)`)}</title>` +
        `<path class="qsfc-wire-line" d="${pathD(line)}"/><path class="qsfc-arrow" d="${arrowD([sx, tipY], 0, 1)}"/>` +
        `${textEl("qsfc-jump-label", lx, ly, label, labelOf(target))}</g>`,
    );
  }
  out.push(`<g class="qsfc-wires">${lines.join("")}</g>`);

  // Bars (automatic convergences are not drawn: their jumps join the line above the step).
  const barRange = (b: { id: GraphId; col: number; colEnd: number }): [number, number] => {
    const x0 = colX[b.col]! - M.barOverhang;
    const x1 = colX[b.colEnd]! + M.barOverhang;
    const minHalf = 14;
    if (x1 - x0 >= 2 * minHalf) return [x0, x1];
    return [Math.min(x0, colX[b.col]! - minHalf), Math.max(x1, colX[b.col]! + minHalf)];
  };
  const bars: string[] = [];
  for (const g of graph.branches) {
    const b = layout.bars.get(g.id);
    if (!b || routes.hiddenBars.has(g.id)) continue;
    const y = rowY[b.row]!;
    const [xa, xb] = barRange(b);
    const type = g.type === "simultaneous" ? "simultaneous" : "selection";
    const cls = `qsfc-branch qsfc-${type} qsfc-${g.flow}`;
    let d: string;
    if (type === "simultaneous") {
      d = `M${n(xa)} ${n(y - M.barDouble)}H${n(xb)}M${n(xa)} ${n(y + M.barDouble)}H${n(xb)}`;
      segs.push({ x0: xa, y0: y - M.barDouble, x1: xb, y1: y - M.barDouble, owner: g.id });
      segs.push({ x0: xa, y0: y + M.barDouble, x1: xb, y1: y + M.barDouble, owner: g.id });
    } else {
      d = `M${n(xa)} ${n(y)}H${n(xb)}`;
      segs.push({ x0: xa, y0: y, x1: xb, y1: y, owner: g.id });
    }
    extend(xa, y - M.barDouble, xb, y + M.barDouble);
    bars.push(`<g class="${cls}" data-id="${escapeXml(g.id)}"><path class="qsfc-bar" d="${d}"/></g>`);
  }
  out.push(`<g class="qsfc-branches">${bars.join("")}</g>`);

  // Transitions.
  const trans: string[] = [];
  for (const t of graph.transitions) {
    const p = layout.nodes.get(t.id);
    if (!p) continue;
    const plan = transPlans.get(t.id)!;
    const x = colX[p.col]!;
    const y = rowY[p.row]!;
    const half = M.transBarW / 2;
    const parts: string[] = [];
    const tip = t.auto ? t.condition : `${t.name}: ${t.condition}`;
    parts.push(`<title>${escapeXml(tip)}</title>`);
    parts.push(
      `<rect class="qsfc-trans-bar" x="${n(x - half)}" y="${n(y - M.transBarH / 2)}" width="${n(M.transBarW)}" height="${n(M.transBarH)}"/>`,
    );
    boxes.push({ x0: x - half, y0: y - M.transBarH / 2, x1: x + half, y1: y + M.transBarH / 2, owner: t.id });
    if (plan.name && look === "studio") {
      const bx1 = x - half - 10;
      const bx0 = bx1 - plan.nameW;
      parts.push(`<path class="qsfc-tname-link" d="M${n(bx1)} ${n(y)}H${n(x - half)}"/>`);
      parts.push(`<rect class="qsfc-tname-box" x="${n(bx0)}" y="${n(y - 8.5)}" width="${n(plan.nameW)}" height="17" rx="2"/>`);
      parts.push(textEl("qsfc-tname", (bx0 + bx1) / 2, y + 3.6, plan.name, t.name, "middle"));
      segs.push({ x0: bx1, y0: y, x1: x - half, y1: y, owner: t.id });
      boxes.push({ x0: bx0, y0: y - 8.5, x1: bx1, y1: y + 8.5, owner: t.id });
      extend(bx0, y - 8.5, bx1, y + 8.5);
    } else if (plan.name) {
      const tx = x - half - 8;
      parts.push(textEl("qsfc-tname", tx, y + 3.8, plan.name, `(${t.name})`, "end"));
      addText(tx, y + 3.8, plan.nameW, M.labelSize, "end", t.id);
      extend(tx - plan.nameW, y - 8, tx, y + 8);
    }
    const cx = x + half + M.transTextGap;
    parts.push(textEl("qsfc-code qsfc-cond", cx, y + 3.8, plan.cond, t.condition));
    addText(cx, y + 3.8, monoWidth(plan.cond.text, M.codeSize), M.codeSize, "start", t.id);
    extend(x - half, y - M.transHalfH, cx + monoWidth(plan.cond.text, M.codeSize), y + M.transHalfH);
    trans.push(`<g class="qsfc-transition${t.auto ? " qsfc-auto" : ""}" data-id="${escapeXml(t.id)}">${parts.join("")}</g>`);
  }
  out.push(`<g class="qsfc-transitions">${trans.join("")}</g>`);

  // Steps (with their actions).
  const steps: string[] = [];
  for (const s of graph.steps) {
    const p = layout.nodes.get(s.id);
    if (!p) continue;
    const plan = stepPlans.get(s.id)!;
    const x = colX[p.col]!;
    const y = rowY[p.row]!;
    const x0 = x - plan.w / 2;
    const y0 = y - plan.h / 2;
    const parts: string[] = [];
    const tipParts = [s.name];
    if (s.description) tipParts.push(s.description);
    if (s.presetMs > 0) tipParts.push(`preset ${formatDuration(s.presetMs)}`);
    if (s.initial) tipParts.push("initial step");
    parts.push(`<title>${escapeXml(`${tipParts.join(" — ")} (${operand("Step", s.operand)})`)}</title>`);
    parts.push(`<rect class="qsfc-step-box" x="${n(x0)}" y="${n(y0)}" width="${n(plan.w)}" height="${n(plan.h)}"/>`);
    boxes.push({ x0, y0, x1: x0 + plan.w, y1: y0 + plan.h, owner: s.id });
    if (s.initial) {
      const k = M.initialInset;
      parts.push(
        `<rect class="qsfc-step-inner" x="${n(x0 + k)}" y="${n(y0 + k)}" width="${n(plan.w - 2 * k)}" height="${n(plan.h - 2 * k)}"/>`,
      );
    }
    const labelFull = numbers ? String(s.index + 1) : s.name;
    if (look === "studio") {
      parts.push(textEl("qsfc-name", x, y - 1, plan.label, labelFull, "middle"));
      parts.push(textEl("qsfc-caption", x, y + 13, { text: studioCaption(s), truncated: false }, "", "middle"));
    } else if (!numbers && s.presetMs > 0) {
      parts.push(textEl("qsfc-name", x, y + 1, plan.label, labelFull, "middle"));
      parts.push(textEl("qsfc-caption", x, y + 14, { text: formatDuration(s.presetMs), truncated: false }, "", "middle"));
    } else {
      parts.push(textEl("qsfc-name", x, y + M.nameSize * 0.36, plan.label, labelFull, "middle"));
    }
    if (plan.side) {
      const sx = x0 - 6;
      const sy = s.presetMs > 0 ? y - 1 : y + 3.8;
      parts.push(textEl("qsfc-side-name", sx, sy, plan.side, s.name, "end"));
      addText(sx, sy, sansWidth(plan.side.text, M.labelSize), M.labelSize, "end", s.id);
      if (s.presetMs > 0) {
        const cap = formatDuration(s.presetMs);
        parts.push(textEl("qsfc-caption", sx, y + 11, { text: cap, truncated: false }, "", "end"));
        addText(sx, y + 11, sansWidth(cap, M.captionSize), M.captionSize, "end", s.id);
      }
    }
    extend(x - plan.ext.left, y0, x + plan.w / 2, y0 + plan.h);
    if (plan.action) {
      parts.push(drawAction(plan, x, y0, look, M, extend));
      const ax = x + plan.w / 2 + M.actionGap;
      const linkY = look === "studio" ? y0 + Math.min(plan.h / 2, M.actionHeader / 2 + 0.5) : y0 + plan.h / 2;
      segs.push({ x0: x + plan.w / 2, y0: linkY, x1: ax, y1: linkY, owner: s.id });
      boxes.push({ x0: ax, y0, x1: ax + plan.action.w, y1: y0 + plan.action.h, owner: s.id });
    }
    steps.push(`<g class="qsfc-step${s.initial ? " qsfc-initial" : ""}" data-id="${escapeXml(s.id)}">${parts.join("")}</g>`);
  }
  out.push(`<g class="qsfc-steps">${steps.join("")}</g>`);

  // Incoming ends of the hidden wires: a dashed arrow into the top of the target, labelled
  // with the source transition (mockup docs/mockups/xref, option C).
  if (fromLabel.size > 0) {
    const marks: string[] = [];
    for (const [t, label] of fromLabel) {
      const nd = layout.nodes.get(t)!;
      const top = rowY[nd.row]! - M.stepH / 2;
      const ax = colX[nd.col]! + (centred.has(t) ? 0 : 12);
      const ay = top - M.labelSize - 8;
      const line: Array<[number, number]> = [
        [ax, ay],
        [ax, top - M.arrowL + 1],
      ];
      const lx = ax + labelDx;
      const ly = ay + M.labelSize - 1;
      const lw = sansWidth(label.fitted.text, M.labelSize);
      marks.push(
        `<g class="qsfc-xref-in"><title>${escapeXml(`${label.full} (hidden wire)`)}</title>` +
          `<path class="qsfc-wire-line" d="${pathD(line)}"/><path class="qsfc-arrow" d="${arrowD([ax, top], 0, 1)}"/>` +
          `${textEl("qsfc-xref-from", lx, ly, label.fitted, label.full)}</g>`,
      );
      addText(lx, ly, lw, M.labelSize, "start", `from-${t}`);
      extend(ax - M.arrowW, ay, lx + lw, top);
    }
    out.push(`<g class="qsfc-xref-marks">${marks.join("")}</g>`);
  }

  // ---- crossings of the jump wires ----
  const bad = new Map<string, number>();
  let total = 0;
  const hit = (a: string, b?: string): void => {
    total++;
    bad.set(a, (bad.get(a) ?? 0) + 1);
    if (b !== undefined) bad.set(b, (bad.get(b) ?? 0) + 1);
  };
  const ids = [...jumpSegs.keys()];
  ids.forEach((id, i) => {
    const mine = jumpSegs.get(id)!;
    for (const s of mine) {
      for (const o of segs) if (o.owner !== id && segmentsCross(s, o)) hit(id);
      for (const b of boxes) if (segmentHitsBox(s, b)) hit(id);
    }
    for (const other of ids.slice(i + 1)) {
      const theirs = jumpSegs.get(other)!;
      if (mine.some((s) => theirs.some((o) => segmentsCross(s, o)))) hit(id, other);
    }
  });

  // ---- frame ----
  const vx = Math.floor(minX - M.margin);
  const vy = Math.floor(minY - M.margin);
  const vw = Math.ceil(maxX + M.margin) - vx;
  const vh = Math.ceil(maxY + M.margin) - vy;
  const cls = `qsfc qsfc-look-${look}${numbers ? " qsfc-numbers" : ""}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}" role="img">\n` +
    `<style>${css(look)}</style>\n` +
    `<rect class="qsfc-bg" x="${vx}" y="${vy}" width="${vw}" height="${vh}"/>\n` +
    `${out.join("\n")}\n</svg>\n`;
  return { svg, bad, total };
}


function drawAction(
  plan: StepPlan,
  x: number,
  y0: number,
  look: SvgLook,
  M: Metrics,
  extend: (x0: number, y0: number, x1: number, y1: number) => void,
): string {
  const a = plan.action!;
  const ax = x + plan.w / 2 + M.actionGap;
  const linkY = look === "studio" ? y0 + Math.min(plan.h / 2, M.actionHeader / 2 + 0.5) : y0 + plan.h / 2;
  const link = `<path class="qsfc-action-link" d="M${n(x + plan.w / 2)} ${n(linkY)}H${n(ax)}"/>`;
  const cw = a.cellW;
  // One group per action, stacked from the top of the step (SPEC §4.3).
  const groups = a.rows.map((r) => {
    const ry = y0 + r.y;
    const parts: string[] = [];
    parts.push(`<title>${escapeXml(r.full)}</title>`);
    parts.push(`<rect class="qsfc-action-box" x="${n(ax)}" y="${n(ry)}" width="${n(a.w)}" height="${n(r.h)}"/>`);
    let textX: number;
    let textY: number;
    if (look === "studio") {
      const hh = M.actionHeader;
      parts.push(`<rect class="qsfc-action-head" x="${n(ax)}" y="${n(ry)}" width="${n(a.w)}" height="${n(hh)}"/>`);
      parts.push(`<path class="qsfc-action-sep" d="M${n(ax)} ${n(ry + hh)}H${n(ax + a.w)}M${n(ax + cw)} ${n(ry)}V${n(ry + hh)}"/>`);
      parts.push(`<text class="qsfc-qualifier" x="${n(ax + cw / 2)}" y="${n(ry + 12)}" text-anchor="middle">${escapeXml(r.label)}</text>`);
      parts.push(`<text class="qsfc-action-name" x="${n(ax + cw + 7)}" y="${n(ry + 12)}">${escapeXml(r.operand)}</text>`);
      textX = ax + M.actionPad;
      textY = ry + hh + M.actionPad + 7;
    } else {
      parts.push(`<path class="qsfc-action-sep" d="M${n(ax + cw)} ${n(ry)}V${n(ry + r.h)}"/>`);
      parts.push(
        `<text class="qsfc-qualifier" x="${n(ax + cw / 2)}" y="${n(ry + r.h / 2 + 4)}" text-anchor="middle">${escapeXml(r.label)}</text>`,
      );
      const rows = r.lines.length + (r.more ? 1 : 0);
      textX = ax + cw + M.actionPad;
      textY = ry + (r.h - rows * M.lineH) / 2 + M.lineH - 4;
    }
    r.lines.forEach((l, k) => {
      parts.push(textEl("qsfc-code", textX, textY + k * M.lineH, l, r.raw[k] ?? ""));
    });
    if (r.more) parts.push(`<text class="qsfc-code qsfc-more" x="${n(textX)}" y="${n(textY + r.lines.length * M.lineH)}">…</text>`);
    return `<g class="qsfc-action">${parts.join("")}</g>`;
  });
  extend(x + plan.w / 2, y0, ax + a.w, y0 + a.h);
  return `${link}${groups.join("")}`;
}

// ---------------------------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------------------------

const PALETTES: Record<SvgLook, { light: Record<string, string>; dark: Record<string, string> }> = {
  studio: {
    light: {
      bg: "#ffffff",
      line: "#4b5159",
      "box-fill": "#ffffff",
      "box-stroke": "#4b5159",
      name: "#1a5fb4",
      caption: "#6b7280",
      code: "#24292f",
      "head-fill": "#edf1f6",
      "head-text": "#3d4450",
      "tname-fill": "#f4f6f9",
      "tname-stroke": "#8a929c",
      tname: "#1a5fb4",
      "trans-bar": "#24292f",
      label: "#5b6470",
    },
    dark: {
      bg: "#1c1f24",
      line: "#9aa4af",
      "box-fill": "#23272e",
      "box-stroke": "#9aa4af",
      name: "#79b0ff",
      caption: "#8d96a0",
      code: "#d5dbe1",
      "head-fill": "#2c323a",
      "head-text": "#c3cad2",
      "tname-fill": "#2a3038",
      "tname-stroke": "#6f7983",
      tname: "#79b0ff",
      "trans-bar": "#d5dbe1",
      label: "#9aa4af",
    },
  },
  textbook: {
    light: {
      bg: "#ffffff",
      line: "#111111",
      "box-fill": "#ffffff",
      "box-stroke": "#111111",
      name: "#111111",
      caption: "#444444",
      code: "#111111",
      "head-fill": "#ffffff",
      "head-text": "#111111",
      "tname-fill": "#ffffff",
      "tname-stroke": "#111111",
      tname: "#333333",
      "trans-bar": "#111111",
      label: "#333333",
    },
    dark: {
      bg: "#141414",
      line: "#e6e6e6",
      "box-fill": "#141414",
      "box-stroke": "#e6e6e6",
      name: "#f2f2f2",
      caption: "#bbbbbb",
      code: "#eeeeee",
      "head-fill": "#141414",
      "head-text": "#eeeeee",
      "tname-fill": "#141414",
      "tname-stroke": "#e6e6e6",
      tname: "#cccccc",
      "trans-bar": "#eeeeee",
      label: "#cccccc",
    },
  },
};

function vars(p: Record<string, string>): string {
  return Object.entries(p)
    .map(([k, v]) => `--qsfc-${k}:${v};`)
    .join("");
}

function css(look: SvgLook): string {
  const L = `.qsfc-look-${look}`;
  const p = PALETTES[look];
  const studio = look === "studio";
  const rules = [
    `${L}{${vars(p.light)}}`,
    `@media (prefers-color-scheme: dark){${L}:not(.qsfc-light *){${vars(p.dark)}}}`,
    `.qsfc-dark ${L}{${vars(p.dark)}}`,
    `${L} .qsfc-bg{fill:var(--qsfc-bg)}`,
    `${L} text{font-family:${SANS};fill:var(--qsfc-name)}`,
    `${L} .qsfc-wire,${L} .qsfc-wire-line{fill:none;stroke:var(--qsfc-line);stroke-width:1.5;stroke-linejoin:miter}`,
    `${L} g.qsfc-wire{stroke:none}`,
    `${L} .qsfc-arrow{fill:var(--qsfc-line);stroke:none}`,
    `${L} .qsfc-xref .qsfc-wire-line,${L} .qsfc-xref-in .qsfc-wire-line{fill:none;stroke:var(--qsfc-line);stroke-width:1.5;stroke-dasharray:4 3}`,
    `${L} .qsfc-bar{fill:none;stroke:var(--qsfc-line);stroke-width:${studio ? 1.5 : 1.6}}`,
    `${L} .qsfc-step-box,${L} .qsfc-step-inner{fill:var(--qsfc-box-fill);stroke:var(--qsfc-box-stroke);stroke-width:${studio ? 1.25 : 1.5}}`,
    `${L} .qsfc-step-inner{fill:none}`,
    `${L} .qsfc-name{font-size:${studio ? STUDIO.nameSize : TEXTBOOK.nameSize}px;font-weight:${studio ? 600 : 400};fill:var(--qsfc-name)}`,
    `${L} .qsfc-caption{font-size:9.5px;fill:var(--qsfc-caption)}`,
    `${L} .qsfc-side-name{font-size:${TEXTBOOK.labelSize}px;font-style:italic;fill:var(--qsfc-label)}`,
    `${L} .qsfc-code{font-family:${MONO};font-size:11px;white-space:pre;fill:var(--qsfc-code)}`,
    `${L} .qsfc-action-box{fill:var(--qsfc-box-fill);stroke:var(--qsfc-box-stroke);stroke-width:1.1}`,
    `${L} .qsfc-action-head{fill:var(--qsfc-head-fill);stroke:none}`,
    `${L} .qsfc-action-sep,${L} .qsfc-action-link,${L} .qsfc-tname-link{fill:none;stroke:var(--qsfc-box-stroke);stroke-width:1.1}`,
    `${L} .qsfc-qualifier{font-size:10.5px;font-weight:700;fill:var(--qsfc-head-text)}`,
    `${L} .qsfc-action-name{font-size:10px;fill:var(--qsfc-head-text)}`,
    `${L} .qsfc-trans-bar{fill:var(--qsfc-trans-bar)}`,
    `${L} .qsfc-tname-box{fill:var(--qsfc-tname-fill);stroke:var(--qsfc-tname-stroke);stroke-width:1}`,
    `${L} .qsfc-tname{font-size:${studio ? STUDIO.labelSize : TEXTBOOK.labelSize}px;font-weight:${studio ? 600 : 400};${studio ? "" : "font-style:italic;"}fill:var(--qsfc-tname)}`,
    `${L} .qsfc-jump-label,${L} .qsfc-xref-from{font-size:${TEXTBOOK.labelSize}px;font-style:italic;fill:var(--qsfc-label)}`,
  ];
  return rules.join("");
}
