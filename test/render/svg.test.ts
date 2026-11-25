import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { descendants, parseXml, textOf, type XmlElement } from "../../src/l5x/xml.js";
import { renderSvg, type SvgOptions } from "../../src/render/svg.js";
import { build, syntheticCharts, validCharts } from "../layout/helpers.js";

const charts = [...validCharts(), ...syntheticCharts];
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

    it("tags every step, transition and branch once with its data-id", () => {
      for (const s of graph.steps) expect(count(svg, `data-id="${s.id}"`), s.id).toBe(1);
      for (const t of graph.transitions) expect(count(svg, `data-id="${t.id}"`), t.id).toBe(1);
      for (const b of graph.branches) expect(count(svg, `data-id="${b.id}"`), b.id).toBe(1);
      const steps = descendants(root, "g").filter((g) => hasClass(g, "qsfc-step"));
      expect(steps.map((g) => g.attrs["data-id"])).toEqual(graph.steps.map((s) => s.id));
      expect(count(svg, 'class="qsfc-step qsfc-initial"')).toBe(1);
    });

    it("draws every link and wire with a data-id", () => {
      const wires = descendants(root).filter((e) => hasClass(e, "qsfc-wire"));
      expect(wires.length).toBeGreaterThan(0);
      for (const w of wires) expect(w.attrs["data-id"]).toMatch(/^[a-z0-9.]+-[a-z0-9.]+$/);
      for (const w of layout.wires) expect(count(svg, `data-id="${w.from}-${w.to}"`)).toBe(1);
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
