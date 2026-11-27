import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { Simulator } from "../../src/sim/index.js";

describe("SVG while simulating (Phase 4e)", () => {
  const src = "init idle\n-- go AND NOT stop AND count < 10\nstep fill 2s\n-- fill.done -> idle\n";
  const r = compile(src, { fileName: "t.qsfc" });
  const sim = new Simulator(r);
  sim.setTag("count", 7);
  sim.scan();
  const g = r.graph!;
  const draw = () => ({
    active: new Set(sim.stepList().filter((s) => s.active).map((s) => s.id)),
    badges: new Map([[g.steps[1]!.id, "0.0 / 2 s"]]),
    transitions: new Map(g.transitions.map((t) => {
      const v = sim.transition("t", t.id);
      return [t.id, { state: (v.enabled ? (v.value ? "true" : "false") : "idle") as "true" | "false" | "idle", parts: sim.conditionParts("t", t.id) }];
    })),
  });

  it("draws active steps, transition states, inputs as buttons and comparison values", () => {
    const svg = renderSvg(g, r.layout!, { look: "textbook", sim: draw() });
    expect(svg).toContain(`qsfc-step qsfc-initial qsfc-sim-active" data-id="${g.steps[0]!.id}"`);
    expect(svg).toContain("qsfc-sim-false qsfc-sim-fire");
    expect(svg).toMatch(/<rect class="qsfc-pill qsfc-pill-off" data-input="go"/);
    expect(svg).toMatch(/<rect class="qsfc-pill qsfc-pill-off" data-input="stop"/);
    expect(svg).toContain(">count=7</text>");
    expect(svg).toContain("qsfc-res qsfc-p-false");
  });

  it("buttons push the text after them to the right (padding on both sides)", () => {
    const svg = renderSvg(g, r.layout!, { look: "textbook", sim: draw() });
    const xs = [...svg.matchAll(/<tspan x="([\d.]+)"/g)].map((m) => Number(m[1]));
    const plain = renderSvg(g, r.layout!, { look: "textbook" });
    expect(plain).not.toContain("data-input");
    // " AND NOT " after `go` starts 12 px later than it would without the button
    expect(xs[1]! - xs[0]!).toBeCloseTo(2 * 11 * 0.61 + 6, 1);
  });

  it("after a scan with go = 1 the step changes and the badge shows", () => {
    sim.setTag("go", true);
    sim.scan();
    const svg = renderSvg(g, r.layout!, { look: "textbook", sim: draw() });
    expect(svg).toContain(`qsfc-sim-active" data-id="${g.steps[1]!.id}"`);
    expect(svg).toContain(">0.0 / 2 s</text>");
  });
});
