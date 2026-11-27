import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile, exportL5X } from "../../src/compile.js";
import { LESSONS, REFERENCE, REFERENCE_GROUPS, findEntry, searchReference } from "../../app/help/content.js";
import { PROBLEM_GROUPS, findProblem } from "../../app/help/problems.js";
import { EXAMPLE_FILE, inline, learningPage, referencePage } from "../../app/help/page.js";

const problems = (src: string) => compile(src, { fileName: EXAMPLE_FILE }).diagnostics.map((d) => `${d.span.line}:${d.code} ${d.message}`);

describe("Help → Learning qSFC", () => {
  for (const l of LESSONS) {
    it(`${l.title}: ${l.broken ? "shows its problems" : "no problems"}`, () => {
      if (l.broken) {
        const codes = compile(l.example, { fileName: EXAMPLE_FILE }).diagnostics.map((d) => d.code);
        // the summary names the problems the example gives
        for (const [code] of l.summary) expect(codes).toContain(code);
        expect(problems(l.tries[0]!.solution!)).toEqual([]);
      } else expect(problems(l.example)).toEqual([]);
      expect(l.tries.length).toBeGreaterThan(0);
    });
  }
  it("ten lessons with unique ids", () => {
    expect(LESSONS).toHaveLength(10);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(10);
  });
});

describe("Help → Reference", () => {
  for (const e of REFERENCE) {
    it(`${e.title}: example without problems, links that exist`, () => {
      if (e.example) expect(problems(e.example)).toEqual([]);
      expect(e.rules.length).toBeGreaterThan(0);
      expect(e.rules.length).toBeLessThanOrEqual(5);
      for (const c of e.problems) expect(findProblem(c), c).toBeDefined();
      for (const id of e.see) expect(findEntry(id), id).toBeDefined();
      expect(REFERENCE_GROUPS).toContain(e.group as (typeof REFERENCE_GROUPS)[number]);
    });
  }
  it("search: the title first, then syntax, rules and codes", () => {
    expect(searchReference("select")[0]!.id).toBe("select");
    expect(searchReference("E303").map((e) => e.id)).toContain("jumps");
    expect(searchReference("")).toHaveLength(REFERENCE.length);
    expect(searchReference("zzzz")).toEqual([]);
  });
});

describe("Help → Problems: every code, with an example that gives it", () => {
  const specCodes = [...readFileSync("docs/SPEC.md", "utf8").matchAll(/^\| ([EW]\d{3}) \|/gm)].map((m) => m[1]!);
  it("lists every code of SPEC §9.2", () => {
    const listed = PROBLEM_GROUPS.flatMap((g) => g.items.map((p) => p.code));
    expect([...specCodes].sort()).toEqual([...listed].sort());
  });
  for (const g of PROBLEM_GROUPS) {
    for (const p of g.items) {
      it(`${p.code}`, () => {
        const d = p.exportOnly
          ? exportL5X(p.example, { fileName: EXAMPLE_FILE, ...(p.code === "E501" ? { softwareRevision: "32" } : {}) }).diagnostics
          : compile(p.example, { fileName: EXAMPLE_FILE }).diagnostics;
        expect(d.map((x) => x.code)).toContain(p.code);
      });
    }
  }
});

describe("Help pages", () => {
  it("inline text: backticks are code, the rest is escaped", () => {
    expect(inline("use `a < b` & more")).toBe("use <code>a &lt; b</code> &amp; more");
  });
  it("printable Learning and Reference pages hold every lesson and entry", () => {
    const learn = learningPage();
    for (const l of LESSONS) expect(learn).toContain(l.title);
    expect(learn).toContain("<svg");
    const ref = referencePage();
    for (const e of REFERENCE) expect(ref).toContain(`<h2>${e.title.replace(/&/g, "&amp;")}</h2>`);
    expect(ref).toContain("E604");
  });
  it("no product names in Learning", () => {
    const text = JSON.stringify(LESSONS);
    expect(text).not.toMatch(/studio|rockwell|logix|l5x/i);
  });
});
