/**
 * Studio-coordinate sketch of one SFC routine of an L5X (Tidy dialog, Phase 4a): the boxes
 * where Studio 5000 places them (X / Y of Step, Transition, Stop, Branch), wires as plain
 * elbows, hidden wires (Show="false") dashed. Not the qSFC diagram: Before and After are drawn
 * the same simple way, so the comparison is fair.
 *
 * Pure, never throws (an unreadable routine gives a small "can't draw" SVG). Themable: the
 * colors are CSS variables of the app (--surface, --text, --syn-def) with light fallbacks, set
 * in a <style> inside the SVG, so the same string works in the app (light and dark) and in a
 * standalone page.
 */
import { childElements, descendants, parseXml, textOf, type XmlElement } from "../l5x/xml.js";

const SCALE = 0.5;

const STYLE =
  "<style>" +
  ".sk-wire{fill:none;stroke:color-mix(in srgb,var(--text,#1d2228) 50%,var(--surface,#fff));stroke-width:1}" +
  ".sk-wire.sk-hidden{stroke:color-mix(in srgb,var(--text,#1d2228) 28%,var(--surface,#fff))}" +
  ".sk-branch{fill:none;stroke:var(--text,#1d2228)}" +
  ".sk-step,.sk-stop{fill:var(--surface,#fff);stroke:var(--text,#1d2228)}" +
  ".sk-trans{fill:var(--text,#1d2228)}" +
  ".sk-label{fill:var(--text,#1d2228);font-size:7px}" +
  ".sk-cond{fill:var(--syn-def,#953800);font-size:6.5px}" +
  ".sk-msg{fill:var(--muted,#59626e);font-size:12px}" +
  "</style>";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function message(text: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="studio-sketch" viewBox="0 0 320 40" width="320" height="40" font-family="system-ui,sans-serif" role="img" aria-label="${esc(text)}">${STYLE}<text class="sk-msg" x="8" y="24">${esc(text)}</text></svg>`;
}

/** The `<Routine Type="SFC">` named `name` or `Program/name` (case-insensitive), as Tidy names them. */
function findRoutine(root: XmlElement, name: string): XmlElement | undefined {
  const want = name.toLowerCase();
  const all = (tag: string): XmlElement[] => (root.name === tag ? [root] : descendants(root, tag));
  for (const p of all("Program")) {
    for (const r of descendants(p, "Routine")) {
      if (r.attrs["Type"] !== "SFC") continue;
      const n = (r.attrs["Name"] ?? "").toLowerCase();
      if (`${(p.attrs["Name"] ?? "").toLowerCase()}/${n}` === want) return r;
    }
  }
  return all("Routine").find((r) => r.attrs["Type"] === "SFC" && (r.attrs["Name"] ?? "").toLowerCase() === want);
}

interface Node {
  kind: "Step" | "Transition" | "Stop";
  x: number;
  y: number;
  label: string;
  title: string;
}

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** SVG of the routine `routineName` of the L5X text `xml`, from its Studio coordinates. */
export function renderStudioSketch(xml: string, routineName: string): string {
  try {
    return draw(xml, routineName);
  } catch (e) {
    return message(`Can't draw ${routineName}: ${(e as Error).message}`);
  }
}

function draw(xml: string, routineName: string): string {
  const routine = findRoutine(parseXml(xml), routineName);
  if (!routine) return message(`No SFC routine ${routineName} in this file`);
  const sfc = descendants(routine, "SFCContent")[0];
  if (!sfc) return message(`${routineName} has no SFC content`);

  const nodes = new Map<string, Node>();
  const branches = new Map<string, { y: number; type: string; legs: string[] }>();
  const legOf = new Map<string, string>();
  for (const el of childElements(sfc)) {
    const id = el.attrs["ID"];
    if (id === undefined) continue;
    if (el.name === "Step" || el.name === "Stop") {
      const op = el.attrs["Operand"] ?? el.name;
      const short = op.replace(/^Step_/, "S");
      nodes.set(id, { kind: el.name, x: num(el.attrs["X"]), y: num(el.attrs["Y"]), label: short.length > 9 ? `${short.slice(0, 8)}…` : short, title: op });
    } else if (el.name === "Transition") {
      const line = descendants(el, "Line")[0];
      const cond = (line ? textOf(line) : "").trim();
      nodes.set(id, { kind: "Transition", x: num(el.attrs["X"]), y: num(el.attrs["Y"]), label: cond.slice(0, 22), title: `${el.attrs["Operand"] ?? ""} ${cond}`.trim() });
    } else if (el.name === "Branch") {
      const legs = childElements(el, "Leg").map((l) => l.attrs["ID"] ?? "").filter((l) => l !== "");
      branches.set(id, { y: num(el.attrs["Y"]), type: el.attrs["BranchType"] ?? "", legs });
      for (const leg of legs) legOf.set(leg, id);
    }
  }
  const boxes = [...nodes.values()];
  if (!boxes.length) return message(`${routineName} has no steps`);

  const links = descendants(sfc, "DirectedLink").map((l) => ({ from: l.attrs["FromID"] ?? "", to: l.attrs["ToID"] ?? "", show: l.attrs["Show"] !== "false" }));

  // A leg's x is the x of the element on the other side of its link (or of another leg's, for
  // a leg wired straight to a leg of a nested branch: a few passes resolve those).
  const legX = new Map<string, number>();
  for (let pass = 0; pass < 4; pass++) {
    for (const { from, to } of links) {
      for (const [leg, other] of [
        [from, to],
        [to, from],
      ] as const) {
        if (!legOf.has(leg) || legX.has(leg)) continue;
        const x = nodes.get(other)?.x ?? legX.get(other);
        if (x !== undefined) legX.set(leg, x);
      }
    }
  }
  const legXs = (br: { legs: string[] }): number[] => br.legs.map((l) => legX.get(l)).filter((x): x is number => x !== undefined);
  const pt = (id: string): { x: number; y: number } | undefined => {
    const n = nodes.get(id);
    if (n) return { x: n.x, y: n.y };
    const brId = legOf.get(id);
    if (brId !== undefined) {
      const br = branches.get(brId)!;
      const x = legX.get(id) ?? legXs(br)[0];
      return x === undefined ? undefined : { x, y: br.y };
    }
    const br = branches.get(id);
    const x = br && legXs(br)[0];
    return br && x !== undefined ? { x, y: br.y } : undefined;
  };

  const xs = boxes.map((n) => n.x);
  const ys = [...boxes.map((n) => n.y), ...[...branches.values()].map((b) => b.y)];
  const minX = Math.min(...xs) - 80;
  const maxX = Math.max(...xs) + 260;
  const minY = Math.min(...ys) - 60;
  const maxY = Math.max(...boxes.map((n) => n.y)) + 80;
  const X = (v: number): string => ((v - minX) * SCALE).toFixed(1);
  const Y = (v: number): string => ((v - minY) * SCALE).toFixed(1);

  const out: string[] = [];
  for (const { from, to, show } of links) {
    const p = pt(from);
    const q = pt(to);
    if (!p || !q) continue;
    const mid = (p.y + q.y) / 2;
    const d =
      q.y >= p.y
        ? `M${X(p.x)} ${Y(p.y)} V${Y(mid)} H${X(q.x)} V${Y(q.y)}`
        : `M${X(p.x)} ${Y(p.y)} V${Y(p.y + 30)} H${X(minX + 30)} V${Y(q.y - 30)} H${X(q.x)} V${Y(q.y)}`;
    out.push(show ? `<path class="sk-wire" d="${d}"/>` : `<path class="sk-wire sk-hidden" d="${d}" stroke-dasharray="3 3"/>`);
  }
  for (const br of branches.values()) {
    const lx = legXs(br);
    if (!lx.length) continue;
    out.push(`<path class="sk-branch" d="M${X(Math.min(...lx) - 10)} ${Y(br.y)} H${X(Math.max(...lx) + 10)}" stroke-width="${br.type === "Simultaneous" ? 3 : 1.5}"/>`);
  }
  for (const n of boxes) {
    const title = `<title>${esc(n.title)}</title>`;
    if (n.kind === "Step") {
      out.push(
        `<g><rect class="sk-step" x="${X(n.x - 30)}" y="${Y(n.y - 20)}" width="${60 * SCALE}" height="${40 * SCALE}"/>`,
        `<text class="sk-label" x="${X(n.x)}" y="${Y(n.y + 4)}" text-anchor="middle">${esc(n.label)}</text>${title}</g>`,
      );
    } else if (n.kind === "Stop") {
      out.push(
        `<g><rect class="sk-stop" x="${X(n.x - 24)}" y="${Y(n.y - 12)}" width="${48 * SCALE}" height="${24 * SCALE}" rx="6"/>`,
        `<text class="sk-label" x="${X(n.x)}" y="${Y(n.y + 4)}" text-anchor="middle">Stop</text>${title}</g>`,
      );
    } else {
      out.push(
        `<g><rect class="sk-trans" x="${X(n.x - 12)}" y="${Y(n.y - 2)}" width="${24 * SCALE}" height="2"/>`,
        `<text class="sk-cond" x="${X(n.x + 18)}" y="${Y(n.y + 6)}">${esc(n.label)}</text>${title}</g>`,
      );
    }
  }
  const w = ((maxX - minX) * SCALE).toFixed(0);
  const h = ((maxY - minY) * SCALE).toFixed(0);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="studio-sketch" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="system-ui,sans-serif" role="img" aria-label="${esc(routineName)}, drawn from its Studio coordinates">${STYLE}${out.join("")}</svg>`;
}
