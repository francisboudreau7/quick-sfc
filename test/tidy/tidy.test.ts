import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportL5X } from "../../src/compile.js";
import { checkL5X } from "../../src/l5x/index.js";
import { tidyL5X } from "../../src/tidy/index.js";
import { syntheticCharts, validCharts } from "../layout/helpers.js";

const exported = (source: string, name: string): string => {
  const r = exportL5X(source, { fileName: `${name.replace(/^.*\//, "")}.qsfc`, exportDate: new Date(2026, 0, 1) });
  if (r.text === undefined) throw new Error(`no export for ${name}`);
  return r.text;
};

/** Deterministic pseudo-random scramble of every coordinate and Show flag of the SFC elements. */
function scramble(text: string, seed: number): string {
  let s = seed;
  const rnd = (n: number): number => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s % n;
  };
  return text.replace(/<(Step|Transition|Branch|DirectedLink)\b[^>]*>/g, (tag) => {
    // a description box keeps its offset from its element (Tidy keeps it too)
    const dx = rnd(2000) - 1000;
    const dy = rnd(2000) - 1000;
    return tag
      .replace(/\b(X|DescX)="(-?\d+)"/g, (_m, a: string, v: string) => `${a}="${Number(v) + dx}"`)
      .replace(/\b(Y|DescY)="(-?\d+)"/g, (_m, a: string, v: string) => `${a}="${Number(v) + dy}"`)
      .replace(/\bShow="(true|false)"/, () => `Show="${rnd(2) ? "true" : "false"}"`);
  });
}

/** The text with every value Tidy may change blanked out. */
function blanked(text: string): string {
  return text.replace(/<(Step|Transition|Stop|Branch|TextBox|DirectedLink)\b[^>]*>/g, (tag) =>
    tag.replace(/\b(X|Y|DescX|DescY|Show)="[^"]*"/g, '$1=""'),
  );
}

const links = (text: string): string[] => [...text.matchAll(/<DirectedLink FromID="(\d+)" ToID="(\d+)"/g)].map((m) => `${m[1]}>${m[2]}`);

describe("tidy: qSFC's own export is reproduced exactly (oracle)", () => {
  for (const { name, source } of validCharts()) {
    it(name, () => {
      const text = exported(source, name);
      const same = tidyL5X(text);
      expect(same.error).toBeUndefined();
      for (const r of same.routines) expect([r.name, r.status, r.moved]).toEqual([r.name, "unchanged", 0]);
      expect(same.text).toBe(text);

      for (const seed of [1, 7, 42]) {
        const messy = scramble(text, seed);
        const back = tidyL5X(messy);
        expect(back.routines.map((r) => r.status)).toEqual(same.routines.map(() => "tidied"));
        expect(back.text).toBe(text);
      }
    });
  }
});

describe("tidy: synthetic edge cases", () => {
  for (const { name, source } of syntheticCharts) {
    it(name, () => {
      const text = exported(source, name);
      const back = tidyL5X(scramble(text, 11));
      expect(back.routines[0]!.status).toBe("tidied");
      expect(links(back.text)).toEqual(links(text));
      expect(blanked(back.text)).toBe(blanked(text));
      // `-- ack -> work` right above `step work` (W301) reads the same as `-- ack` + `step work`:
      // Tidy picks the form without the jump, so this one chart comes back laid out differently.
      if (name === "synthetic/chains-and-jogs") expect(back.text).not.toBe(text);
      else expect(back.text).toBe(text);
    });
  }
});

describe("tidy: idempotence", () => {
  it("tidy(tidy(x)) === tidy(x)", () => {
    const inputs = [
      readFileSync("legacy/tests/MainProgram.L5X", "utf8"),
      ...validCharts().map(({ name, source }) => scramble(exported(source, name), 3)),
    ];
    for (const x of inputs) {
      const once = tidyL5X(x).text;
      const twice = tidyL5X(once);
      expect(twice.text).toBe(once);
      expect(twice.routines.every((r) => r.status === "unchanged")).toBe(true);
    }
  });
});

describe("tidy: a real Studio export (legacy/tests/MainProgram.L5X)", () => {
  const original = readFileSync("legacy/tests/MainProgram.L5X", "utf8");
  const result = tidyL5X(original);

  it("is tidied and still passes the self-check", () => {
    expect(result.routines).toEqual([{ name: "SFC", status: "tidied", moved: 45, hidden: 0 }]);
    expect(result.text).not.toBe(original);
    expect(checkL5X(result.text)).toEqual([]);
  });

  it("keeps every byte outside the coordinates and Show flags (BOM, CRLF, Studio's line wraps)", () => {
    expect(result.text.startsWith("﻿")).toBe(true);
    expect(blanked(result.text)).toBe(blanked(original));
    expect(result.text.length - original.length).toBeLessThan(200);
  });

  it("keeps the links", () => {
    expect(links(result.text)).toEqual(links(original));
  });

  it("puts the main line in one column", () => {
    const x = (id: number) => Number(new RegExp(`<Step ID="${id}" X="(\\d+)"`).exec(result.text)![1]);
    // init -> Step_001 -> Step_002 -> ... down the left column
    expect(new Set([0, 2, 4, 8, 10, 12, 14, 15].map(x))).toEqual(new Set([200]));
  });
});

// ---- hand-written charts ---------------------------------------------------------------------

const step = (id: number, x: number, y: number, initial = false) =>
  `<Step ID="${id}" X="${x}" Y="${y}" Operand="Step_${String(id).padStart(3, "0")}" HideDesc="false" DescX="${x + 40}" DescY="${y - 20}" DescWidth="0" InitialStep="${initial}" PresetUsesExpr="false" LimitHighUsesExpr="false" LimitLowUsesExpr="false" ShowActions="true"/>`;
const tran = (id: number, x: number, y: number) =>
  [
    `<Transition ID="${id}" X="${x}" Y="${y}" Operand="Tran_${String(id).padStart(3, "0")}" HideDesc="false" DescX="${x + 60}" DescY="${y - 20}" DescWidth="0">`,
    "<Condition>",
    "<STContent>",
    '<Line Number="0">',
    "<![CDATA[1]]>",
    "</Line>",
    "</STContent>",
    "</Condition>",
    "</Transition>",
  ].join("\r\n");
const branch = (id: number, y: number, type: "Selection" | "Simultaneous", flow: "Diverge" | "Converge", legs: number[]) =>
  [
    `<Branch ID="${id}" Y="${y}" BranchType="${type}" BranchFlow="${flow}"${type === "Selection" && flow === "Diverge" ? ' Priority="Default"' : ""}>`,
    ...legs.map((l) => `<Leg ID="${l}"/>`),
    "</Branch>",
  ].join("\r\n");
const link = (a: number, b: number) => `<DirectedLink FromID="${a}" ToID="${b}" Show="true"/>`;

function l5x(...sfc: string[]): string {
  return (
    "﻿" +
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="32.01" TargetName="P" TargetType="Program" ContainsContext="true">',
      '<Controller Use="Context" Name="C">',
      '<Programs Use="Context">',
      '<Program Use="Target" Name="P" MainRoutineName="Main">',
      "<Routines>",
      '<Routine Name="Main" Type="SFC">',
      '<SFCContent SheetSize="Letter - 8.5 x 11 in" SheetOrientation="Landscape" StepName="Step" TransitionName="Tran" ActionName="Action" StopName="Stop">',
      ...sfc,
      "</SFCContent>",
      "</Routine>",
      "</Routines>",
      "</Program>",
      "</Programs>",
      "</Controller>",
      "</RSLogix5000Content>",
    ].join("\r\n")
  );
}

describe("tidy: charts qSFC can't represent are left untouched", () => {
  it("a jump into a parallel leg", () => {
    // init 0 -- 10 -- parallel [1 -- 11 -- (conv 30) 2 | 3] -- 12 -- 4 select [-- 13 -> 0 | -- 14 -> 2]
    const text = l5x(
      step(0, 200, 100, true), step(1, 200, 300), step(2, 200, 500), step(3, 500, 300), step(4, 200, 800),
      tran(10, 200, 200), tran(11, 200, 400), tran(12, 200, 700), tran(13, 200, 900), tran(14, 500, 900),
      branch(20, 250, "Simultaneous", "Diverge", [21, 22]),
      branch(30, 450, "Selection", "Converge", [31, 32]),
      branch(40, 600, "Simultaneous", "Converge", [41, 42]),
      branch(50, 850, "Selection", "Diverge", [51, 52]),
      link(0, 10), link(10, 20), link(21, 1), link(22, 3), link(1, 11), link(11, 31), link(30, 2), link(2, 41), link(3, 42),
      link(40, 12), link(12, 4), link(4, 50), link(51, 13), link(52, 14), link(13, 0), link(14, 32),
    );
    expect(checkL5X(text).filter((p) => !p.includes("operand"))).toEqual([]);
    const r = tidyL5X(text);
    expect(r.routines).toHaveLength(1);
    expect(r.routines[0]!.status).toBe("skipped");
    expect(r.routines[0]!.reason).toMatch(/parallel/);
    expect(r.text).toBe(text);
  });

  it("two incoming wires without a converge", () => {
    const text = l5x(step(0, 200, 100, true), step(1, 200, 300), tran(10, 200, 200), tran(11, 200, 400), link(0, 10), link(10, 1), link(1, 11), link(11, 1));
    const r = tidyL5X(text);
    expect(r.routines[0]).toMatchObject({ status: "skipped", reason: "step Step_001 has several incoming wires without a selection converge in front of it" });
    expect(r.text).toBe(text);
  });

  it("an element Tidy does not know", () => {
    const text = l5x(step(0, 200, 100, true), "<Frobnicator ID=\"9\"/>");
    expect(tidyL5X(text).routines[0]).toMatchObject({ status: "skipped", reason: "the chart has a <Frobnicator> element that Tidy does not know" });
  });

  it("text that is not XML", () => {
    const r = tidyL5X("<RSLogix5000Content><Routine>");
    expect(r.error).toMatch(/not valid XML/);
    expect(r.routines).toEqual([]);
    expect(r.text).toBe("<RSLogix5000Content><Routine>");
  });

  it("only the broken routine is skipped", () => {
    const good = exported(validCharts().find((c) => c.name === "testpack/tp08_routines")!.source, "tp08_routines");
    const messy = scramble(good, 5);
    const broken = messy.replace(/(<SFCContent[^>]*>)/, "$1\r\n<Frobnicator/>");
    const r = tidyL5X(broken);
    expect(r.routines.map((x) => x.status)).toEqual(["skipped", "tidied"]);
    const first = (t: string) => t.slice(0, t.indexOf("</SFCContent>"));
    expect(first(r.text)).toBe(first(broken));
  });
});

describe("tidy: Stop elements and text boxes (formats assumed, not verified in Studio)", () => {
  // init 0 -- 10 -- 1 -- 11 -- Stop 2; text box 70 attached to step 1, text box 71 alone
  const text = l5x(
    step(0, 900, 900, true),
    step(1, 120, 4000),
    '<Stop ID="2" X="40" Y="40" Operand="Stop_000" HideDesc="false" DescX="80" DescY="20" DescWidth="0"/>',
    tran(10, 333, 333),
    tran(11, 555, 555),
    '<TextBox ID="70" X="300" Y="4010" Width="100">',
    "<Text>",
    "<![CDATA[note on step 1]]>",
    "</Text>",
    "</TextBox>",
    '<TextBox ID="71" X="1000" Y="1000" Width="100">',
    "<Text>",
    "<![CDATA[free note]]>",
    "</Text>",
    "</TextBox>",
    '<Attachment FromID="70" ToID="1"/>',
    link(0, 10),
    link(10, 1),
    link(1, 11),
    link(11, 2),
  );
  const r = tidyL5X(text);

  it("lays the Stop out as the last step of the chain", () => {
    expect(r.routines[0]).toMatchObject({ status: "tidied", hidden: 0 });
    expect(r.text).toContain('<Step ID="0" X="200" Y="100"');
    expect(r.text).toContain('<Step ID="1" X="200" Y="340"');
    expect(r.text).toContain('<Stop ID="2" X="200" Y="580" Operand="Stop_000" HideDesc="false" DescX="240" DescY="560"');
  });

  it("moves an attached text box with its element and leaves a free one", () => {
    // step 1 moved by (+80, -3660)
    expect(r.text).toContain('<TextBox ID="70" X="380" Y="350" Width="100">');
    expect(r.text).toContain('<TextBox ID="71" X="1000" Y="1000" Width="100">');
    expect(blanked(r.text)).toBe(blanked(text));
    expect(tidyL5X(r.text).text).toBe(r.text);
  });
});

describe("CLI: qsfc tidy", () => {
  const dir = mkdtempSync(join(tmpdir(), "qsfc-tidy-"));
  const run = (...args: string[]): { code: number; out: string } => {
    try {
      const out = execFileSync(process.execPath, ["--import", "tsx", "src/cli/main.ts", ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      return { code: err.status, out: err.stdout + err.stderr };
    }
  };

  it("writes the tidied file and reports each routine", () => {
    const out = join(dir, "main.L5X");
    const r = run("tidy", "legacy/tests/MainProgram.L5X", "-o", out);
    expect(r.code).toBe(0);
    expect(r.out).toContain("SFC: tidied, 45 element(s) moved, 0 hidden wire(s)");
    expect(readFileSync(out, "utf8")).toBe(tidyL5X(readFileSync("legacy/tests/MainProgram.L5X", "utf8")).text);
  });

  it("defaults to <in>_tidy.L5X and says when a routine is already tidy", () => {
    const input = join(dir, "tp03.L5X");
    writeFileSync(input, exported(validCharts().find((c) => c.name === "testpack/tp03_parallel")!.source, "tp03"), "utf8");
    const r = run("tidy", input);
    expect(r.code).toBe(0);
    expect(r.out).toContain("tp03_parallel: unchanged (already tidy)");
    expect(readFileSync(join(dir, "tp03_tidy.L5X"), "utf8")).toBe(readFileSync(input, "utf8"));
  });

  it("exit 1 when nothing can be tidied, 2 on usage and file errors", () => {
    const bad = join(dir, "bad.L5X");
    writeFileSync(bad, l5x(step(0, 200, 100, true), "<Frobnicator/>"), "utf8");
    const r = run("tidy", bad, "-o", join(dir, "never.L5X"));
    expect(r.code).toBe(1);
    expect(r.out).toContain("Main: skipped, the chart has a <Frobnicator> element that Tidy does not know");
    expect(() => readFileSync(join(dir, "never.L5X"))).toThrow();
    expect(run("tidy").code).toBe(2);
    expect(run("tidy", join(dir, "missing.L5X")).code).toBe(2);
    expect(run("tidy", bad, "--program", "x").code).toBe(2);
  });
});
