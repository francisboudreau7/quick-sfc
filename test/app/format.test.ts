import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile.js";
import type { TagInfo } from "../../src/model/graph.js";
import { chartCounts, DEFAULT_TAG_SORT, nextTagSort, plural, sortTags, usesTitle } from "../../app/format.js";

const tag = (name: string, type: TagInfo["type"], uses: number, description?: string): TagInfo => {
  const t: TagInfo = { name, type, declared: true, uses: Array.from({ length: uses }, (_, i) => ({ line: 10 - i, col: 1 })) };
  if (description !== undefined) t.description = description;
  return t;
};

const tags = [tag("valve", "BOOL", 1, "Inlet"), tag("Count", "DINT", 3), tag("alarm", "BOOL", 3, "Horn"), tag("level", "REAL", 0)];
const names = (ts: TagInfo[]): string[] => ts.map((t) => t.name);

describe("sortTags", () => {
  it("by name, case-insensitive, both directions", () => {
    expect(names(sortTags(tags, { key: "name", dir: "asc" }))).toEqual(["alarm", "Count", "level", "valve"]);
    expect(names(sortTags(tags, { key: "name", dir: "desc" }))).toEqual(["valve", "level", "Count", "alarm"]);
  });

  it("by type and uses, ties by name", () => {
    expect(names(sortTags(tags, { key: "type", dir: "asc" }))).toEqual(["alarm", "valve", "Count", "level"]);
    expect(names(sortTags(tags, { key: "uses", dir: "desc" }))).toEqual(["alarm", "Count", "valve", "level"]);
  });

  it("by description, empty last when ascending", () => {
    expect(names(sortTags(tags, { key: "description", dir: "asc" }))).toEqual(["alarm", "valve", "Count", "level"]);
  });

  it("does not modify its input", () => {
    const copy = [...tags];
    sortTags(tags, { key: "uses", dir: "asc" });
    expect(tags).toEqual(copy);
  });
});

describe("nextTagSort", () => {
  it("flips the same column, starts a new column ascending (uses descending)", () => {
    expect(nextTagSort(DEFAULT_TAG_SORT, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextTagSort(DEFAULT_TAG_SORT, "type")).toEqual({ key: "type", dir: "asc" });
    expect(nextTagSort(DEFAULT_TAG_SORT, "uses")).toEqual({ key: "uses", dir: "desc" });
  });
});

describe("small formatting", () => {
  it("plural", () => {
    expect(plural(1, "step")).toBe("1 step");
    expect(plural(0, "error")).toBe("0 errors");
    expect(plural(2, "branch", "branches")).toBe("2 branches");
  });

  it("usesTitle lists distinct sorted lines", () => {
    expect(usesTitle(tag("x", "BOOL", 3))).toBe("Used on lines 8, 9, 10");
    expect(usesTitle(tag("x", "BOOL", 1))).toBe("Used on line 10");
    expect(usesTitle(tag("x", "BOOL", 0))).toBe("Not used in the chart");
  });

  it("chartCounts matches the demo chart of the mockups", () => {
    const g = compile(readFileSync("docs/mockups/demo.qsfc", "utf8")).graph;
    expect(chartCounts(g)).toEqual({ steps: g!.steps.length, transitions: g!.transitions.length, branches: g!.branches.length });
    expect(chartCounts(undefined)).toBeUndefined();
  });
});
