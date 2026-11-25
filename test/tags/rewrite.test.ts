import { describe, expect, it } from "vitest";
import { rewriteStepRefs } from "../../src/tags/index.js";

const map = new Map([
  ["fill", "Step_001"],
  ["idle", "Step_000"],
]);
const rw = (s: string): string => rewriteStepRefs(s, map);

describe("rewriteStepRefs", () => {
  it("rewrites stepname.member", () => {
    expect(rw("fill.DN")).toBe("Step_001.DN");
    expect(rw("fill.DN AND idle.X")).toBe("Step_001.DN AND Step_000.X");
    expect(rw("x := fill.T + 1;")).toBe("x := Step_001.T + 1;");
  });
  it("is case-insensitive on the step name and keeps the member as written", () => {
    expect(rw("FILL.dn")).toBe("Step_001.dn");
    expect(rw("Fill.Dn")).toBe("Step_001.Dn");
  });
  it("is identifier-aware", () => {
    expect(rw("refill.DN")).toBe("refill.DN");
    expect(rw("fill2.DN")).toBe("fill2.DN");
    expect(rw("_fill.DN")).toBe("_fill.DN");
    expect(rw("fill_.DN")).toBe("fill_.DN");
    expect(rw("a.fill.DN")).toBe("a.fill.DN");
  });
  it("leaves a step name without member, and function calls, alone", () => {
    expect(rw("fill")).toBe("fill");
    expect(rw("fill(1)")).toBe("fill(1)");
    expect(rw("fill AND x")).toBe("fill AND x");
  });
  it("allows spaces around the dot", () => {
    expect(rw("fill . DN")).toBe("Step_001 . DN");
  });
  it("skips ST strings", () => {
    expect(rw("msg := 'fill.DN'; x := fill.DN;")).toBe("msg := 'fill.DN'; x := Step_001.DN;");
    expect(rw('"fill.DN" fill.X')).toBe('"fill.DN" Step_001.X');
    expect(rw("'it$'s fill.DN' fill.X")).toBe("'it$'s fill.DN' Step_001.X");
  });
  it("skips line comments", () => {
    expect(rw("fill.DN // fill.DN\nfill.X")).toBe("Step_001.DN // fill.DN\nStep_001.X");
  });
  it("skips block comments, also across lines", () => {
    expect(rw("(* fill.DN *) fill.DN")).toBe("(* fill.DN *) Step_001.DN");
    expect(rw("a;\n(* old:\n fill.DN\n*)\nfill.DN;")).toBe("a;\n(* old:\n fill.DN\n*)\nStep_001.DN;");
    expect(rw("(* never closed fill.DN")).toBe("(* never closed fill.DN");
  });
  it("an unterminated string ends with its line", () => {
    expect(rw("'oops fill.DN\nfill.DN")).toBe("'oops fill.DN\nStep_001.DN");
  });
  it("does not touch numbers, typed literals and based literals", () => {
    expect(rw("16#FF_FF + 2.0E3 + 2#1010 + 1.5")).toBe("16#FF_FF + 2.0E3 + 2#1010 + 1.5");
    expect(rw("T#5s fill.DN")).toBe("T#5s Step_001.DN");
    expect(rw("x.0 := fill.X;")).toBe("x.0 := Step_001.X;");
  });
  it("keeps everything else byte-identical (CRLF, tabs, odd characters)", () => {
    const src = "\tIF fill.DN THEN\r\n\t  y [:=] 1;\r\nEND_IF;  éè {x}\r\n";
    expect(rw(src)).toBe(src.replace("fill", "Step_001"));
    expect(rw("")).toBe("");
  });
  it("empty map is the identity", () => {
    const s = "fill.DN AND (* c *) 'x'";
    expect(rewriteStepRefs(s, new Map())).toBe(s);
  });
  it("rewrites every occurrence", () => {
    expect(rw("fill.DN OR fill.DN OR (fill.X)")).toBe("Step_001.DN OR Step_001.DN OR (Step_001.X)");
  });
});
