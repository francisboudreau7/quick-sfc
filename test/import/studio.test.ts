import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportL5X } from "../../src/compile.js";
import { importL5X } from "../../src/import/index.js";
import { readSfc, type SfcChart } from "../../src/tidy/read.js";
import { attr, scanDescendants, scanXml } from "../../src/tidy/scan.js";

/** The chart's wires, by operand (steps) and condition (transitions), sorted. */
function wires(xml: string): string[] {
  const c = readSfc(scanDescendants(scanXml(xml), "SFCContent")[0]!) as SfcChart;
  const label = (id: string): string => {
    const n = c.nodes.get(id);
    if (n) return n.kind === "transition" ? `T:${(n.text[0] ?? "").replace(/;\s*$/, "").trim()}` : n.operand;
    const b = c.branches.get(id) ?? c.branches.get(c.legOf.get(id)!);
    return b ? `${b.type}-${b.flow}` : id;
  };
  return c.links.map((l) => `${label(l.from)} > ${label(l.to)}`).sort();
}

describe("a chart drawn in Studio (legacy/tests/MainProgram.L5X)", () => {
  const xml = readFileSync("legacy/tests/MainProgram.L5X", "utf8");
  const r = importL5X(xml);

  it("imports without errors, steps named from their operands", () => {
    expect(r.error).toBeUndefined();
    expect(r.errors).toBe(0);
    expect(r.source).toMatch(/^sfc SFC$/m);
    expect(r.source).toMatch(/^init s0$/m);
    expect(r.source).toContain("-- s2.DN and d1");
  });

  it("exports again with the same wires and the same step operands", () => {
    const out = exportL5X(r.source, { fileName: "MainProgram.qsfc" });
    expect(out.text).toBeDefined();
    expect(wires(out.text!)).toEqual(wires(xml));
  });

  it("keeps timer presets and initial values (SPEC §7.4)", () => {
    expect(r.source).toMatch(/^tag T2 : TIMER 3s$/m);
    expect(r.source).toMatch(/^tag T7 : TIMER 1s250ms$/m);
    expect(r.source).toMatch(/^tag Bonsens : BOOL = 1$/m);
    const out = exportL5X(r.source, { fileName: "MainProgram.qsfc" }).text!;
    expect(out).toContain("<![CDATA[[0,3000,0]]]>");
    expect(out).toMatch(/<Tag Name="Bonsens"[^>]*>\s*<Data Format="L5K">\s*<!\[CDATA\[1\]\]>/);
  });

  it("keeps every Tran operand too, with tr<N> names where file order would renumber", () => {
    const ops = (x: string) =>
      [...x.matchAll(/<Transition ID="\d+"[^>]*Operand="(Tran_\d+)"[\s\S]*?<Condition>([\s\S]*?)<\/Condition>/g)]
        .map((m) => {
          const lines = [...m[2]!.matchAll(/<!\[CDATA\[([^\]]*)\]\]>/g)].map((l) => l[1]!.trim()).filter(Boolean);
          return `${m[1]}=${lines.join(" ").replace(/;\s*$/, "").trim()}`;
        })
        .sort();
    const out = exportL5X(r.source, { fileName: "MainProgram.qsfc" }).text!;
    expect(ops(out)).toEqual(ops(xml));
    expect(r.source).toContain("-- tr4: s4.DN");
    expect(r.notes.filter((n) => n.level === "warning")).toEqual([]);
  });
});

/** Wires of every SFC routine, by routine name. */
function allWires(xml: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of scanDescendants(scanXml(xml), "Routine")) {
    const content = r.children.find((c) => c.name === "SFCContent");
    if (!content) continue;
    const c = readSfc(content) as SfcChart;
    const label = (id: string): string => {
      const n = c.nodes.get(id);
      if (n) return n.operand;
      const b = c.branches.get(id) ?? c.branches.get(c.legOf.get(id)!);
      return b ? `${b.type}-${b.flow}` : id;
    };
    out.set(attr(r, "Name") ?? "", c.links.map((l) => `${label(l.from)} > ${label(l.to)}`).sort());
  }
  return out;
}

/** Tag names in the controller's context <Tags>, lower case. */
function controllerTags(xml: string): string[] {
  const block = /<Controller[^>]*>[\s\S]*?<Tags Use="Context">([\s\S]*?)<\/Tags>/.exec(xml)![1]!;
  return [...block.matchAll(/<Tag Name="(\w+)"/g)].map((m) => m[1]!.toLowerCase()).sort();
}

describe("STATION2: a program with controller tags, ladder routines and SFR/SFP (Phase 4d+)", () => {
  const xml = readFileSync("legacy/tests/STATION2_MainProgram.L5X", "utf8");
  const r = importL5X(xml);
  const out = exportL5X(r.source, { fileName: "MainProgram.qsfc" });

  it("imports and checks without errors; the ladder routines are on the uses line, MainRoutine is main", () => {
    expect(r.errors).toBe(0);
    expect(out.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.source).toMatch(/^uses MainRoutine \(main\), analog, ARRET_URGENCE, AUTO_MAN, front_montant_boutons, InTouch$/m);
    expect(r.source).toContain("SFR(PRODUCTION_NORMALE,s0);");
    expect(out.text).not.toContain("MainRoutineName");
  });

  it("reads the controller tags: values, presets, aliases (also of a step member)", () => {
    expect(r.source).toMatch(/^controller\n {2}tag /m);
    expect(r.source).toMatch(/^ {2}tag stop : BOOL = 1$/m);
    expect(r.source).toMatch(/^ {4}ejections +s17\.Count$/m);
    expect(r.source).toMatch(/^init s42 200ms$/m);
    // the presets are in the controller's Step tags: s42.DN is no longer "TRUE immediately"
    expect(out.diagnostics.filter((d) => d.code === "W302").map((d) => d.message)).not.toContain(
      "`s42.DN` is used but `s42` has no preset, so it is TRUE immediately",
    );
  });

  it("exports the same wires and operands, and the same controller tags (but the FBD types)", () => {
    expect(allWires(out.text!)).toEqual(allWires(xml));
    const fbd = new Set(["lim_07", "lim_08", "lim_09", "scl_04"]);
    const original = controllerTags(xml).filter((n) => !fbd.has(n) && !/^(step|tran|action)_/.test(n));
    const now = controllerTags(out.text!);
    expect(original.filter((n) => !now.includes(n))).toEqual([]);
    const elements = (list: string[]) => list.filter((n) => /^(step|tran)_/.test(n));
    const charted = new Set([...out.text!.matchAll(/Operand="((?:Step|Tran)_\d+)"/g)].map((m) => m[1]!.toLowerCase()));
    // the chart elements, and Step_016: a step tag the code names (`Step_016.Count:=0;`) that no
    // chart has, declared `tag Step_016 : SFC_STEP` by the import
    expect(elements(now)).toEqual(elements(controllerTags(xml)).filter((n) => charted.has(n) || n === "step_016"));
    expect(r.source).toMatch(/^ {2}tag Step_016 : SFC_STEP 500ms$/m);
  });

  it("sfcTagsAtProgram moves the element tags to the program", () => {
    const moved = importL5X(xml, { sfcTagsAtProgram: true });
    expect(moved.source).not.toContain("sfc tags");
    const t = exportL5X(moved.source, { fileName: "MainProgram.qsfc" }).text!;
    // Step_016 is not an element of the charts: it stays where it was
    expect(controllerTags(t).filter((n) => /^(step|tran|action)_/.test(n))).toEqual(["step_016"]);
  });
});

describe("STATION2: a routine export (GEMMA.L5X)", () => {
  const xml = readFileSync("legacy/tests/STATION2_GEMMA.L5X", "utf8");
  const r = importL5X(xml);

  it("imports without errors or warnings: other routines on uses, their steps kept as operands", () => {
    expect(r.errors).toBe(0);
    expect(r.notes.filter((n) => n.level === "warning")).toEqual([]);
    expect(r.source).toMatch(/^uses flash_ER, INIT, PRODUCTION_NORMALE$/m);
    expect(r.source).toContain("SFR(PRODUCTION_NORMALE,Step_000);");
    expect(r.source).toContain("Step_001.T > 5000");
    expect(r.source).toContain("ejections>=3 and Step_017.DN");
    const out = exportL5X(r.source, { fileName: "GEMMA.qsfc" });
    // only the SFC logic checks (W700: GEMMA's select relies on leg order)
    expect(out.diagnostics.filter((d) => !/^W70\d$/.test(d.code))).toEqual([]);
    expect(allWires(out.text!)).toEqual(allWires(xml));
  });
});
