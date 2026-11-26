import { describe, expect, it } from "vitest";
import { completeLine, STEP_MEMBERS, type CompletionInfo } from "../../app/complete.js";

const info: CompletionInfo = {
  steps: [
    { name: "idle", initial: true },
    { name: "fill", presetMs: 5000, description: "Fill the tank" },
    { name: "check" },
  ],
  tags: [
    { name: "start_btn", type: "BOOL", declared: false, uses: [{ line: 3, col: 4 }, { line: 9, col: 4 }] },
    { name: "count", type: "DINT", declared: true, description: "Parts", uses: [{ line: 7, col: 3 }] },
    { name: "tmr", type: "TIMER", declared: true, uses: [{ line: 8, col: 4 }] },
    { name: "mot", type: "BOOL", declared: false, uses: [{ line: 12, col: 3 }] },
  ],
};

/** Completes at the `|` marker in `text`. */
function at(text: string, opts: { explicit?: boolean; lineNumber?: number } = {}) {
  const pos = text.indexOf("|");
  const line = text.slice(0, pos) + text.slice(pos + 1);
  const r = completeLine(line, pos, info, opts);
  return r && { ...r, labels: r.options.map((o) => o.label), word: line.slice(r.from, r.to) };
}

describe("keywords at the start of a line", () => {
  it("offers the structure keywords while typing the first word", () => {
    const r = at("  st|");
    expect(r?.from).toBe(2);
    expect(r?.word).toBe("st");
    for (const k of ["init", "step", "select", "parallel", "end", "tag", "sfc", "--"]) expect(r?.labels).toContain(k);
    expect(r?.options.find((o) => o.label === "step")?.apply).toBe("step ");
  });

  it("also offers tags there (the line may be an action line)", () => {
    expect(at("  sta|")?.labels).toContain("start_btn");
  });

  it("offers `--` after one or two dashes", () => {
    expect(at("-|")?.labels).toEqual(["--"]);
    expect(at("  --|")?.labels).toEqual(["--"]);
    expect(at("  --|")?.from).toBe(2);
  });

  it("an empty line completes only on request (Ctrl+Space)", () => {
    expect(at("  |")).toBeNull();
    expect(at("  |", { explicit: true })?.labels).toContain("step");
  });
});

describe("step names after ->", () => {
  it("lists every step, with or without a space or prefix", () => {
    expect(at("-- done ->|")?.labels).toEqual(["idle", "fill", "check"]);
    expect(at("-- done -> |")?.labels).toEqual(["idle", "fill", "check"]);
    const r = at("  -- x: a AND b -> fi|");
    expect(r?.word).toBe("fi");
    expect(r?.labels).toContain("fill");
    expect(r?.options.find((o) => o.label === "fill")).toMatchObject({ detail: "step · 5s", info: "Fill the tank" });
    expect(r?.options.find((o) => o.label === "idle")?.detail).toBe("initial step");
  });

  it("nothing after the target or inside a comment", () => {
    expect(at("-- a -> idle |")).toBeNull();
    expect(at("-- a // -> |")).toBeNull();
  });
});

describe("step members after name.", () => {
  it("lists the SFC_STEP members with descriptions", () => {
    const r = at("-- fill.|");
    expect(r?.labels).toEqual(STEP_MEMBERS.map((m) => m.name));
    expect(r?.options.find((o) => o.label === "X")?.detail).toBe("step active");
    expect(r?.options.find((o) => o.label === "DN")?.detail).toBe("timer done");
    expect(r?.from).toBe(8);
  });

  it("is case-insensitive and keeps the typed member prefix", () => {
    const r = at("  x := FILL.d|");
    expect(r?.word).toBe("d");
    expect(r?.labels).toContain("DN");
  });

  it("warns in the info when DN is used on a step without preset", () => {
    const dn = at("-- check.|")?.options.find((o) => o.label === "DN");
    expect(dn?.info).toContain("W302");
    expect(at("-- fill.|")?.options.find((o) => o.label === "DN")?.info).not.toContain("W302");
  });

  it("TIMER tags get timer members; other tags none", () => {
    expect(at("-- tmr.|")?.labels).toEqual(["DN", "TT", "EN", "PRE", "ACC"]);
    expect(at("-- start_btn.|")).toBeNull();
  });
});

describe("tags and keywords in conditions and actions", () => {
  it("conditions: tags, steps and Boolean keywords", () => {
    const r = at("-- start_btn AND co|");
    expect(r?.word).toBe("co");
    expect(r?.labels).toEqual(expect.arrayContaining(["start_btn", "count", "fill", "AND", "NOT", "TRUE"]));
    expect(r?.labels).not.toContain("END_IF");
    expect(r?.options.find((o) => o.label === "count")).toMatchObject({ detail: "DINT (declared)", info: "Parts" });
  });

  it("actions: ST keywords too", () => {
    const r = at("  IF x THEN c|");
    expect(r?.labels).toEqual(expect.arrayContaining(["count", "END_IF", "ELSE"]));
  });

  it("leaves out a tag that is only the word being typed", () => {
    expect(at("  x := mo|", { lineNumber: 12 })?.labels).toContain("mot");
    // `mot` is used once, at line 12 col 3, which is where the word starts:
    expect(at("  mo|", { lineNumber: 12 })?.labels).not.toContain("mot");
  });

  it("nothing inside strings, comments, numbers, or with nothing typed", () => {
    expect(at("  msg := 'co|")).toBeNull();
    expect(at("  x := 1; // co|")).toBeNull();
    expect(at("  x := 16#F|")).toBeNull();
    expect(at("  x := |")).toBeNull();
    expect(at("  x := |", { explicit: true })?.labels).toContain("count");
  });

  it("right after `--` with no space: nothing", () => {
    expect(at("--|x")).toBeNull();
  });
});

describe("types after tag name :", () => {
  it("offers the Phase 1 types", () => {
    expect(at("tag count : |")?.labels).toEqual(["BOOL", "DINT", "REAL", "TIMER"]);
    expect(at("tag count :D|")?.word).toBe("D");
  });

  it("tag names: undeclared tags, on request or while typing", () => {
    expect(at("tag s|")?.labels).toEqual(["start_btn", "mot"]);
    expect(at("tag |")).toBeNull();
  });

  it("no completion on new step names or after the description", () => {
    expect(at("step fi|")).toBeNull();
    expect(at('tag count : DINT "x|')).toBeNull();
    expect(at("select |")).toBeNull();
  });
});
