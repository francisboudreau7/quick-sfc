import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile.js";
import {
  callingSteps,
  callTree,
  findRoutine,
  formatTree,
  notCalledText,
  programName,
  routineAtLine,
  routineSummary,
  stLinesText,
  treeLines,
} from "../../app/routines.js";

const TP08 = readFileSync("testpack/tp08_routines.qsfc", "utf8");
const tp08 = compile(TP08, { fileName: "tp08_routines.qsfc" });

describe("routineAtLine", () => {
  const routines = tp08.routines;
  it("finds the routine whose line range holds the line", () => {
    const at = (line: number) => routines[routineAtLine(routines, line)]!.name;
    expect(at(7)).toBe("main"); // st main
    expect(at(9)).toBe("main");
    expect(at(13)).toBe("main"); // blank line before the next header
    expect(at(14)).toBe("fill_seq"); // header line
    expect(at(17)).toBe("fill_seq");
    expect(at(24)).toBe("mixer");
    expect(at(31)).toBe("alarms");
    expect(at(35)).toBe("count_cycles");
    expect(at(999)).toBe("count_cycles");
  });
  it("lines before the first routine (program, tags) belong to the first one", () => {
    expect(routineAtLine(routines, 1)).toBe(0);
    expect(routineAtLine(routines, 4)).toBe(0);
  });
  it("-1 without routines", () => {
    expect(routineAtLine([], 3)).toBe(-1);
  });
  it("a header-less first routine is named after the file", () => {
    const r = compile("init a\n-- go\nstep b\n-- TRUE -> a\nst extra\n  x := 1;\n", { fileName: "my tank.qsfc" });
    expect(r.routines.map((x) => x.name)).toEqual(["my_tank", "extra"]);
    expect(routineAtLine(r.routines, 2)).toBe(0);
    expect(routineAtLine(r.routines, 6)).toBe(1);
  });
});

describe("names and summaries", () => {
  it("findRoutine is case-insensitive", () => {
    expect(findRoutine(tp08.routines, "FILL_SEQ")?.name).toBe("fill_seq");
    expect(findRoutine(tp08.routines, "nope")).toBeUndefined();
  });
  it("routineSummary counts the kinds", () => {
    expect(routineSummary(tp08.routines)).toBe("5 routines (2 SFC, 3 ST)");
    expect(routineSummary([{ kind: "sfc" }])).toBe("1 routine (1 SFC, 0 ST)");
  });
  it("programName: the program header, else the main routine", () => {
    expect(programName(tp08.program, tp08.routines)).toBe("tp08_routines");
    const r = compile("st main\n  call b;\nst b\n  x := 1;\n");
    expect(programName(r.program, r.routines)).toBe("main");
  });
  it("ST card texts", () => {
    expect(notCalledText(true)).toBe("nothing (it's the main routine)");
    expect(notCalledText(false)).toBe("nothing — only the main routine runs by itself");
    const main = tp08.routines[0]!;
    expect(stLinesText(main, true)).toBe("Studio runs the main routine every scan. 5 lines of ST.");
    expect(stLinesText(findRoutine(tp08.routines, "alarms")!, false)).toBe("1 line of ST.");
  });
});

describe("callTree", () => {
  it("draws the tree from the main routine, with the calling step", () => {
    expect(callingSteps(findRoutine(tp08.routines, "fill_seq")!, "count_cycles", tp08.calls)).toEqual(["count"]);
    expect(formatTree(callTree(tp08.routines, tp08.calls))).toBe(
      [
        "main",
        "├─ fill_seq          SFC",
        "│  └─ count_cycles   ST    (from step count)",
        "├─ mixer             SFC",
        "└─ alarms            ST",
      ].join("\n"),
    );
  });

  it("is cycle-safe: a routine seen before is marked (again) and not expanded", () => {
    const src = ["st main", "  call a;", "  call b;", "st a", "  call b;", "  call a;", "st b", "  call main;", ""].join("\n");
    const r = compile(src);
    const rows = callTree(r.routines, r.calls);
    expect(rows.map((x) => [x.prefix + x.name, x.again])).toEqual([
      ["main", false],
      ["├─ a", false],
      ["│  ├─ b", false],
      ["│  │  └─ main", true],
      ["│  └─ a", true],
      ["└─ b", true],
    ]);
    expect(treeLines(rows)[3]!.tail).toContain("(again)");
  });

  it("lists every step that calls; a call of a missing routine (E600) is left out", () => {
    const src = ["sfc main", "init a", "  call x;", "-- go", "step b", "  call x;", "  call nope;", "-- TRUE -> a", "st x", "  y := 1;", ""].join("\n");
    const r = compile(src);
    expect(formatTree(callTree(r.routines, r.calls)).split("\n")).toEqual(["main", "└─ x   ST    (from steps a, b)"]);
  });

  it("empty without routines", () => {
    expect(callTree([], [])).toEqual([]);
  });
});
