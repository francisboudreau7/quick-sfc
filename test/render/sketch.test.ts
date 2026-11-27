import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { childElements, descendants, parseXml, type XmlElement } from "../../src/l5x/xml.js";
import { renderStudioSketch } from "../../src/render/sketch.js";
import { tidyL5X } from "../../src/tidy/index.js";

const files = ["legacy/tests/MainProgram.L5X", ...readdirSync("testpack").filter((f) => f.endsWith(".L5X")).map((f) => `testpack/${f}`)];

const count = (svg: string, re: RegExp): number => svg.match(re)?.length ?? 0;
const sfcOf = (text: string, name: string): XmlElement => {
  const r = descendants(parseXml(text), "Routine").find((x) => x.attrs["Type"] === "SFC" && x.attrs["Name"] === name)!;
  return descendants(r, "SFCContent")[0]!;
};

describe("renderStudioSketch", () => {
  for (const f of files) {
    it(`draws every SFC routine of ${f}, before and after Tidy`, () => {
      const before = readFileSync(f, "utf8");
      const result = tidyL5X(before);
      expect(result.routines.length).toBeGreaterThan(0);
      for (const text of [before, result.text]) {
        for (const r of result.routines) {
          const svg = renderStudioSketch(text, r.name);
          const sfc = sfcOf(text, r.name);
          const links = descendants(sfc, "DirectedLink");
          expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
          expect(count(svg, /class="sk-step"/g)).toBe(childElements(sfc, "Step").length);
          expect(count(svg, /class="sk-trans"/g)).toBe(childElements(sfc, "Transition").length);
          expect(count(svg, /class="sk-branch"/g)).toBe(childElements(sfc, "Branch").length);
          expect(count(svg, /class="sk-wire sk-hidden"[^>]*stroke-dasharray/g)).toBe(links.filter((l) => l.attrs["Show"] === "false").length);
          expect(count(svg, /class="sk-wire/g)).toBe(links.length);
          expect(svg).not.toContain("NaN");
        }
      }
    });
  }

  it("MainProgram: 20 steps, coordinates change with Tidy", () => {
    const before = readFileSync("legacy/tests/MainProgram.L5X", "utf8");
    const a = renderStudioSketch(before, "SFC");
    const b = renderStudioSketch(tidyL5X(before).text, "SFC");
    expect(count(a, /class="sk-step"/g)).toBe(20);
    expect(a).not.toBe(b);
  });

  it("themable: colors are CSS variables with fallbacks", () => {
    const svg = renderStudioSketch(readFileSync("testpack/tp05_jumps.L5X", "utf8"), "tp05_jumps");
    expect(svg).toContain("var(--surface,#fff)");
    expect(svg).toContain("var(--text,#1d2228)");
    expect(svg).not.toMatch(/(fill|stroke)="#/);
  });

  it("finds Program/Routine names and never throws", () => {
    const tp08 = readFileSync("testpack/tp08_routines.L5X", "utf8");
    const prog = /<Program\b[^>]*?\sName="([^"]*)"/.exec(tp08)![1]!;
    const unlabelled = (svg: string): string => svg.replace(/ aria-label="[^"]*"/, "");
    expect(unlabelled(renderStudioSketch(tp08, `${prog}/mixer`))).toBe(unlabelled(renderStudioSketch(tp08, "mixer")));
    expect(renderStudioSketch(tp08, "mixer")).toContain('class="sk-step"');
    const cases: Array<[string, string]> = [
      ["not xml <", "R"],
      ["<RSLogix5000Content/>", "R"],
      ['<Routine Name="R" Type="SFC"/>', "R"],
      ['<Routine Name="R" Type="SFC"><SFCContent/></Routine>', "R"],
      [
        '<Routine Name="R" Type="SFC"><SFCContent><Step ID="1" X="a"/><DirectedLink FromID="1" ToID="9"/><Branch ID="3"><Leg ID="4"/></Branch></SFCContent></Routine>',
        "R",
      ],
    ];
    for (const [xml, name] of cases) {
      expect(() => renderStudioSketch(xml, name)).not.toThrow();
      expect(renderStudioSketch(xml, name)).toMatch(/^<svg /);
    }
  });

  it("escapes texts", () => {
    const xml =
      '<Routine Name="R" Type="SFC"><SFCContent><Step ID="1" X="0" Y="0" Operand="a&lt;b"/><Transition ID="2" X="0" Y="100" Operand="T"><Condition><STContent><Line Number="0"><![CDATA[x < 1 & y]]></Line></STContent></Condition></Transition><DirectedLink FromID="1" ToID="2" Show="true"/></SFCContent></Routine>';
    const svg = renderStudioSketch(xml, "R");
    expect(svg).toContain("a&lt;b");
    expect(svg).toContain("x &lt; 1 &amp; y");
  });
});
