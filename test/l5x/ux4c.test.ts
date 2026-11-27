/** Phase 4c through the export: Program description, alias tags, `after` and readable members (SPEC §8). */
import { describe, expect, it } from "vitest";
import { exportL5X } from "../../src/compile.js";
import { checkL5X } from "../../src/l5x/index.js";
import { blockText, descendants, parseXml } from "../../src/l5x/xml.js";
import { rewriteAfter, rewriteStepRefs } from "../../src/tags/index.js";
import { parse } from "../../src/parse/index.js";
import type { TransitionNode } from "../../src/model/ast.js";
import { DATE } from "./helpers.js";

const src = (...lines: string[]): string => lines.join("\n");
const exp = (s: string): string => {
  const r = exportL5X(s, { fileName: "t.qsfc", exportDate: DATE });
  if (!r.text) throw new Error(r.diagnostics.map((d) => `${d.code} ${d.message}`).join("\n"));
  expect(checkL5X(r.text)).toEqual([]);
  return r.text;
};
const lines = (xml: string): string[] => xml.replace(/^﻿/, "").split("\r\n");
const conditions = (xml: string): string[] =>
  descendants(parseXml(xml), "Condition").map((c) => blockText(descendants(c, "Line")[0]!));
const actionLines = (xml: string): string[] => descendants(parseXml(xml), "Action").flatMap((a) => descendants(a, "Line").map(blockText));
const chart = "init a\n-- go -> a";

describe("L5X: program title and header lines", () => {
  it("the title is the Program's description, right after the <Program> start tag", () => {
    const l = lines(exp(src('program tank "Tank filling"', 'course "GEI-243"', 'author "Me"', chart)));
    const at = l.findIndex((x) => x.startsWith("<Program Use=\"Target\""));
    expect(l.slice(at + 1, at + 5)).toEqual(["<Description>", "<![CDATA[Tank filling]]>", "</Description>", "<Tags>"]);
  });

  it("course and author are not exported; no title means no description", () => {
    const t = exp(src('course "GEI-243"', 'author "Me"', chart));
    expect(t).not.toContain("GEI-243");
    expect(t).not.toContain("Me]]");
    const l = lines(t);
    const at = l.findIndex((x) => x.startsWith("<Program Use=\"Target\""));
    expect(l[at + 1]).toBe("<Tags>");
    // and the file is the same as without the header lines
    expect(t).toBe(exp(chart));
  });
});

describe("L5X: io block as alias tags", () => {
  const s = src(
    "io",
    '  start_btn  Local:1:I.Data.0  "Start button"',
    "  valve      Local:2:O.Data.3",
    "  level      Local:3:I.Ch0Data",
    "  spare      Rack1:I.Data[2].5",
    "end",
    "init a",
    "  on valve",
    "-- start_btn AND level > 10 -> a",
  );

  it("writes an alias tag per I/O point: Radix Decimal as Studio writes it, description inside", () => {
    const l = lines(exp(s));
    const tag = (name: string): string[] => {
      const i = l.findIndex((x) => x.startsWith(`<Tag Name="${name}"`));
      return l[i]!.endsWith("/>") ? [l[i]!] : l.slice(i, l.indexOf("</Tag>", i) + 1);
    };
    expect(tag("start_btn")).toEqual([
      '<Tag Name="start_btn" TagType="Alias" Radix="Decimal" AliasFor="Local:1:I.Data.0" ExternalAccess="Read/Write">',
      "<Description>",
      "<![CDATA[Start button]]>",
      "</Description>",
      "</Tag>",
    ]);
    expect(tag("valve")).toEqual(['<Tag Name="valve" TagType="Alias" Radix="Decimal" AliasFor="Local:2:O.Data.3" ExternalAccess="Read/Write"/>']);
    expect(tag("level")).toEqual(['<Tag Name="level" TagType="Alias" Radix="Decimal" AliasFor="Local:3:I.Ch0Data" ExternalAccess="Read/Write"/>']);
    // an unused point is exported too
    expect(tag("spare")).toEqual(['<Tag Name="spare" TagType="Alias" Radix="Decimal" AliasFor="Rack1:I.Data[2].5" ExternalAccess="Read/Write"/>']);
  });

  it("lists the modules of the addresses as references, once each, sorted", () => {
    const l = lines(exp(s));
    const at = l.indexOf('<Modules Use="Context">');
    expect(l.slice(at, at + 6)).toEqual([
      '<Modules Use="Context">',
      '<Module Use="Reference" Name="Local">',
      "</Module>",
      '<Module Use="Reference" Name="Rack1">',
      "</Module>",
      "</Modules>",
    ]);
  });

  it("no io block: the Modules context stays empty", () => {
    const l = lines(exp(chart));
    const at = l.indexOf('<Modules Use="Context">');
    expect(l[at + 1]).toBe("</Modules>");
  });

  it("an error in the io block blocks the export", () => {
    const r = exportL5X(src("io", "  b Local1", "end", chart), { fileName: "t.qsfc", exportDate: DATE });
    expect(r.text).toBeUndefined();
    expect(r.diagnostics.map((d) => d.code)).toEqual(["E413"]);
  });
});

describe("L5X: after in a condition", () => {
  it("becomes `<step>.T >= ms` with the step's operand, inside select legs too", () => {
    const t = exp(src(
      "init idle",
      "-- start",
      "step fill",
      "-- after 5s AND level_ok",
      "step check",
      "select",
      "  -- after 1m",
      "  step ok",
      "  -- ok.done OR after 500ms -> idle",
      "|",
      "  -- NOT after 2s AND x",
      "  step bad",
      "  -- (after 1s) -> idle",
      "end",
    ));
    expect(conditions(t)).toEqual([
      "start",
      "Step_001.T >= 5000 AND level_ok",
      "Step_002.T >= 60000",
      "Step_003.DN OR Step_003.T >= 500",
      "NOT (Step_002.T >= 2000) AND x",
      "(Step_004.T >= 1000)",
    ]);
  });

  it("rewriteAfter: parentheses only where precedence needs them", () => {
    const t = (c: string): string => {
      const node = parse(`init a\n-- ${c}\nstep b\n-- x -> a`).chart.body[1] as TransitionNode;
      return rewriteAfter(node.condition.text, node.after, "fill");
    };
    expect(t("after 5s")).toBe("fill.T >= 5000");
    expect(t("a OR after 5s")).toBe("a OR fill.T >= 5000");
    expect(t("a XOR after 5s & b")).toBe("a XOR fill.T >= 5000 & b");
    expect(t("NOT after 5s")).toBe("NOT (fill.T >= 5000)");
    expect(t("after 5s = b")).toBe("(fill.T >= 5000) = b");
    expect(t("x and   after 2s   OR y")).toBe("x and   fill.T >= 2000   OR y");
    expect(rewriteAfter("after 5s", undefined, "fill")).toBe("after 5s");
  });
});

describe("L5X: readable step members", () => {
  it("are rewritten to Studio's members in conditions, actions and ST routines", () => {
    const t = exp(src(
      "st main",
      "  call seq;",
      "  lamp := fill.ACTIVE OR fill.Done;",
      "sfc seq",
      "init idle",
      "  IF idle.first THEN n := fill.time; END_IF;",
      "-- go",
      "step fill 3s",
      "-- fill.done AND fill . active AND fill.T > 0 -> idle",
    ));
    expect(conditions(t)).toEqual(["go", "Step_001.DN AND Step_001 . X AND Step_001.T > 0"]);
    expect(actionLines(t)).toContain("IF Step_000.FS THEN n := Step_001.T; END_IF;");
    const st = descendants(parseXml(t), "Routine").find((r) => r.attrs["Type"] === "ST")!;
    expect(descendants(st, "Line").map(blockText)).toEqual(["JSR(seq,0);", "lamp := Step_001.X OR Step_001.DN;"]);
  });

  it("rewriteStepRefs leaves other members, tags with those members, strings and comments alone", () => {
    const ops = new Map([["fill", "Step_001"]]);
    expect(rewriteStepRefs("fill.dn + fill.Count", ops)).toBe("Step_001.dn + Step_001.Count");
    expect(rewriteStepRefs("tmr.done AND x.active", ops)).toBe("tmr.done AND x.active");
    expect(rewriteStepRefs("s := 'fill.done'; // fill.done", ops)).toBe("s := 'fill.done'; // fill.done");
  });
});
