import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { descendants, parseXml, textOf, type XmlElement } from "../../src/l5x/xml.js";
import { planRoutes, segmentHitsBox, segmentsCross } from "../../src/render/route.js";
import { renderSvg, type SvgOptions } from "../../src/render/svg.js";
import { build, syntheticCharts, validCharts } from "../layout/helpers.js";
import { crossings, readGeometry } from "./geometry.js";

const mockup = (path: string): string => readFileSync(new URL(`../../docs/mockups/${path}`, import.meta.url), "utf8");
const tankSource = mockup("jumps/tank.qsfc");
const charts = [
  ...validCharts(),
  ...syntheticCharts,
  { name: "mockups/demo", source: mockup("demo.qsfc") },
  { name: "mockups/tank", source: tankSource },
];
const variants: Array<{ label: string; options: SvgOptions }> = [
  { label: "studio", options: { look: "studio" } },
  { label: "textbook", options: { look: "textbook" } },
  { label: "textbook numbers", options: { look: "textbook", numbering: "numbers" } },
];

const count = (text: string, needle: string): number => text.split(needle).length - 1;
/** The drawing without its style sheet. */
const body = (svg: string): string => svg.replace(/<style>[^]*<\/style>/, "");
const hasClass = (e: XmlElement, cls: string): boolean => (e.attrs["class"] ?? "").split(" ").includes(cls);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  what: string;
}

function boxes(root: XmlElement): Box[] {
  return descendants(root, "rect")
    .filter((r) => /qsfc-(step-box|action-box)/.test(r.attrs["class"] ?? ""))
    .map((r) => ({
      x: Number(r.attrs["x"]),
      y: Number(r.attrs["y"]),
      w: Number(r.attrs["width"]),
      h: Number(r.attrs["height"]),
      what: r.attrs["class"]!,
    }));
}

describe.each(charts)("SVG view: $name", ({ name, source }) => {
  const { graph, layout } = build(source);

  describe.each(variants)("$label", ({ options }) => {
    const svg = renderSvg(graph, layout, options);
    const root = parseXml(svg);

    it("is well-formed SVG with a fitting viewBox", () => {
      expect(root.name).toBe("svg");
      expect(root.attrs["xmlns"]).toBe("http://www.w3.org/2000/svg");
      const [, , w, h] = root.attrs["viewBox"]!.split(" ").map(Number);
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
      expect(root.attrs["width"]).toBe(String(w));
      expect(root.attrs["height"]).toBe(String(h));
    });

    it("tags every step, transition and drawn branch once with its data-id", () => {
      for (const s of graph.steps) expect(count(svg, `data-id="${s.id}"`), s.id).toBe(1);
      for (const t of graph.transitions) expect(count(svg, `data-id="${t.id}"`), t.id).toBe(1);
      // Automatic convergences (no select block of their own) are not drawn: jumps join the line above the step.
      for (const b of graph.branches) expect(count(svg, `data-id="${b.id}"`), b.id).toBe(b.node ? 1 : 0);
      const steps = descendants(root, "g").filter((g) => hasClass(g, "qsfc-step"));
      expect(steps.map((g) => g.attrs["data-id"])).toEqual(graph.steps.map((s) => s.id));
      expect(count(svg, 'class="qsfc-step qsfc-initial"')).toBe(1);
    });

    it("draws every link and wire with a data-id", () => {
      const wires = descendants(root).filter((e) => hasClass(e, "qsfc-wire"));
      expect(wires.length).toBeGreaterThan(0);
      for (const w of wires) expect(w.attrs["data-id"]).toMatch(/^[a-z0-9.]+-[a-z0-9.]+$/);
      const routes = planRoutes(graph, layout);
      for (const l of routes.links) expect(count(svg, `data-id="${l.id}"`), l.id).toBe(1);
      for (const j of routes.jumps) expect(count(svg, `data-id="${j.id}"`), j.id).toBe(1);
      for (const w of layout.wires.filter((x) => x.kind === "jog")) expect(count(svg, `data-id="${w.from}-${w.to}"`)).toBe(1);
    });

    it("has no wire crossing another wire or running through an element", () => {
      expect(crossings(svg)).toEqual([]);
    });

    it("labels only cross-references, never a jump drawn all the way", () => {
      const xrefs = descendants(root, "g").filter((g) => hasClass(g, "qsfc-xref"));
      expect(count(svg, 'class="qsfc-jump-label"')).toBe(xrefs.length);
      for (const g of xrefs) expect(descendants(g, "text").length).toBe(1);
      const drawn = descendants(root, "g").filter((g) => hasClass(g, "qsfc-jump") || hasClass(g, "qsfc-jump-join"));
      expect(drawn.length + xrefs.length).toBe(planRoutes(graph, layout).jumps.length);
      for (const g of drawn) expect(descendants(g, "text")).toEqual([]);
    });

    it("keeps step and action boxes apart", () => {
      const list = boxes(root);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${a.what}@${a.x},${a.y} vs ${b.what}@${b.x},${b.y}`).toBe(false);
        }
      }
    });

    it("has light and dark colors as CSS custom properties", () => {
      expect(svg).toContain("@media (prefers-color-scheme: dark)");
      expect(svg).toContain(".qsfc-dark .qsfc-look-");
      expect(svg).toMatch(/--qsfc-bg:#[0-9a-f]{6}/);
      expect(svg).not.toMatch(/(fill|stroke)="#/);
    });

    it("is deterministic", () => {
      const again = build(source);
      expect(renderSvg(again.graph, again.layout, options)).toBe(svg);
    });
  });
});

describe("SVG view: text", () => {
  const source = [
    "init idle",
    "  msg := 'R&D <ok> \"q\"';",
    "-- level < 10 AND temp > 5",
    "step a_very_long_step_name_that_goes_on_and",
    "  x := 1;",
    "  y := 2;",
    "  z := 3;",
    "  w := 4;",
    "  v := 5;",
    "-- this_is_a_very_long_condition_name AND another_long_condition_name OR yet_another -> idle",
  ].join("\n");
  const { graph, layout } = build(source);

  it.each(["studio", "textbook"] as const)("escapes and truncates (%s)", (look) => {
    const svg = renderSvg(graph, layout, { look });
    const root = parseXml(svg);
    expect(svg).toContain("level &lt; 10 AND temp &gt; 5");
    expect(svg).toContain("&apos;R&amp;D &lt;ok&gt; &quot;q&quot;&apos;");
    const texts = descendants(root, "text");
    // The long condition is cut, with the full text in a <title> tooltip.
    const cond = texts.find((t) => /qsfc-cond/.test(t.attrs["class"] ?? "") && textOf(t).includes("this_is_a_very"))!;
    const title = descendants(cond, "title")[0]!;
    expect(textOf(title)).toBe(graph.transitions[1]!.condition);
    expect(textOf(cond).endsWith("…")).toBe(true);
    // Five action lines: four are shown, then "…"; the action tooltip has all of them.
    expect(svg).toContain("w := 4;");
    expect(svg).not.toContain(">v := 5;<");
    expect(texts.some((t) => /qsfc-more/.test(t.attrs["class"] ?? ""))).toBe(true);
    // The long step name is cut too, with its full name in a tooltip.
    const name = texts.find((t) => /qsfc-name/.test(t.attrs["class"] ?? "") && textOf(t).includes("a_very_long"))!;
    expect(textOf(descendants(name, "title")[0]!)).toBe("a_very_long_step_name_that_goes_on_and");
  });

  it("hides actions when asked", () => {
    const svg = renderSvg(graph, layout, { showActions: false });
    expect(body(svg)).not.toContain('class="qsfc-action');
  });

  it("numbers steps 1, 2, 3 in file order (textbook)", () => {
    const svg = renderSvg(graph, layout, { look: "textbook", numbering: "numbers" });
    expect(svg).toContain('class="qsfc-side-name"');
    expect(svg).toMatch(/class="qsfc-name"[^>]*>1</);
    expect(svg).toMatch(/class="qsfc-name"[^>]*>2</);
    // Numbering is a textbook option only.
    expect(body(renderSvg(graph, layout, { look: "studio", numbering: "numbers" }))).not.toContain("qsfc-side-name");
  });
});

describe("SVG view: reviewed snapshots", () => {
  const demo = readFileSync(new URL("../../docs/mockups/demo.qsfc", import.meta.url), "utf8");
  const tp05 = validCharts().find((c) => c.name === "testpack/tp05_jumps")!.source;

  it("studio look of the mockup chart", async () => {
    const { graph, layout } = build(demo);
    await expect(renderSvg(graph, layout, { look: "studio" })).toMatchFileSnapshot("./__snapshots__/svg-studio__demo.svg");
  });

  it("textbook look of tp05_jumps", async () => {
    const { graph, layout } = build(tp05);
    await expect(renderSvg(graph, layout, { look: "textbook" })).toMatchFileSnapshot(
      "./__snapshots__/svg-textbook__tp05_jumps.svg",
    );
  });
});

describe("SVG view: jump routing (tank chart)", () => {
  const { graph, layout } = build(tankSource);
  const idOfCond = (cond: string): string => {
    const t = graph.transitions.find((x) => x.condition === cond)!;
    return graph.links.find((l) => l.from === t.id)!.from;
  };
  const low = idOfCond("level_low");
  const high = idOfCond("level_high");
  const stepBox = (svg: string, name: string): { x0: number; y0: number; x1: number } => {
    const s = graph.steps.find((x) => x.name === name)!;
    const g = descendants(parseXml(svg), "g").find((e) => e.attrs["data-id"] === s.id)!;
    const r = descendants(g, "rect").find((e) => hasClass(e, "qsfc-step-box"))!;
    return { x0: Number(r.attrs["x"]), y0: Number(r.attrs["y"]), x1: Number(r.attrs["x"]) + Number(r.attrs["width"]) };
  };

  describe.each(variants)("$label", ({ options }) => {
    const svg = renderSvg(graph, layout, options);
    const geo = readGeometry(svg);
    const wire = (from: string): { id: string; segs: typeof geo.lines } => {
      const id = [...geo.jumps.keys()].find((k) => k.startsWith(`${from}-`))!;
      return { id, segs: geo.jumps.get(id)! };
    };
    const xs = (segs: typeof geo.lines): number[] => segs.flatMap((s) => [s.x0, s.x1]);
    // Elements beside a wire's lane: the boxes in the lane's vertical range.
    const beside = (segs: typeof geo.lines) => {
      const lane = segs.filter((s) => s.x0 === s.x1).sort((a, b) => Math.abs(b.y1 - b.y0) - Math.abs(a.y1 - a.y0))[0]!;
      const y0 = Math.min(lane.y0, lane.y1);
      const y1 = Math.max(lane.y0, lane.y1);
      return geo.boxes.filter((b) => b.y1 > y0 && b.y0 < y1);
    };

    it("draws both return lines all the way, without crossings or labels", () => {
      expect(geo.jumps.size).toBe(2);
      expect(crossings(svg)).toEqual([]);
      expect(body(svg)).not.toContain("qsfc-jump-label");
      expect(body(svg)).not.toContain("qsfc-xref");
    });

    it("loops the left leg on the left and the right leg on the right, hugging the chart", () => {
      const left = Math.min(...xs(wire(low).segs));
      const right = Math.max(...xs(wire(high).segs));
      const elemX0 = Math.min(...beside(wire(low).segs).map((b) => b.x0));
      const elemX1 = Math.max(...beside(wire(high).segs).map((b) => b.x1));
      expect(left).toBeLessThan(elemX0);
      expect(elemX0 - left).toBeLessThanOrEqual(30);
      expect(right).toBeGreaterThan(elemX1);
      expect(right - elemX1).toBeLessThanOrEqual(30);
    });

    it("joins the line above fill with an arrow (no convergence bar), and enters idle from the top", () => {
      const auto = graph.branches.find((b) => !b.node)!; // the convergence in front of fill (L5X only)
      expect(count(svg, `data-id="${auto.id}"`)).toBe(0);
      const fill = stepBox(svg, "fill");
      const lowSegs = wire(low).segs;
      const lastLow = lowSegs[lowSegs.length - 1]!;
      expect(lastLow.y0).toBe(lastLow.y1); // horizontal, towards the link
      expect(lastLow.y1).toBeLessThan(fill.y0);
      expect(lastLow.x1).toBeGreaterThan(lastLow.x0);
      expect(svg).toMatch(new RegExp(`class="qsfc-wire qsfc-jump-join" data-id="${wire(low).id}"`));
      const idle = stepBox(svg, "idle");
      const highSegs = wire(high).segs;
      const lastHigh = highSegs[highSegs.length - 1]!;
      expect(lastHigh.x0).toBe(lastHigh.x1); // vertical, down into idle
      expect(lastHigh.x1).toBe((idle.x0 + idle.x1) / 2);
      expect(lastHigh.y1).toBeGreaterThan(lastHigh.y0);
      expect(lastHigh.y1).toBeLessThan(idle.y0);
      expect(svg).toMatch(new RegExp(`class="qsfc-wire qsfc-jump" data-id="${wire(high).id}"`));
    });
  });

  it("does not change the L5X layout", () => {
    expect(layout.bars.size).toBe(graph.branches.length);
  });
});

describe("SVG view: cross-reference fallback", () => {
  // The middle leg's jump is boxed in by its neighbour legs: it cannot be drawn without a crossing.
  const source = syntheticCharts.find((c) => c.name === "synthetic/middle-leg-loop")!.source;
  const { graph, layout } = build(source);
  const t = graph.transitions.find((x) => x.condition === "y")!;
  const link = graph.links.find((l) => l.from === t.id)!;

  it.each(variants)("replaces the wire by a labelled arrow and a 'from' mark ($label)", ({ options }) => {
    const svg = renderSvg(graph, layout, options);
    const root = parseXml(svg);
    const g = descendants(root, "g").find((e) => hasClass(e, "qsfc-xref"))!;
    expect(g.attrs["data-id"]).toBe(`${link.from}-${link.to}`);
    const label = descendants(g, "text")[0]!;
    expect(textOf(label)).toBe(options.numbering === "numbers" ? "1" : "idle");
    const from = descendants(root, "text").find((e) => hasClass(e, "qsfc-xref-from"))!;
    expect(textOf(from)).toBe(`${t.name} ${t.condition}`);
    // dashed stubs at both ends (hidden wire, mockup docs/mockups/xref option C)
    expect(descendants(root, "g").filter((e) => hasClass(e, "qsfc-xref-in"))).toHaveLength(1);
    expect(svg).toContain("stroke-dasharray:4 3");
    expect(crossings(svg)).toEqual([]);
    // The other jump into idle (the main column) is still drawn all the way.
    expect(descendants(root, "g").filter((e) => hasClass(e, "qsfc-jump") || hasClass(e, "qsfc-jump-join")).length).toBe(1);
  });

  it("uses one for tp05's jump to the fault chain", () => {
    const { graph: g5, layout: l5 } = build(validCharts().find((c) => c.name === "testpack/tp05_jumps")!.source);
    const svg = renderSvg(g5, l5, { look: "textbook" });
    const fault = g5.transitions.find((x) => x.condition === "fault")!;
    expect(svg).toMatch(new RegExp(`class="qsfc-wire qsfc-xref" data-id="${fault.id}-`));
    expect(count(svg, "qsfc-xref\"")).toBe(1);
  });
});

describe("SVG view: geometry primitives", () => {
  const seg = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1, owner: "a" });
  it("tells crossings from corners and T-junctions", () => {
    expect(segmentsCross(seg(0, 5, 10, 5), seg(5, 0, 5, 10))).toBe(true);
    expect(segmentsCross(seg(0, 5, 5, 5), seg(5, 0, 5, 10))).toBe(false); // T
    expect(segmentsCross(seg(0, 0, 5, 0), seg(5, 0, 5, 10))).toBe(false); // corner
    expect(segmentsCross(seg(0, 0, 6, 0), seg(5, 0, 9, 0))).toBe(true); // overlap
    expect(segmentsCross(seg(0, 0, 5, 0), seg(5, 0, 9, 0))).toBe(false); // end to end
  });
  it("tells a line through a box from a line ending in it", () => {
    const box = { x0: 0, y0: 0, x1: 10, y1: 4, owner: "b" };
    expect(segmentHitsBox(seg(5, -10, 5, 10), box)).toBe(true);
    expect(segmentHitsBox(seg(5, -10, 5, 2), box)).toBe(false);
    expect(segmentHitsBox(seg(5, -10, 5, 0), box)).toBe(false);
    expect(segmentHitsBox(seg(11, -10, 11, 10), box)).toBe(false);
  });
});
