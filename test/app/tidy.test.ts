import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tidyL5X, type TidyReport } from "../../src/tidy/index.js";
import { canTick, decodeL5X, defaultTicked, looksLikeL5X, programsLabel, statusLine, tidiedText, tidyFileName, tidyProblem } from "../../app/tidy.js";

const MAIN = "legacy/tests/MainProgram.L5X";
const report = (status: TidyReport["status"], extra: Partial<TidyReport> = {}): TidyReport => ({ name: "R", status, moved: 0, hidden: 0, ...extra });

describe("tidy file names", () => {
  it("names the tidied copy", () => {
    expect(tidyFileName("MainProgram.L5X")).toBe("MainProgram_tidy.L5X");
    expect(tidyFileName("C:\\plc\\line 2.l5x")).toBe("line 2_tidy.L5X");
    expect(tidyFileName("/x/export.xml")).toBe("export.xml_tidy.L5X");
    expect(tidyFileName(".L5X")).toBe("program_tidy.L5X");
  });
  it("recognizes L5X files", () => {
    expect(looksLikeL5X("a.L5X")).toBe(true);
    expect(looksLikeL5X("a.l5x")).toBe(true);
    expect(looksLikeL5X("a.qsfc")).toBe(false);
    expect(looksLikeL5X("a.L5X.txt")).toBe(false);
  });
});

describe("tidy dialog texts", () => {
  it("status lines", () => {
    expect(statusLine(report("tidied", { moved: 45, hidden: 0 }))).toEqual({ text: "tidied: 45 elements moved, 0 wires hidden", kind: "ok" });
    expect(statusLine(report("tidied", { moved: 1, hidden: 1 })).text).toBe("tidied: 1 element moved, 1 wire hidden");
    expect(statusLine(report("unchanged", { hidden: 2 }))).toEqual({ text: "already tidy", kind: "same" });
    expect(statusLine(report("skipped", { reason: "a jump enters a parallel branch" }))).toEqual({
      text: "left as it is: a jump enters a parallel branch",
      kind: "skip",
    });
  });
  it("only tidied routines can be ticked, and they are by default", () => {
    const rs = [report("tidied", { name: "A" }), report("unchanged", { name: "B" }), report("skipped", { name: "C" })];
    expect(rs.map(canTick)).toEqual([true, false, false]);
    expect(defaultTicked(rs)).toEqual(["A"]);
  });
  it("program label", () => {
    expect(programsLabel(readFileSync(MAIN, "utf8"))).toBe("program MainProgram");
    expect(programsLabel('<Program Use="Target"\n Name="A"><Program Name="B"><Program Name="A">')).toBe("programs A, B");
    expect(programsLabel("<Routine/>")).toBe("");
  });
  it("problems that keep the dialog closed", () => {
    expect(tidyProblem("x.L5X", tidyL5X("not xml <"))).toMatch(/^x\.L5X can't be tidied: the file is not valid XML/);
    expect(tidyProblem("x.L5X", tidyL5X("<RSLogix5000Content/>"))).toBe("x.L5X has no SFC routine to tidy");
    expect(tidyProblem("x.L5X", tidyL5X(readFileSync(MAIN, "utf8")))).toBeUndefined();
  });
});

describe("saved text", () => {
  const bytes = readFileSync(MAIN);
  const original = decodeL5X(bytes);

  it("decoding keeps the BOM and CRLF", () => {
    expect(original.charCodeAt(0)).toBe(0xfeff);
    expect(original).toBe(bytes.toString("utf8"));
    expect(original).toContain("\r\n");
  });

  it("every tidied routine ticked: exactly tidyL5X(original).text, BOM and CRLF kept", () => {
    const full = tidyL5X(original);
    const out = tidiedText(original, defaultTicked(full.routines));
    expect(out).toBe(full.text);
    expect(out).not.toBe(original);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.split("\r\n").length).toBe(original.split("\r\n").length);
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    // written as is, the bytes start with the UTF-8 BOM
    expect([...new TextEncoder().encode(out).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("nothing ticked: the original text", () => {
    expect(tidiedText(original, [])).toBe(original);
  });
});
