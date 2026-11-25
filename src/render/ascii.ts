/**
 * ASCII view (SPEC §12), drawn from the grid Layout.
 *
 * - Step: box (double box for the initial step) with the name and the preset;
 *   its action sits to the right as `─[ first line … ]`.
 * - Transition: `┼` on the vertical line, condition to the right (`name: condition`
 *   for explicit names; auto names T1.. are not shown).
 * - Selection divergence / convergence: single horizontal line; parallel: double line.
 * - Jumps are labels, not routed wires: `→ target` under the jumping transition
 *   (`→ target (T3)` when the transition has an auto name), and `◄ from a, b` on the
 *   top of every step reached by jumps. Automatic convergence bars are not drawn.
 *
 * Column positions adapt to the text: each column's line is placed as far left as
 * the text of the columns on its left allows, row by row (a long condition only
 * pushes the columns that have something in the same rows). Column groups (chains)
 * never share horizontal space. Channel columns of the layout take no room.
 */
import type { GBranch, Graph, GraphId, GStep, GTransition } from "../model/graph.js";
import { key } from "../model/ast.js";
import type { Layout } from "../layout/index.js";

/** Spaces between the text of a column and the next column's content. */
const GAP = 3;
/** Spaces between two column groups. */
const GROUP_GAP = 6;
/** Minimum distance between the lines of two neighbour columns. */
const MIN_SEP = 6;
const MAX_ACTION = 40;
const MIN_INNER = 5;

const U = 1;
const D = 2;
const L = 4;
const R = 8;
const DBL = 16;

const LIGHT: Record<number, string> = {
  [U | D | L | R]: "┼",
  [U | D | R]: "├",
  [U | D | L]: "┤",
  [D | L | R]: "┬",
  [U | L | R]: "┴",
  [D | R]: "┌",
  [D | L]: "┐",
  [U | R]: "└",
  [U | L]: "┘",
  [L | R]: "─",
  [L]: "─",
  [R]: "─",
  [U | D]: "│",
  [U]: "│",
  [D]: "│",
};
const DOUBLE: Record<number, string> = {
  ...LIGHT,
  [U | D | L | R]: "╪",
  [U | D | R]: "╞",
  [U | D | L]: "╡",
  [D | L | R]: "╤",
  [U | L | R]: "╧",
  [D | R]: "╒",
  [D | L]: "╕",
  [U | R]: "╘",
  [U | L]: "╛",
  [L | R]: "═",
  [L]: "═",
  [R]: "═",
};

/** 90000 -> "1m30s", 500 -> "500ms". */
export function formatDuration(ms: number): string {
  const parts: string[] = [];
  let rest = ms;
  for (const [unit, size] of [["h", 3_600_000], ["m", 60_000], ["s", 1000]] as const) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)}${unit}`);
      rest %= size;
    }
  }
  if (rest > 0 || parts.length === 0) parts.push(`${rest}ms`);
  return parts.join("");
}

const stepLabel = (s: GStep): string => (s.presetMs > 0 ? `${s.name}  ${formatDuration(s.presetMs)}` : s.name);

function actionText(s: GStep): string | undefined {
  const first = s.action[0];
  if (first === undefined) return undefined;
  let text = first.trim();
  if (text.length > MAX_ACTION) text = `${text.slice(0, MAX_ACTION - 1)}…`;
  else if (s.action.length > 1) text = `${text} …`;
  return `─[ ${text} ]`;
}

const transText = (t: GTransition): string => (t.auto ? t.condition : `${t.name}: ${t.condition}`);

/** End of a drawn vertical link: a node, or a point of a bar. */
type End = { node: GraphId } | { bar: GraphId; col: number };

interface VLink {
  from: End;
  to: End;
  /** Jog: goes down to this row, then horizontally to the target column. */
  jogRow?: number;
}

export function renderAscii(graph: Graph, layout: Layout): string {
  const stepById = new Map(graph.steps.map((s) => [s.id, s]));
  const transById = new Map(graph.transitions.map((t) => [t.id, t]));
  const branchById = new Map<GraphId, GBranch>(graph.branches.map((b) => [b.id, b]));
  const stepByKey = new Map(graph.steps.map((s) => [key(s.name), s]));

  // ---- labels for jumps ----
  const jumpLabel = new Map<GraphId, string>();
  const fromNames = new Map<GraphId, string[]>();
  for (const t of graph.transitions) {
    const j = t.node.jump;
    if (!j) continue;
    const target = stepByKey.get(key(j.text));
    const name = target?.name ?? j.text;
    jumpLabel.set(t.id, t.auto ? `→ ${name} (${t.name})` : `→ ${name}`);
    if (target) fromNames.set(target.id, [...(fromNames.get(target.id) ?? []), t.name]);
  }
  const fromLabel = new Map<GraphId, string>();
  for (const [id, names] of fromNames) fromLabel.set(id, `◄ from ${names.join(", ")}`);

  // ---- grid-level plan of the vertical links ----
  const drawnBar = (id: GraphId): boolean => layout.bars.get(id)?.placement === "structural";
  const jogFrom = new Map(layout.wires.filter((w) => w.kind === "jog").map((w) => [w.from, w]));
  const vlinks: VLink[] = [];
  for (const link of graph.links) {
    if (jumpLabel.has(link.from)) continue;
    let from: End;
    if (layout.nodes.has(link.from)) from = { node: link.from };
    else {
      const bar = layout.bars.get(link.from);
      if (bar) {
        if (!drawnBar(bar.id)) continue; // automatic convergence: shown by the "◄ from" label
        from = { bar: bar.id, col: bar.col };
      } else {
        const leg = layout.legs.get(link.from)!;
        from = { bar: leg.branch, col: leg.col };
      }
    }
    let to: End;
    if (layout.nodes.has(link.to)) to = { node: link.to };
    else {
      const bar = layout.bars.get(link.to);
      if (bar) to = { bar: bar.id, col: bar.col };
      else {
        const leg = layout.legs.get(link.to)!;
        // In-flow source of an automatic convergence: straight into its target.
        to = drawnBar(leg.branch) ? { bar: leg.branch, col: leg.col } : { node: branchById.get(leg.branch)!.target! };
      }
    }
    const jog = jogFrom.get(link.from);
    vlinks.push(jog ? { from, to, jogRow: jog.points[1]!.row } : { from, to });
  }
  const endRow = (e: End): number => ("node" in e ? layout.nodes.get(e.node)!.row : layout.bars.get(e.bar)!.row);
  const endCol = (e: End): number => ("node" in e ? layout.nodes.get(e.node)!.col : e.col);

  // ---- what each grid cell holds: text extent left / right of the column line ----
  const ncols = layout.columns.length;
  const boxW = new Array<number>(ncols).fill(0);
  for (const n of layout.nodes.values()) {
    if (n.kind !== "step") continue;
    let w = Math.max(stepLabel(stepById.get(n.id)!).length, MIN_INNER) + 4;
    if (w % 2 === 0) w++;
    boxW[n.col] = Math.max(boxW[n.col]!, w);
  }
  const half = (c: number): number => (boxW[c]! > 0 ? (boxW[c]! - 1) / 2 : 0);
  const cells = new Map<string, [number, number]>();
  const mark = (r: number, c: number, left: number, right: number): void => {
    const k = `${r},${c}`;
    const old = cells.get(k) ?? [0, 0];
    cells.set(k, [Math.max(old[0], left), Math.max(old[1], right)]);
  };
  for (const n of layout.nodes.values()) {
    if (n.kind === "step") {
      const s = stepById.get(n.id)!;
      let right = half(n.col);
      const a = actionText(s);
      if (a) right = Math.max(right, half(n.col) + a.length);
      const f = fromLabel.get(n.id);
      if (f) right = Math.max(right, half(n.col) + 1 + f.length);
      mark(n.row, n.col, half(n.col), right);
    } else {
      const t = transById.get(n.id)!;
      let right = 1 + transText(t).length;
      const j = jumpLabel.get(n.id);
      if (j) right = Math.max(right, j.length - 1);
      mark(n.row, n.col, 0, right);
    }
  }
  for (const b of layout.bars.values()) {
    if (!drawnBar(b.id)) continue;
    for (let c = b.col; c <= b.colEnd; c++) mark(b.row, c, 0, 0);
  }
  for (const v of vlinks) {
    const r0 = endRow(v.from);
    const r1 = endRow(v.to);
    const c0 = endCol(v.from);
    const c1 = endCol(v.to);
    if (v.jogRow !== undefined) {
      for (let r = r0 + 1; r < v.jogRow; r++) mark(r, c0, 0, 0);
      for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) mark(v.jogRow, c, 0, 0);
      for (let r = v.jogRow + 1; r < r1; r++) mark(r, c1, 0, 0);
    } else {
      for (let r = r0 + 1; r < r1; r++) mark(r, c0, 0, 0);
    }
  }

  // ---- column lines ----
  const lineX = new Array<number>(ncols).fill(0);
  const rightEdge = (r: number, c: number): number | undefined => {
    const cell = cells.get(`${r},${c}`);
    return cell ? lineX[c]! + cell[1] : undefined;
  };
  const placed: number[] = [];
  let groupRight = -GROUP_GAP - 1;
  let prev: number | undefined;
  let width = 1;
  layout.columns.forEach((col, c) => {
    if (col.kind !== "element") return;
    if (prev !== undefined && layout.columns[prev]!.group !== col.group) {
      for (const p of placed) {
        for (let r = 0; r < layout.rows; r++) groupRight = Math.max(groupRight, rightEdge(r, p) ?? -Infinity);
      }
    }
    const sameGroup = placed.filter((p) => layout.columns[p]!.group === col.group);
    let x = prev !== undefined && layout.columns[prev]!.group === col.group ? lineX[prev]! + MIN_SEP : 0;
    for (let r = 0; r < layout.rows; r++) {
      const cell = cells.get(`${r},${c}`);
      if (!cell) continue;
      x = Math.max(x, groupRight + 1 + GROUP_GAP + cell[0], cell[0]);
      for (const p of sameGroup) {
        const e = rightEdge(r, p);
        if (e !== undefined) x = Math.max(x, e + 1 + GAP + cell[0]);
      }
    }
    lineX[c] = x;
    placed.push(c);
    prev = c;
    for (let r = 0; r < layout.rows; r++) width = Math.max(width, (rightEdge(r, c) ?? 0) + 1);
  });

  // ---- rows -> bands of text lines ----
  // A band holds a row; its anchor line carries transitions, bars and the step names.
  const anchor = new Array<number>(layout.rows).fill(0);
  const height = new Array<number>(layout.rows).fill(0);
  for (const n of layout.nodes.values()) if (n.kind === "step") anchor[n.row] = 1;
  const need = (r: number, h: number): void => {
    height[r] = Math.max(height[r]!, h);
  };
  for (const n of layout.nodes.values()) {
    if (n.kind === "step") need(n.row, 3);
    else need(n.row, anchor[n.row]! + 1 + (jumpLabel.has(n.id) ? 1 : 0));
  }
  for (const b of layout.bars.values()) if (drawnBar(b.id)) need(b.row, anchor[b.row]! + 1);
  for (const v of vlinks) if (v.jogRow !== undefined) need(v.jogRow, anchor[v.jogRow]! + 1);
  const bandY: number[] = [];
  let totalH = 0;
  for (let r = 0; r < layout.rows; r++) {
    bandY.push(totalH);
    totalH += height[r]!;
  }
  const rowY = (r: number): number => bandY[r]! + anchor[r]!;

  // ---- line layer: connection flags per character cell ----
  const flags = new Uint8Array(width * totalH);
  const at = (cx: number, cy: number): number => cy * width + cx;
  const segment = (x0: number, y0: number, x1: number, y1: number, dbl = false): void => {
    if (x0 === x1) {
      const [a, b] = y0 < y1 ? [y0, y1] : [y1, y0];
      for (let k = a; k < b; k++) {
        flags[at(x0, k)]! |= D;
        flags[at(x0, k + 1)]! |= U;
      }
    } else {
      const [a, b] = x0 < x1 ? [x0, x1] : [x1, x0];
      const extra = dbl ? DBL : 0;
      for (let k = a; k < b; k++) {
        flags[at(k, y0)]! |= R | extra;
        flags[at(k + 1, y0)]! |= L | extra;
      }
    }
  };
  /** Canvas x, and the y where a line arrives from above / leaves downward. */
  const point = (e: End): { x: number; top: number; bottom: number } => {
    if ("node" in e) {
      const n = layout.nodes.get(e.node)!;
      const yy = rowY(n.row);
      return n.kind === "step"
        ? { x: lineX[n.col]!, top: yy - 1, bottom: yy + 1 }
        : { x: lineX[n.col]!, top: yy, bottom: yy };
    }
    const yy = rowY(layout.bars.get(e.bar)!.row);
    return { x: lineX[e.col]!, top: yy, bottom: yy };
  };
  for (const b of layout.bars.values()) {
    if (!drawnBar(b.id)) continue;
    const yy = rowY(b.row);
    segment(lineX[b.col]!, yy, lineX[b.colEnd]!, yy, branchById.get(b.id)!.type === "simultaneous");
  }
  for (const v of vlinks) {
    const from = point(v.from);
    const to = point(v.to);
    if (v.jogRow !== undefined) {
      const jy = rowY(v.jogRow);
      segment(from.x, from.bottom, from.x, jy);
      segment(from.x, jy, to.x, jy);
      segment(to.x, jy, to.x, to.top);
    } else {
      segment(from.x, from.bottom, to.x, to.top);
    }
  }

  // ---- canvas ----
  const canvas: string[][] = Array.from({ length: totalH }, () => new Array<string>(width).fill(" "));
  for (let cy = 0; cy < totalH; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const f = flags[at(cx, cy)]!;
      if (f === 0) continue;
      canvas[cy]![cx] = (f & DBL ? DOUBLE : LIGHT)[f & (U | D | L | R)]!;
    }
  }
  const put = (cx: number, cy: number, text: string): void => {
    const row = canvas[cy]!;
    [...text].forEach((ch, k) => {
      row[cx + k] = ch;
    });
  };

  for (const n of layout.nodes.values()) {
    const lx = lineX[n.col]!;
    const yy = rowY(n.row);
    if (n.kind === "transition") {
      put(lx, yy, `┼ ${transText(transById.get(n.id)!)}`);
      const j = jumpLabel.get(n.id);
      if (j) put(lx, yy + 1, j);
      continue;
    }
    const s = stepById.get(n.id)!;
    const w = boxW[n.col]!;
    const left = lx - half(n.col);
    const [h, v, tl, tr, bl, br, up, down] = s.initial
      ? ["═", "║", "╔", "╗", "╚", "╝", "╧", "╤"]
      : ["─", "│", "┌", "┐", "└", "┘", "┴", "┬"];
    const border = (l: string, r: string, junction: string | undefined): string => {
      const chars = [l, ...new Array<string>(w - 2).fill(h), r];
      if (junction) chars[lx - left] = junction;
      return chars.join("");
    };
    const top = yy - 1;
    const bottom = yy + 1;
    put(left, top, border(tl, tr, flags[at(lx, top)]! & U ? up : undefined));
    const label = stepLabel(s);
    const inner = w - 2;
    const padL = Math.floor((inner - label.length) / 2);
    put(left, yy, `${v}${" ".repeat(padL)}${label}${" ".repeat(inner - padL - label.length)}${v}`);
    put(left, bottom, border(bl, br, flags[at(lx, bottom)]! & D ? down : undefined));
    const a = actionText(s);
    if (a) put(left + w, yy, a);
    const f = fromLabel.get(n.id);
    if (f) put(left + w + 1, top, f);
  }

  const lines = canvas.map((row) => row.join("").replace(/\s+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}
