import { describe, expect, it } from "vitest";
import { key } from "../../src/model/ast.js";
import { formatDuration, renderAscii } from "../../src/render/ascii.js";
import { build, syntheticCharts, validCharts } from "../layout/helpers.js";

const charts = [...validCharts(), ...syntheticCharts];

describe.each(charts)("ASCII view: $name", ({ name, source }) => {
  const { graph, layout } = build(source);
  const text = renderAscii(graph, layout);
  const lines = text.split("\n");

  it("matches the reviewed snapshot", async () => {
    await expect(text).toMatchFileSnapshot(`./__snapshots__/${name.replace(/\//g, "__")}.txt`);
  });

  it("shows every element in full (nothing overlapping or cut)", () => {
    const has = (s: string, what: string) => expect(text.includes(s), `${what}: ${s}`).toBe(true);
    for (const s of graph.steps) {
      const preset = s.presetMs > 0 ? `  ${formatDuration(s.presetMs)}` : "";
      expect(text, s.name).toMatch(new RegExp(`[│║] +${escape(s.name + preset)} +[│║]`));
      if (s.action.length > 0) has(`─[ ${s.action[0]!.trim().slice(0, 39)}`, "action");
    }
    for (const t of graph.transitions) {
      has(t.auto ? `┼ ${t.condition}` : `┼ ${t.name}: ${t.condition}`, "transition");
      if (t.node.jump) {
        const target = graph.steps.find((s) => key(s.name) === key(t.node.jump!.text))!;
        has(t.auto ? `→ ${target.name} (${t.name})` : `→ ${target.name}`, "jump label");
      }
    }
    for (const s of graph.steps) {
      const from = graph.transitions.filter((t) => t.node.jump && key(t.node.jump.text) === key(s.name));
      if (from.length > 0) has(`◄ from ${from.map((t) => t.name).join(", ")}`, "convergence label");
    }
  });

  it("draws one double box (the initial step) and lines that connect", () => {
    expect(text.match(/╔/g)).toHaveLength(1);
    expect(lines[lines.length - 1]).toBe("");
    for (const l of lines) expect(l).toBe(l.trimEnd());
    // Every vertical line character continues above or below.
    const grid = lines.map((l) => [...l]);
    const at = (y: number, x: number) => grid[y]?.[x] ?? " ";
    const fromAbove = new Set([..."│┬┼├┤┌┐╤╥╦╪╞╡╒╕"]);
    const fromBelow = new Set([..."│┴┼├┤└┘╧╨╩╪╞╡╘╛"]);
    grid.forEach((row, y) =>
      row.forEach((ch, x) => {
        if (ch !== "│") return;
        expect(fromAbove.has(at(y - 1, x)) || at(y - 1, x) === "│", `line ${y + 1} col ${x + 1} (above)`).toBe(true);
        expect(fromBelow.has(at(y + 1, x)) || at(y + 1, x) === "│", `line ${y + 1} col ${x + 1} (below)`).toBe(true);
      }),
    );
  });

  it(`is deterministic (${name})`, () => {
    const again = build(source);
    expect(renderAscii(again.graph, again.layout)).toBe(text);
  });
});

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("ASCII details", () => {
  it("formats presets like the source", () => {
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(90_000)).toBe("1m30s");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(7_200_000)).toBe("2h");
    expect(formatDuration(3_661_001)).toBe("1h1m1s1ms");
  });

  it("does not show auto names, shows explicit ones", () => {
    const { graph, layout } = build(["init a", "-- go", "step b", "-- named: x > 1 -> a"].join("\n"));
    const text = renderAscii(graph, layout);
    expect(text).toContain("┼ go");
    expect(text).not.toContain("T1");
    expect(text).toContain("┼ named: x > 1");
    expect(text).toContain("→ a\n");
    expect(text).toContain("◄ from named");
  });

  it("truncates long and multi-line actions", () => {
    const long = "x := 1234567890 + 1234567890 + 1234567890 + 1234567890;";
    const { graph, layout } = build(["init a", `  ${long}`, "-- go", "step b", "  y := 1;", "  z := 2;", "-- TRUE -> a"].join("\n"));
    const text = renderAscii(graph, layout);
    expect(text).toContain(`─[ ${long.slice(0, 39)}… ]`);
    expect(text).toContain("─[ y := 1; … ]");
  });

  it("draws the spec's first lines (SPEC §12)", () => {
    const { graph, layout } = build(
      ["init idle", "  motor := 0;", "-- start_btn AND safety_ok", "step fill 5s", "  valve [:=] 1;", "-- fill.DN -> idle"].join("\n"),
    );
    expect(renderAscii(graph, layout)).toMatchInlineSnapshot(`
      "╔═══════════╗ ◄ from T2
      ║   idle    ║─[ motor := 0; ]
      ╚═════╤═════╝
            ┼ start_btn AND safety_ok
      ┌─────┴─────┐
      │ fill  5s  │─[ valve [:=] 1; ]
      └─────┬─────┘
            ┼ fill.DN
            → idle (T2)
      "
    `);
  });
});
