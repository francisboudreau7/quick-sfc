/**
 * Geometry checker for rendered SVG diagrams: reads the lines (links, jump wires, jogs,
 * cross-reference arrows, branch bars, action / name links) and the elements (step,
 * action, transition and name boxes, condition and label texts) back from the SVG text,
 * and lists every wire-wire crossing and every line running through an element.
 */
import { descendants, parseXml, type XmlElement } from "../../src/l5x/xml.js";
import { segmentHitsBox, segmentsCross, type Box, type Seg } from "../../src/render/route.js";
import { monoWidth, sansWidth } from "../../src/render/svg.js";

export interface Geometry {
  lines: Seg[];
  boxes: Box[];
  /** Jump wires drawn all the way: data-id -> their line segments. */
  jumps: Map<string, Seg[]>;
}

const classes = (e: XmlElement): string[] => (e.attrs["class"] ?? "").split(" ");

/** Points of an "M x y L x y H x V y" path; one list per subpath. */
export function pathPoints(d: string): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  let x = 0;
  let y = 0;
  for (const m of d.matchAll(/([MLHVZ])([^MLHVZ]*)/g)) {
    const nums = m[2]!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    switch (m[1]) {
      case "M":
        if (cur.length > 0) out.push(cur);
        [x, y] = [nums[0]!, nums[1]!];
        cur = [[x, y]];
        break;
      case "L":
        [x, y] = [nums[0]!, nums[1]!];
        cur.push([x, y]);
        break;
      case "H":
        x = nums[0]!;
        cur.push([x, y]);
        break;
      case "V":
        y = nums[0]!;
        cur.push([x, y]);
        break;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function ownText(e: XmlElement): string {
  return e.children.filter((c): c is string => typeof c === "string").join("");
}

export function readGeometry(svg: string): Geometry {
  const root = parseXml(svg);
  const lines: Seg[] = [];
  const boxes: Box[] = [];
  const jumps = new Map<string, Seg[]>();
  const visit = (e: XmlElement, owner: string): void => {
    const id = e.attrs["data-id"] ?? owner;
    const cls = classes(e);
    if (e.name === "path") {
      let lineOwner: string | undefined;
      if (cls.includes("qsfc-link") || cls.includes("qsfc-wire-line") || cls.includes("qsfc-bar")) lineOwner = id;
      else if (cls.includes("qsfc-action-link") || cls.includes("qsfc-tname-link")) lineOwner = `${id}/link`;
      if (lineOwner !== undefined) {
        for (const pts of pathPoints(e.attrs["d"]!)) {
          for (let k = 0; k + 1 < pts.length; k++) {
            lines.push({ x0: pts[k]![0], y0: pts[k]![1], x1: pts[k + 1]![0], y1: pts[k + 1]![1], owner: lineOwner });
          }
        }
      }
    } else if (e.name === "rect" && ["qsfc-step-box", "qsfc-action-box", "qsfc-trans-bar", "qsfc-tname-box"].some((c) => cls.includes(c))) {
      const x = Number(e.attrs["x"]);
      const y = Number(e.attrs["y"]);
      boxes.push({ x0: x, y0: y, x1: x + Number(e.attrs["width"]), y1: y + Number(e.attrs["height"]), owner: id });
    } else if (e.name === "text" && ["qsfc-cond", "qsfc-tname", "qsfc-side-name", "qsfc-jump-label", "qsfc-xref-from"].some((c) => cls.includes(c))) {
      const text = ownText(e);
      const mono = cls.includes("qsfc-code");
      const size = mono ? 11 : 10.5;
      const w = mono ? monoWidth(text, size) : sansWidth(text, size);
      const x = Number(e.attrs["x"]);
      const y = Number(e.attrs["y"]);
      const anchor = e.attrs["text-anchor"];
      const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
      boxes.push({ x0, y0: y - size * 0.75, x1: x0 + w, y1: y + size * 0.22, owner: id });
    }
    for (const c of e.children) if (typeof c !== "string") visit(c, id);
  };
  visit(root, "");
  for (const g of descendants(root, "g")) {
    const cls = classes(g);
    if (!cls.includes("qsfc-jump") && !cls.includes("qsfc-jump-join")) continue;
    const id = g.attrs["data-id"]!;
    jumps.set(id, lines.filter((s) => s.owner === id));
  }
  return { lines, boxes, jumps };
}

/** Every crossing of two lines of different owners, and every line through an element. */
export function crossings(svg: string): string[] {
  const { lines, boxes } = readGeometry(svg);
  const out: string[] = [];
  const fmt = (s: Seg): string => `${s.owner} (${s.x0},${s.y0})-(${s.x1},${s.y1})`;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i]!;
      const b = lines[j]!;
      if (a.owner !== b.owner && segmentsCross(a, b)) out.push(`line ${fmt(a)} crosses ${fmt(b)}`);
    }
    for (const b of boxes) {
      if (segmentHitsBox(lines[i]!, b)) out.push(`line ${fmt(lines[i]!)} runs through ${b.owner} [${b.x0},${b.y0},${b.x1},${b.y1}]`);
    }
  }
  return out;
}
