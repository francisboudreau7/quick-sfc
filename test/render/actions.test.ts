/** Several actions per step in the SVG and ASCII views (SPEC §4.3, §12, Phase 4b). */
import { describe, expect, it } from "vitest";
import { descendants, parseXml, textOf, type XmlElement } from "../../src/l5x/xml.js";
import { renderAscii } from "../../src/render/ascii.js";
import { renderSvg, type SvgLook } from "../../src/render/svg.js";
import { build, chartSource } from "../layout/helpers.js";

const hasClass = (e: XmlElement, cls: string): boolean => (e.attrs["class"] ?? "").split(" ").includes(cls);
const src = (...lines: string[]): string => lines.join("\n");

describe.each<SvgLook>(["studio", "textbook"])("SVG %s look: stacked actions", (look) => {
  const { graph, layout } = build(chartSource("testpack/tp12_qualifiers"));
  const svg = renderSvg(graph, layout, { look });
  const root = parseXml(svg);
  const stepGroup = (name: string) =>
    descendants(root, "g").find((g) => hasClass(g, "qsfc-step") && g.attrs["data-id"] === graph.steps.find((s) => s.name === name)!.id)!;
  const rows = (name: string) => descendants(stepGroup(name), "g").filter((g) => hasClass(g, "qsfc-action"));

  it("draws one row per action with its qualifier cell", () => {
    expect(rows("fill").map((g) => textOf(descendants(g, "text").find((t) => hasClass(t, "qsfc-qualifier"))!))).toEqual([
      "N", "S", "L 5s", "D 2s", "P",
    ]);
    expect(rows("done").map((g) => textOf(descendants(g, "text").find((t) => hasClass(t, "qsfc-qualifier"))!))).toEqual(["N", "R"]);
  });

  it("stacks the rows: same x and width, each one right under the previous", () => {
    const boxes = rows("fill").map((g) => descendants(g, "rect").find((r) => hasClass(r, "qsfc-action-box"))!.attrs);
    for (const b of boxes) {
      expect(b["x"]).toBe(boxes[0]!["x"]);
      expect(b["width"]).toBe(boxes[0]!["width"]);
    }
    for (let k = 1; k < boxes.length; k++) {
      expect(Number(boxes[k]!["y"])).toBeCloseTo(Number(boxes[k - 1]!["y"]) + Number(boxes[k - 1]!["height"]), 5);
    }
  });

  it("shows the sugar expanded", () => {
    expect(textOf(rows("fill")[0]!)).toContain("valve [:=] 1; pump [:=] 1;");
  });

  it("draws one link from the step to its actions", () => {
    expect(descendants(stepGroup("fill"), "path").filter((p) => hasClass(p, "qsfc-action-link"))).toHaveLength(1);
  });

  it("matches the reviewed snapshot", async () => {
    await expect(svg).toMatchFileSnapshot(`./__snapshots__/svg-${look}__tp12_qualifiers.svg`);
  });
});

describe("SVG: operands of stacked actions (studio look)", () => {
  it("numbers the action operands like the L5X", () => {
    const { graph, layout } = build(src("init a", "  x := 1;", "  S", "    y := 1;", "-- go", "step b", "-- back -> a"));
    const names = descendants(parseXml(renderSvg(graph, layout, { look: "studio" })), "text")
      .filter((t) => hasClass(t, "qsfc-action-name"))
      .map(textOf);
    // step b has no action (the L5X gives it Action_002, the comment-only one): not drawn
    expect(names).toEqual(["Action_000", "Action_001"]);
  });
});

describe("ASCII: actions", () => {
  it("lists every action with its qualifier", () => {
    const { graph, layout } = build(src("init a", "  on valve", "  L 10s", "    horn [:=] 1; // loud", "-- go -> a"));
    expect(renderAscii(graph, layout)).toContain("─[ N valve [:=] 1; ][ L 10s horn [:=] 1; ]");
  });

  it("shows a single non-N action with its qualifier", () => {
    const { graph, layout } = build(src("init a", "  S", "    x := 1;", "    y := 1;", "-- go -> a"));
    expect(renderAscii(graph, layout)).toContain("─[ S x := 1; … ]");
  });

  it("keeps the old form for one N action", () => {
    const { graph, layout } = build(src("init a", "  x := 1; // c", "-- go -> a"));
    expect(renderAscii(graph, layout)).toContain("─[ x := 1; // c ]");
  });
});
