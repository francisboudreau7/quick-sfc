import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile.js";
import { headerOf, ioStateAfter, lineKind, tokenizeLine } from "../../app/highlight.js";
import { problemsText } from "../../app/problems.js";

describe("Problems: copy as text (I1)", () => {
  it("formats problems as the CLI prints them", () => {
    const diags = compile("init a\n  x := Step_003.Fo;\n-- tr1: go -> a\n").diagnostics;
    expect(problemsText(diags, "t.qsfc")).toBe(
      "t.qsfc:2:8: error E401: `Step_003.Fo`: steps have no member `Fo` (did you mean `FS`?)",
    );
    const two = compile("tag x : TIMER\ntag y : DINT\ninit a\n-- go -> a\n").diagnostics;
    expect(problemsText(two, "t.qsfc").split("\n")).toHaveLength(two.length);
  });
});

describe("highlighting: controller block, uses, sfc tags", () => {
  it("controller opens a block like io; sfc tags is not a routine header", () => {
    expect(lineKind("controller").kind).toBe("io");
    expect(ioStateAfter("controller", false)).toBe(true);
    expect(lineKind("  sfc tags a, b").kind).toBe("tag");
    expect(headerOf("  sfc tags a, b")).toBeUndefined();
    expect(headerOf("sfc fill")).toEqual({ keyword: "sfc", name: "fill" });
  });

  it("uses is a header line; uses := 1; is ST", () => {
    expect(lineKind("uses INIT, Main (main)").kind).toBe("meta");
    expect(lineKind("uses := 1;").kind).toBe("action");
    expect(tokenizeLine("uses INIT")[0]).toMatchObject({ from: 0, to: 4, kind: "kw" });
  });
});
