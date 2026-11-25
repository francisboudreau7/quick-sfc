/**
 * SVG view (Phase 2), drawn from the same grid Layout as the ASCII view and the L5X
 * coordinates. Pure and deterministic: returns a self-contained SVG string.
 *
 * Two looks share all the geometry below; only the drawing of the elements differs:
 *   - "studio":   Studio 5000 SFC editor style (rectangle steps with operand caption,
 *                 action box with an N / Action_nnn header, transition bar with a name box);
 *   - "textbook": IEC 60848 GRAFCET / IEC 61131-3 course style (square steps, action
 *                 rectangles with a qualifier cell, thick transition bar, wide branch lines,
 *                 labelled jump arrows).
 *
 * Geometry:
 *   - x: every element column gets a line x. Columns are packed row by row (like the
 *     ASCII view): a column sits as far left as the content of the columns on its left
 *     allows in the rows where both have something (text, box, line). Channel columns
 *     (routed wires) sit right of their column group's content; groups never share x.
 *   - y: every row is a band as tall as its content (step box, action box, transition
 *     text). Between two rows there is a gap ("half row" of the layout) that holds the
 *     horizontal parts of routed wires, one lane per wire when they overlap, plus a
 *     label slot under the lanes when a labelled arrow ends there.
 *   - Wires: graph links between neighbours are straight vertical lines; jumps, loops
 *     and jogs follow the layout's wire routes. Wires into a convergence bar from a
 *     channel ("wired" legs) land on the bar to the right of its last leg.
 *
 * Every step, transition, branch bar and wire carries `data-id` (graph id; wires use
 * `from-to`) and a `qsfc-*` class. Colors are CSS custom properties `--qsfc-*` with a
 * dark variant (prefers-color-scheme, or `.qsfc-dark` on an ancestor; `.qsfc-light`
 * on an ancestor forces the light colors).
 */
import { key } from "../model/ast.js";
import type { GBranch, Graph, GraphId, GStep, GTransition } from "../model/graph.js";
import type { Layout, Wire } from "../layout/index.js";
import { formatDuration } from "./ascii.js";

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
  labelH: 0,
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
  action?: {
    lines: Fitted[];
    more: boolean;
    full: string;
    operand: string;
    w: number;
    h: number;
  };
  ext: Extent;
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
  if (showActions && s.action.length > 0) {
    const shown = s.action.slice(0, M.maxActionLines).map((l) => fitChars(l.replace(/\s+$/, ""), M.maxCodeChars));
    const more = s.action.length > M.maxActionLines;
    const rows = shown.length + (more ? 1 : 0);
    const codeW = Math.max(...shown.map((l) => monoWidth(l.text, M.codeSize)), more ? monoWidth("…", M.codeSize) : 0);
    // Studio's action operand: the L5X writer (default nameComments) gives every step an action.
    const op = operand("Action", s.index);
    let aw: number;
    let ah: number;
    if (look === "studio") {
      const headW = M.actionCellW + 8 + sansWidth(op, M.captionSize + 0.5) + 8;
      aw = Math.max(headW, codeW + 2 * M.actionPad, 90);
      ah = M.actionHeader + M.actionPad + rows * M.lineH - 2;
    } else {
      aw = M.actionCellW + codeW + 2 * M.actionPad;
      ah = Math.max(h, rows * M.lineH + 2 * M.actionPad - 2);
    }
    aw = Math.ceil(aw);
    plan.action = { lines: shown, more, full: s.action.join("\n"), operand: op, w: aw, h: ah };
    ext.right = w / 2 + M.actionGap + aw;
    ext.below = Math.max(ext.below, ah - h / 2);
  }
  return plan;
}

function studioCaption(s: GStep): string {
  const op = operand("Step", s.index);
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
  /** Extra x (wired legs land right of the bar's last leg). */
  dx: number;
  kind: "step" | "transition" | "bar";
  bar?: GraphId;
}

interface HSeg {
  gap: number;
  x0: number;
  x1: number;
  prio: number;
  wire: number;
  /** Index of the first point of the segment in the wire's points. */
  at: number;
  lane: number;
}

export function renderSvg(graph: Graph, layout: Layout, options: SvgOptions = {}): string {
  const look: SvgLook = options.look ?? "studio";
  const M = look === "studio" ? STUDIO : TEXTBOOK;
  const showActions = options.showActions ?? true;
  const numbers = look === "textbook" && options.numbering === "numbers";

  const stepById = new Map(graph.steps.map((s) => [s.id, s]));
  const transById = new Map(graph.transitions.map((t) => [t.id, t]));
  const branchById = new Map<GraphId, GBranch>(graph.branches.map((b) => [b.id, b]));
  const stepByKey = new Map(graph.steps.map((s) => [key(s.name), s]));

  const stepPlans = new Map<GraphId, StepPlan>();
  const transPlans = new Map<GraphId, TransPlan>();
  for (const s of graph.steps) stepPlans.set(s.id, planStep(s, M, look, numbers, showActions));
  for (const t of graph.transitions) transPlans.set(t.id, planTransition(t, M, look));

  // ---- wired legs: their x offset right of the bar's last leg ----
  const legDx = new Map<GraphId, number>();
  const barExtra = new Map<GraphId, number>();
  /** Rightmost wired leg of each bar: the only one that gets an arrow label (they all lead to the same step). */
  const lastWired = new Set<GraphId>();
  for (const b of graph.branches) {
    let k = 0;
    let last: GraphId | undefined;
    for (const leg of b.legs) {
      if (layout.legs.get(leg.id)?.wired) {
        legDx.set(leg.id, ++k * M.wiredSp);
        last = leg.id;
      }
    }
    if (last !== undefined) lastWired.add(last);
    barExtra.set(b.id, k * M.wiredSp);
  }

  // ---- labels at arrowheads (textbook) ----
  const labelOf = (s: GStep): string => (numbers ? String(s.index + 1) : s.name);
  const wireTarget = (w: Wire): GStep | undefined => {
    if (w.kind === "jump" || w.kind === "loop") return stepById.get(w.to);
    if (w.kind === "jump-leg") {
      const j = transById.get(w.from)?.node.jump;
      return j ? stepByKey.get(key(j.text)) : undefined;
    }
    return undefined;
  };
  const arrowWire = (w: Wire): boolean => w.kind !== "jog";
  const wireLabel = new Map<number, Fitted>();
  if (look === "textbook") {
    layout.wires.forEach((w, i) => {
      const t = wireTarget(w);
      if (!t || !arrowWire(w) || (w.kind === "jump-leg" && !lastWired.has(w.to))) return;
      wireLabel.set(i, fitChars(labelOf(t), 16));
    });
  }
  const labelDx = 5;

  // ---- graph links drawn as straight lines (the rest are layout wires) ----
  const wireKeys = new Set(layout.wires.map((w) => `${w.from}>${w.to}`));
  const resolve = (id: GraphId): GridEnd => {
    const node = layout.nodes.get(id);
    if (node) return { row: node.row, col: node.col, dx: 0, kind: node.kind };
    const bar = layout.bars.get(id);
    if (bar) return { row: bar.row, col: bar.col, dx: 0, kind: "bar", bar: bar.id };
    const leg = layout.legs.get(id);
    if (!leg) throw new Error(`SVG: no place for ${id}`);
    return { row: layout.bars.get(leg.branch)!.row, col: leg.col, dx: legDx.get(id) ?? 0, kind: "bar", bar: leg.branch };
  };
  const vlinks: Array<{ id: string; from: GridEnd; to: GridEnd }> = [];
  for (const link of graph.links) {
    if (wireKeys.has(`${link.from}>${link.to}`)) continue;
    vlinks.push({ id: `${link.from}-${link.to}`, from: resolve(link.from), to: resolve(link.to) });
  }

  // ---- cells: content extent left / right of each column line, per row ----
  const ncols = layout.columns.length;
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
    for (let c = b.col; c <= b.colEnd; c++) {
      mark(b.row, c, c === b.col ? M.barOverhang : 0, c === b.colEnd ? M.barOverhang + barExtra.get(b.id)! : 0);
    }
  }
  for (const v of vlinks) {
    for (let r = v.from.row + 1; r < v.to.row; r++) mark(r, v.from.col, 0, 0);
    if (v.from.col !== v.to.col) for (let r = v.from.row + 1; r < v.to.row; r++) mark(r, v.to.col, 0, 0);
  }
  layout.wires.forEach((w, i) => {
    if (w.kind === "jog") {
      const [p0, p1, p2, p3] = w.points as [typeof w.points[0], typeof w.points[0], typeof w.points[0], typeof w.points[0]];
      for (let r = p0.row + 1; r < p1.row; r++) mark(r, p0.col, 0, 0);
      for (let c = Math.min(p1.col, p2.col); c <= Math.max(p1.col, p2.col); c++) mark(p1.row, c, 0, 0);
      for (let r = p2.row + 1; r < p3.row; r++) mark(r, p2.col, 0, 0);
    }
    const label = wireLabel.get(i);
    if (label) {
      const end = w.points[w.points.length - 1]!;
      const dx = w.kind === "jump-leg" ? (legDx.get(w.to) ?? 0) : 0;
      mark(end.row, end.col, 0, dx + labelDx + sansWidth(label.text, M.labelSize) + 4);
    }
  });
  const cellAt = (r: number, c: number): [number, number] | undefined => cells.get(`${r},${c}`);

  // ---- column x ----
  const colX = new Array<number>(ncols).fill(0);
  let leftLimit = 0;
  layout.groups.forEach((_, g) => {
    const elems: number[] = [];
    const chans: number[] = [];
    layout.columns.forEach((col, c) => {
      if (col.group !== g) return;
      (col.kind === "element" ? elems : chans).push(c);
    });
    const placed: number[] = [];
    for (const c of elems) {
      let x = placed.length > 0 ? colX[placed[placed.length - 1]!]! + M.minSep : leftLimit;
      for (let r = 0; r < layout.rows; r++) {
        const cell = cellAt(r, c);
        if (!cell) continue;
        x = Math.max(x, leftLimit + cell[0]);
        for (const p of placed) {
          const pc = cellAt(r, p);
          if (pc) x = Math.max(x, colX[p]! + pc[1] + M.colGap + cell[0]);
        }
      }
      colX[c] = Math.round(x);
      placed.push(c);
    }
    let right = leftLimit;
    for (const p of placed) {
      for (let r = 0; r < layout.rows; r++) {
        const pc = cellAt(r, p);
        if (pc) right = Math.max(right, colX[p]! + pc[1]);
      }
    }
    chans.forEach((c, k) => {
      colX[c] = Math.round(right + M.channelGap + k * M.channelSp);
    });
    leftLimit = (chans.length > 0 ? colX[chans[chans.length - 1]!]! : right) + M.groupGap;
  });

  // ---- wire horizontals in gaps -> lanes ----
  // gap index g holds half row g - 0.5 (g = 0: above row 0; g = rows: below the last row).
  const gapOf = (row: number): number => Math.round(row + 0.5);
  const wireXs: number[][] = layout.wires.map((w) => {
    const xs = w.points.map((p) => colX[p.col]!);
    if (w.kind === "jump-leg") {
      const dx = legDx.get(w.to) ?? 0;
      xs[xs.length - 1]! += dx;
      xs[xs.length - 2]! += dx;
    }
    return xs;
  });
  // Drawn x range of every bar (a bar with one leg position still gets some width).
  const barRange = (b: { id: GraphId; col: number; colEnd: number }): [number, number] => {
    const x0 = colX[b.col]! - M.barOverhang;
    const x1 = colX[b.colEnd]! + (barExtra.get(b.id) ?? 0) + M.barOverhang;
    const minHalf = 14;
    if (x1 - x0 >= 2 * minHalf) return [x0, x1];
    return [Math.min(x0, colX[b.col]! - minHalf), Math.max(x1, colX[b.col]! + minHalf)];
  };
  // A loop bar that already spans its channel: the wire leaves the bar straight up the channel.
  const loopUp = new Set<number>();
  layout.wires.forEach((w, i) => {
    const bar = w.kind === "loop" ? layout.bars.get(w.from) : undefined;
    if (!bar) return;
    const [x0, x1] = barRange(bar);
    const ch = wireXs[i]![2]!;
    if (ch > x0 && ch < x1) loopUp.add(i);
  });
  const segs: HSeg[] = [];
  layout.wires.forEach((w, i) => {
    for (let k = loopUp.has(i) ? 2 : 0; k + 1 < w.points.length; k++) {
      const a = w.points[k]!;
      const b = w.points[k + 1]!;
      if (a.row !== b.row || Number.isInteger(a.row)) continue;
      const xa = wireXs[i]![k]!;
      const xb = wireXs[i]![k + 1]!;
      segs.push({ gap: gapOf(a.row), x0: Math.min(xa, xb), x1: Math.max(xa, xb), prio: k === 1 ? 0 : 1, wire: i, at: k, lane: 0 });
    }
  });
  const lanesInGap = new Array<number>(layout.rows + 1).fill(0);
  const labelInGap = new Array<boolean>(layout.rows + 1).fill(false);
  for (let g = 0; g <= layout.rows; g++) {
    const inGap = segs.filter((s) => s.gap === g).sort((a, b) => a.prio - b.prio || a.x0 - b.x0 || a.wire - b.wire);
    const lanes: HSeg[][] = [];
    for (const s of inGap) {
      let lane = lanes.findIndex((l) => l.every((o) => s.x1 + 6 < o.x0 || o.x1 + 6 < s.x0));
      if (lane < 0) {
        lane = lanes.length;
        lanes.push([]);
      }
      lanes[lane]!.push(s);
      s.lane = lane;
    }
    lanesInGap[g] = lanes.length;
  }
  layout.wires.forEach((w, i) => {
    if (wireLabel.has(i)) labelInGap[gapOf(w.points[w.points.length - 1]!.row - 0.5)] = true;
  });

  // ---- row y ----
  const rows = layout.rows;
  const above = new Array<number>(rows).fill(4);
  const below = new Array<number>(rows).fill(4);
  const need = (r: number, a: number, b: number): void => {
    above[r] = Math.max(above[r]!, a);
    below[r] = Math.max(below[r]!, b);
  };
  for (const nd of layout.nodes.values()) {
    const ext = nd.kind === "step" ? stepPlans.get(nd.id)!.ext : transPlans.get(nd.id)!.ext;
    need(nd.row, ext.above, ext.below);
  }
  for (const b of layout.bars.values()) {
    const d = branchById.get(b.id)!.type === "simultaneous" ? M.barDouble + 1 : 1;
    need(b.row, d, d);
  }
  // A jog's horizontal gets some room above it, so its drop does not read as the
  // continuation of a line ending just above it in the same column.
  for (const w of layout.wires) if (w.kind === "jog") need(w.points[1]!.row, 12, 1);
  const gapH: number[] = [];
  for (let g = 0; g <= rows; g++) {
    const lanes = lanesInGap[g]!;
    const outer = g === 0 || g === rows;
    const laneNeed = lanes > 0 ? 2 * M.lanePad + (lanes - 1) * M.laneSp : 0;
    gapH.push(Math.max(outer ? 0 : M.gapBase, laneNeed) + (labelInGap[g] ? M.labelH : 0));
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
    barId !== undefined && branchById.get(barId)?.type === "simultaneous" ? M.barDouble : 0;
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

  // ---- drawing ----
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

  // Lines first (under the boxes and bars).
  const lines: string[] = [];
  for (const v of vlinks) {
    const x0 = colX[v.from.col]! + v.from.dx;
    const x1 = colX[v.to.col]! + v.to.dx;
    const y0 = bottomOf(v.from);
    const y1 = topOf(v.to);
    let d: string;
    if (x0 === x1) d = `M${n(x0)} ${n(y0)}V${n(y1)}`;
    else {
      const ym = Math.round((y0 + y1) / 2);
      d = `M${n(x0)} ${n(y0)}V${n(ym)}H${n(x1)}V${n(y1)}`;
    }
    extend(x0, y0, x1, y1);
    lines.push(`<path class="qsfc-wire qsfc-link" data-id="${escapeXml(v.id)}" d="${d}"/>`);
  }
  layout.wires.forEach((w, i) => {
    const xs = wireXs[i]!;
    const ys = w.points.map((p, k) => {
      if (!Number.isInteger(p.row)) {
        const seg = segs.find((s) => s.wire === i && (s.at === k || s.at === k - 1));
        return seg ? laneY(seg.gap, seg.lane) : laneY(gapOf(p.row), 0);
      }
      return rowY[p.row]!;
    });
    // Snap the ends to the source / target element edges.
    const first = w.points[0]!;
    const last = w.points[w.points.length - 1]!;
    const fromEnd: GridEnd = layout.bars.has(w.from)
      ? { row: first.row, col: first.col, dx: 0, kind: "bar", bar: w.from }
      : { row: first.row, col: first.col, dx: 0, kind: layout.nodes.get(w.from)?.kind ?? "transition" };
    ys[0] = bottomOf(fromEnd);
    const toEnd: GridEnd = layout.nodes.has(w.to)
      ? { row: last.row, col: last.col, dx: 0, kind: layout.nodes.get(w.to)!.kind }
      : { row: last.row, col: last.col, dx: 0, kind: "bar", bar: layout.legs.get(w.to)?.branch };
    const endY = topOf(toEnd);
    ys[ys.length - 1] = endY;
    const arrow = arrowWire(w);
    let pts: Array<[number, number]> = xs.map((x, k) => [x, ys[k]!]);
    if (loopUp.has(i)) {
      const bar = layout.bars.get(w.from)!;
      pts = [[xs[2]!, rowY[bar.row]! - barHalf(bar.id)], ...pts.slice(3)];
    }
    // Drop repeated points.
    const clean = pts.filter((p, k) => k === 0 || p[0] !== pts[k - 1]![0] || p[1] !== pts[k - 1]![1]);
    const tip = clean[clean.length - 1]!;
    if (arrow) clean[clean.length - 1] = [tip[0], tip[1] - M.arrowL + 1];
    const d = clean.map((p, k) => `${k === 0 ? "M" : "L"}${n(p[0])} ${n(p[1])}`).join("");
    for (const p of pts) extend(p[0], p[1], p[0], p[1]);
    const parts = [`<path class="qsfc-wire-line" d="${d}"/>`];
    if (arrow) {
      parts.push(
        `<path class="qsfc-arrow" d="M${n(tip[0])} ${n(tip[1])}L${n(tip[0] - M.arrowW)} ${n(tip[1] - M.arrowL)}L${n(tip[0] + M.arrowW)} ${n(tip[1] - M.arrowL)}Z"/>`,
      );
    }
    const label = wireLabel.get(i);
    if (label) {
      const target = wireTarget(w)!;
      const lx = tip[0] + labelDx;
      const ly = endY - 4;
      parts.push(textEl("qsfc-jump-label", lx, ly, label, labelOf(target)));
      extend(lx, ly - M.labelSize, lx + sansWidth(label.text, M.labelSize), ly);
    }
    const title = wireTarget(w) ? `<title>${escapeXml(`${w.kind} to ${wireTarget(w)!.name}`)}</title>` : "";
    lines.push(
      `<g class="qsfc-wire qsfc-${w.kind}" data-id="${escapeXml(`${w.from}-${w.to}`)}">${title}${parts.join("")}</g>`,
    );
  });
  out.push(`<g class="qsfc-wires">${lines.join("")}</g>`);

  // Bars.
  const bars: string[] = [];
  for (const g of graph.branches) {
    const b = layout.bars.get(g.id);
    if (!b) continue;
    const y = rowY[b.row]!;
    const [xa, xb] = barRange(b);
    const type = g.type === "simultaneous" ? "simultaneous" : "selection";
    const cls = `qsfc-branch qsfc-${type} qsfc-${g.flow}${g.node ? "" : " qsfc-auto"}`;
    let d: string;
    if (type === "simultaneous") {
      d = `M${n(xa)} ${n(y - M.barDouble)}H${n(xb)}M${n(xa)} ${n(y + M.barDouble)}H${n(xb)}`;
    } else d = `M${n(xa)} ${n(y)}H${n(xb)}`;
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
    if (plan.name && look === "studio") {
      const bx1 = x - half - 10;
      const bx0 = bx1 - plan.nameW;
      parts.push(`<path class="qsfc-tname-link" d="M${n(bx1)} ${n(y)}H${n(x - half)}"/>`);
      parts.push(`<rect class="qsfc-tname-box" x="${n(bx0)}" y="${n(y - 8.5)}" width="${n(plan.nameW)}" height="17" rx="2"/>`);
      parts.push(textEl("qsfc-tname", (bx0 + bx1) / 2, y + 3.6, plan.name, t.name, "middle"));
      extend(bx0, y - 8.5, bx1, y + 8.5);
    } else if (plan.name) {
      const tx = x - half - 8;
      parts.push(textEl("qsfc-tname", tx, y + 3.8, plan.name, `(${t.name})`, "end"));
      extend(tx - plan.nameW, y - 8, tx, y + 8);
    }
    const cx = x + half + M.transTextGap;
    parts.push(textEl("qsfc-code qsfc-cond", cx, y + 3.8, plan.cond, t.condition));
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
    parts.push(`<title>${escapeXml(`${tipParts.join(" — ")} (${operand("Step", s.index)})`)}</title>`);
    parts.push(`<rect class="qsfc-step-box" x="${n(x0)}" y="${n(y0)}" width="${n(plan.w)}" height="${n(plan.h)}"/>`);
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
      if (s.presetMs > 0) {
        parts.push(textEl("qsfc-caption", sx, y + 11, { text: formatDuration(s.presetMs), truncated: false }, "", "end"));
      }
    }
    extend(x - plan.ext.left, y0, x + plan.w / 2, y0 + plan.h);
    if (plan.action) parts.push(drawAction(plan, x, y0, look, M, extend));
    steps.push(`<g class="qsfc-step${s.initial ? " qsfc-initial" : ""}" data-id="${escapeXml(s.id)}">${parts.join("")}</g>`);
  }
  out.push(`<g class="qsfc-steps">${steps.join("")}</g>`);

  // ---- frame ----
  const vx = Math.floor(minX - M.margin);
  const vy = Math.floor(minY - M.margin);
  const vw = Math.ceil(maxX + M.margin) - vx;
  const vh = Math.ceil(maxY + M.margin) - vy;
  const cls = `qsfc qsfc-look-${look}${numbers ? " qsfc-numbers" : ""}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}" role="img">\n` +
    `<style>${css(look)}</style>\n` +
    `<rect class="qsfc-bg" x="${vx}" y="${vy}" width="${vw}" height="${vh}"/>\n` +
    `${out.join("\n")}\n</svg>\n`
  );
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
  const parts: string[] = [];
  const linkY = look === "studio" ? y0 + Math.min(plan.h / 2, M.actionHeader / 2 + 0.5) : y0 + plan.h / 2;
  const link = `<path class="qsfc-action-link" d="M${n(x + plan.w / 2)} ${n(linkY)}H${n(ax)}"/>`;
  parts.push(`<title>${escapeXml(a.full)}</title>`);
  parts.push(`<rect class="qsfc-action-box" x="${n(ax)}" y="${n(y0)}" width="${n(a.w)}" height="${n(a.h)}"/>`);
  let textX: number;
  let textY: number;
  if (look === "studio") {
    const hh = M.actionHeader;
    parts.push(`<rect class="qsfc-action-head" x="${n(ax)}" y="${n(y0)}" width="${n(a.w)}" height="${n(hh)}"/>`);
    parts.push(`<path class="qsfc-action-sep" d="M${n(ax)} ${n(y0 + hh)}H${n(ax + a.w)}M${n(ax + M.actionCellW)} ${n(y0)}V${n(y0 + hh)}"/>`);
    parts.push(`<text class="qsfc-qualifier" x="${n(ax + M.actionCellW / 2)}" y="${n(y0 + 12)}" text-anchor="middle">N</text>`);
    parts.push(`<text class="qsfc-action-name" x="${n(ax + M.actionCellW + 7)}" y="${n(y0 + 12)}">${escapeXml(a.operand)}</text>`);
    textX = ax + M.actionPad;
    textY = y0 + hh + M.actionPad + 7;
  } else {
    parts.push(`<path class="qsfc-action-sep" d="M${n(ax + M.actionCellW)} ${n(y0)}V${n(y0 + a.h)}"/>`);
    parts.push(
      `<text class="qsfc-qualifier" x="${n(ax + M.actionCellW / 2)}" y="${n(y0 + a.h / 2 + 4)}" text-anchor="middle">N</text>`,
    );
    const rows = a.lines.length + (a.more ? 1 : 0);
    textX = ax + M.actionCellW + M.actionPad;
    textY = y0 + (a.h - rows * M.lineH) / 2 + M.lineH - 4;
  }
  a.lines.forEach((l, k) => {
    parts.push(textEl("qsfc-code", textX, textY + k * M.lineH, l, plan.step.action[k] ?? ""));
  });
  if (a.more) parts.push(`<text class="qsfc-code qsfc-more" x="${n(textX)}" y="${n(textY + a.lines.length * M.lineH)}">…</text>`);
  extend(x + plan.w / 2, y0, ax + a.w, y0 + a.h);
  return `${link}<g class="qsfc-action">${parts.join("")}</g>`;
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
    `${L} .qsfc-jump-label{font-size:${TEXTBOOK.labelSize}px;font-style:italic;fill:var(--qsfc-label)}`,
  ];
  return rules.join("");
}
