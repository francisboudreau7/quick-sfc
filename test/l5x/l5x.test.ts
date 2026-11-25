import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkL5X, writeL5X } from "../../src/l5x/index.js";
import { blockText, descendants, parseXml } from "../../src/l5x/xml.js";
import { build, DATE, parallel, tag } from "./helpers.js";

const opts = { programName: "Test_Parallel", routineName: "Parallel", controllerName: "Projet_1", exportDate: DATE, nameComments: false };

describe("golden", () => {
  it("is byte-identical to the verified Test_Parallel.L5X", () => {
    const { graph, positions } = parallel();
    const tags = [
      tag("Go", "BOOL", "Start the parallel sequence"),
      tag("Done_A", "BOOL", "Leg A finished"),
      tag("Done_B", "BOOL", "Leg B finished"),
      tag("Out_A"),
      tag("Out_B"),
    ];
    const out = writeL5X(graph, positions, tags, { ...opts, describeElements: false });
    const golden = readFileSync(new URL("./golden/Test_Parallel.L5X", import.meta.url), "utf8");
    expect(out).toBe(golden);
    expect(checkL5X(out)).toEqual([]);
  });
});

const selection = () =>
  build(
    [
      { id: "s0", index: 0, x: 200, y: 100, initial: true, name: "wait", description: "Wait for start" },
      { id: "s1", index: 1, x: 100, y: 400, action: ["L[:=]1;", "// comment", "", "M[:=]0;"] },
      { id: "s2", index: 2, x: 400, y: 400 },
    ],
    [
      { id: "t0", index: 0, x: 100, y: 300, condition: "a", name: "ta" },
      { id: "t1", index: 1, x: 400, y: 300, condition: "b", name: "tb" },
      { id: "t2", index: 2, x: 100, y: 520, condition: "c" },
      { id: "t3", index: 3, x: 400, y: 520, condition: "d" },
    ],
    [
      { id: "b0", type: "selection", flow: "diverge", legs: 2, y: 240 },
      { id: "b1", type: "selection", flow: "converge", legs: 2, y: 600 },
    ],
    [
      ["s0", "b0"],
      ["b0.0", "t0"],
      ["b0.1", "t1"],
      ["t0", "s1"],
      ["t1", "s2"],
      ["s1", "t2"],
      ["s2", "t3"],
      ["t2", "b1.0"],
      ["t3", "b1.1"],
      ["b1", "s0"],
    ],
  );

describe("selection and actions", () => {
  const { graph, positions } = selection();
  const out = writeL5X(graph, positions, [tag("a"), tag("b"), tag("c"), tag("d"), tag("L"), tag("M")], opts);

  it("passes the self-check", () => expect(checkL5X(out)).toEqual([]));

  it("writes priority only on selection diverge", () => {
    expect(out).toContain('BranchType="Selection" BranchFlow="Diverge" Priority="Default">');
    expect(out).toContain('BranchType="Selection" BranchFlow="Converge">');
  });

  it("writes one Line per action line, empty lines as empty CDATA", () => {
    const action = descendants(parseXml(out), "Action")[0]!;
    expect(descendants(action, "Line").map(blockText)).toEqual(["L[:=]1;", "// comment", "", "M[:=]0;"]);
    expect(out).toContain("<![CDATA[]]>");
  });

  it("steps without action are self-closing, one action tag only", () => {
    expect(out).toMatch(/Operand="Step_002"[^>]*ShowActions="true"\/>/);
    expect(descendants(parseXml(out), "Action")).toHaveLength(1);
  });

  it("describes steps and transitions", () => {
    const tags = descendants(parseXml(out), "Tag");
    const desc = (n: string) => {
      const d = descendants(tags.find((x) => x.attrs["Name"] === n)!, "Description")[0];
      return d ? blockText(d) : undefined;
    };
    expect(desc("Step_000")).toBe("wait\nWait for start"); // the reader normalizes CRLF to LF
    expect(out).toContain("<![CDATA[wait\r\nWait for start]]>");
    expect(desc("Step_001")).toBe("step1");
    expect(desc("Tran_000")).toBe("ta");
    expect(desc("Tran_002")).toBe("T2");
  });

  it("describeElements=false omits element descriptions", () => {
    const o = writeL5X(graph, positions, [], { ...opts, describeElements: false });
    expect(o).not.toContain("<Description>");
  });
});

describe("nested branches and automatic convergence", () => {
  // s0 -select-> leg0: t0 s1 t1 -parallel-> (s2 | s3) -> t2 ; leg1: t3 ; auto converge b3 -> s0
  const g = build(
    [
      { id: "s0", index: 0, x: 200, y: 100, initial: true },
      { id: "s1", index: 1, x: 100, y: 300 },
      { id: "s2", index: 2, x: 50, y: 500 },
      { id: "s3", index: 3, x: 200, y: 500 },
    ],
    [
      { id: "t0", index: 0, x: 100, y: 200, condition: "a" },
      { id: "t1", index: 1, x: 100, y: 400, condition: "b" },
      { id: "t2", index: 2, x: 100, y: 600, condition: "c" },
      { id: "t3", index: 3, x: 400, y: 200, condition: "d" },
    ],
    [
      { id: "b0", type: "selection", flow: "diverge", legs: 2, y: 150 },
      { id: "b1", type: "simultaneous", flow: "diverge", legs: 2, y: 440 },
      { id: "b2", type: "simultaneous", flow: "converge", legs: 2, y: 540 },
      { id: "b3", type: "selection", flow: "converge", legs: 2, y: 700 },
    ],
    [
      ["s0", "b0"],
      ["b0.0", "t0"],
      ["b0.1", "t3"],
      ["t0", "s1"],
      ["s1", "t1"],
      ["t1", "b1"],
      ["b1.0", "s2"],
      ["b1.1", "s3"],
      ["s2", "b2.0"],
      ["s3", "b2.1"],
      ["b2", "t2"],
      ["t2", "b3.0"],
      ["t3", "b3.1"],
      ["b3", "s0"],
    ],
  );
  const out = writeL5X(g.graph, g.positions, [tag("a"), tag("b"), tag("c"), tag("d")], opts);

  it("passes the self-check", () => expect(checkL5X(out)).toEqual([]));

  it("numbers ids in export order: steps, transitions, then branches with legs", () => {
    const sfc = descendants(parseXml(out), "SFCContent")[0]!;
    const ids = descendants(sfc)
      .filter((e) => e.attrs["ID"] !== undefined)
      .map((e) => `${e.name}:${e.attrs["ID"]}`);
    expect(ids.join(" ")).toBe(
      "Step:0 Step:1 Step:2 Step:3 Transition:4 Transition:5 Transition:6 Transition:7 " +
        "Branch:8 Leg:9 Leg:10 Branch:11 Leg:12 Leg:13 Branch:14 Leg:15 Leg:16 Branch:17 Leg:18 Leg:19",
    );
  });

  it("sorts links by from-id then to-id", () => {
    const links = descendants(parseXml(out), "DirectedLink").map((l) => [Number(l.attrs["FromID"]), Number(l.attrs["ToID"])]);
    const sorted = [...links].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
    expect(links).toEqual(sorted);
    expect(links).toHaveLength(14);
  });

  it("detects a broken link", () => {
    const bad = out.replace('<DirectedLink FromID="0" ToID="8"', '<DirectedLink FromID="0" ToID="99"');
    expect(bad).not.toBe(out);
    expect(checkL5X(bad).join("\n")).toMatch(/unknown ID/);
  });
});

describe("tags", () => {
  const { graph, positions } = parallel();
  const out = writeL5X(
    graph,
    positions,
    [
      tag("zeta", "REAL", "a real"),
      tag("Alpha", "DINT"),
      tag("tmr", "TIMER", "multi\nline"),
      tag("Go"),
      tag("Done_A"),
      tag("Done_B"),
      tag("Out_A"),
      tag("Out_B"),
    ],
    opts,
  );
  const tags = descendants(parseXml(out), "Tag");
  const find = (n: string) => tags.find((t) => t.attrs["Name"] === n)!;

  it("sorts case-insensitively", () => {
    const names = tags.map((t) => t.attrs["Name"]!);
    expect(names).toEqual([...names].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)));
    expect(names[0]).toBe("Action_000");
    expect(names[2]).toBe("Alpha");
  });

  it("DINT", () => {
    expect(out).toContain('<Tag Name="Alpha" TagType="Base" DataType="DINT" Radix="Decimal" Constant="false" ExternalAccess="Read/Write">');
    expect(out).toContain('<DataValue DataType="DINT" Radix="Decimal" Value="0"/>');
  });

  it("TIMER", () => {
    expect(out).toContain('<Tag Name="tmr" TagType="Base" DataType="TIMER" Constant="false" ExternalAccess="Read/Write">');
    expect(out).toContain("<![CDATA[[0,0,0]]]>");
    expect(descendants(find("tmr"), "DataValueMember").map((m) => m.attrs["Name"])).toEqual(["PRE", "ACC", "EN", "TT", "DN"]);
    expect(out).toContain("<![CDATA[multi\r\nline]]>");
  });

  it("REAL (unverified notation)", () => {
    expect(out).toContain('<Tag Name="zeta" TagType="Base" DataType="REAL" Radix="Float"');
    expect(out).toContain("<![CDATA[0.00000000e+000]]>");
    expect(out).toContain('<DataValue DataType="REAL" Radix="Float" Value="0.0"/>');
  });

  it("BOOL with description", () => {
    const { graph: g, positions: p } = parallel();
    const o = writeL5X(g, p, [tag("Go", "BOOL", "Start")], opts);
    expect(o).toContain('<Tag Name="Go" TagType="Base" DataType="BOOL" Radix="Decimal" Constant="false" ExternalAccess="Read/Write">\r\n<Description>\r\n<![CDATA[Start]]>');
  });

  it("SFC_STEP carries the preset in L5K and Decorated", () => {
    expect(out).toContain("<![CDATA[[0,1000,0,0,0,0,0]]]>");
    const pre = descendants(find("Step_002"), "DataValueMember").find((m) => m.attrs["Name"] === "PRE")!;
    expect(pre.attrs["Value"]).toBe("1000");
  });

  it("passes the self-check once the condition tags are declared", () => {
    expect(checkL5X(out)).toEqual([]);
  });
});

describe("options and safety nets", () => {
  const { graph, positions } = parallel();
  it("defaults", () => {
    const out = writeL5X(graph, positions, [], { programName: "P", routineName: "R" });
    expect(out.startsWith("﻿<?xml")).toBe(true);
    expect(out).toContain('SoftwareRevision="32.01"');
    expect(out).toContain('<Controller Use="Context" Name="QuickSFC">');
    expect(out).toContain('MainRoutineName="R"');
    expect(out).not.toContain("Owner=");
    expect(out.endsWith("</RSLogix5000Content>")).toBe(true);
    expect(out).not.toMatch(/(^|[^\r])\n/);
  });

  it("custom revision and padded date", () => {
    const out = writeL5X(graph, positions, [], { ...opts, softwareRevision: "36.00", exportDate: new Date(2026, 0, 5, 3, 4, 5) });
    expect(out).toContain('SoftwareRevision="36.00"');
    expect(out).toContain('ExportDate="Mon Jan 05 03:04:05 2026"');
  });

  it("throws on ']]>' in ST", () => {
    const g = parallel();
    g.graph.transitions[0]!.condition = "a ]]> b";
    expect(() => writeL5X(g.graph, g.positions, [], opts)).toThrow(/\]\]>/);
  });

  it("throws on invalid names", () => {
    expect(() => writeL5X(graph, positions, [tag("bad__name")], opts)).toThrow(/invalid Studio name/);
    expect(() => writeL5X(graph, positions, [tag("trail_")], opts)).toThrow(/invalid Studio name/);
    expect(() => writeL5X(graph, positions, [tag("1abc")], opts)).toThrow(/invalid Studio name/);
    expect(() => writeL5X(graph, positions, [], { ...opts, routineName: "my routine" })).toThrow(/invalid Studio name/);
  });

  it("throws on tags differing only by case or clashing with operands", () => {
    expect(() => writeL5X(graph, positions, [tag("a"), tag("A")], opts)).toThrow(/duplicate tag/);
    expect(() => writeL5X(graph, positions, [tag("step_000")], opts)).toThrow(/duplicate tag/);
  });
});

describe("checkL5X", () => {
  const { graph, positions } = parallel();
  const names = ["Go", "Done_A", "Done_B", "Out_A", "Out_B"];
  const full = writeL5X(graph, positions, names.map((n) => tag(n)), opts);

  it("flags BOM and CRLF problems", () => {
    expect(checkL5X(full.slice(1)).join()).toMatch(/BOM/);
    expect(checkL5X(full.replace(/\r\n/g, "\n")).join()).toMatch(/CRLF/);
  });

  it("flags missing operand tags", () => {
    const bad = full.replace('<Tag Name="Tran_000"', '<Tag Name="Tran_xyz"');
    expect(checkL5X(bad).join("\n")).toMatch(/operand Tran_000 has no matching tag/);
  });

  it("flags step-to-step links, two initial steps, duplicate ids", () => {
    expect(checkL5X(full)).toEqual([]);
    expect(checkL5X(full.replace('FromID="1" ToID="11"', 'FromID="1" ToID="3"')).join("\n")).toMatch(/joins two Steps/);
    expect(checkL5X(full.replace('InitialStep="false"', 'InitialStep="true"')).join("\n")).toMatch(/exactly one initial/);
    expect(checkL5X(full.replace('<Leg ID="9"/>', '<Leg ID="8"/>')).join("\n")).toMatch(/duplicate ID 8/);
  });

  it("reports malformed XML", () => {
    expect(checkL5X("﻿<a>\r\n<b></a>").join()).toMatch(/XML error/);
  });
});

describe("real Studio export", () => {
  const real = readFileSync(new URL("../../legacy/tests/MainProgram.L5X", import.meta.url), "utf8");
  it("is parsed and passes the check", () => {
    expect(checkL5X(real)).toEqual([]);
  });
  it("reads structure", () => {
    const root = parseXml(real);
    expect(root.name).toBe("RSLogix5000Content");
    expect(root.attrs["SoftwareRevision"]).toBe("32.01");
    expect(descendants(root, "Step").length).toBeGreaterThan(3);
  });
});

describe("step name comments (nameComments, default on)", () => {
  const { graph, positions } = selection();
  const withNames = { ...opts, nameComments: true };
  const out = writeL5X(graph, positions, [tag("a"), tag("b"), tag("c"), tag("d"), tag("L"), tag("M")], withNames);
  const actions = descendants(parseXml(out), "Action");

  it("passes the self-check", () => expect(checkL5X(out)).toEqual([]));

  it("every step gets an action whose first line is the name comment", () => {
    expect(actions).toHaveLength(graph.steps.length);
    graph.steps.forEach((s, i) => {
      const first = blockText(descendants(actions[i]!, "Line")[0]!);
      expect(first.startsWith(`// ${s.name}`)).toBe(true);
    });
  });

  it("keeps the original action lines after the comment", () => {
    const all = actions.map((a) => descendants(a, "Line").map(blockText));
    const withCode = all.find((l) => l.includes("L[:=]1;"))!;
    expect(withCode[0]!.startsWith("// ")).toBe(true);
    expect(withCode.slice(1)).toEqual(["L[:=]1;", "// comment", "", "M[:=]0;"]);
  });

  it("is on by default", () => {
    const { nameComments: _ignored, ...defaults } = withNames;
    const d = writeL5X(graph, positions, [tag("a"), tag("b"), tag("c"), tag("d"), tag("L"), tag("M")], defaults);
    expect(d).toBe(out);
  });
});

describe("stepNameComment", () => {
  it("formats name and optional description on one line", async () => {
    const { stepNameComment } = await import("../../src/l5x/index.js");
    expect(stepNameComment("fill")).toBe("// fill");
    expect(stepNameComment("fill", "Fill the tank")).toBe("// fill - Fill the tank");
    expect(stepNameComment("fill", "two\nlines")).toBe("// fill - two lines");
  });
});
