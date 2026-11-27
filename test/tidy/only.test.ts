import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tidyL5X } from "../../src/tidy/index.js";

/** tp08 (two SFC routines) with every step and transition moved, so both need tidying. */
const moved = readFileSync("testpack/tp08_routines.L5X", "utf8").replace(/<(Step|Transition)\b[^>]*>/g, (tag) =>
  tag.replace(/\bX="(-?\d+)"/, (_m, v: string) => `X="${Number(v) + 40}"`),
);

/** The text of the routine `name` (start tag to end tag). */
const routineText = (text: string, name: string): string => {
  const start = text.indexOf(`<Routine Name="${name}"`);
  return text.slice(start, text.indexOf("</Routine>", start));
};

describe("tidyL5X only", () => {
  const full = tidyL5X(moved);

  it("the fixture has two tidied routines", () => {
    expect(full.routines.map((r) => [r.name, r.status])).toEqual([
      ["fill_seq", "tidied"],
      ["mixer", "tidied"],
    ]);
  });

  it("all routines listed: the same text as without the option", () => {
    expect(tidyL5X(moved, { only: ["fill_seq", "mixer"] }).text).toBe(full.text);
    expect(tidyL5X(moved, { only: ["FILL_SEQ", "Mixer"] }).text).toBe(full.text);
  });

  it("none listed: the input unchanged, same reports", () => {
    const r = tidyL5X(moved, { only: [] });
    expect(r.text).toBe(moved);
    expect(r.routines).toEqual(full.routines);
  });

  it("one listed: that routine tidied, the other byte for byte as it was", () => {
    const r = tidyL5X(moved, { only: ["mixer"] });
    expect(routineText(r.text, "mixer")).toBe(routineText(full.text, "mixer"));
    expect(routineText(r.text, "fill_seq")).toBe(routineText(moved, "fill_seq"));
    expect(routineText(r.text, "fill_seq")).not.toBe(routineText(full.text, "fill_seq"));
    // the rest of the file too: tidying the other one afterwards gives the full result
    expect(tidyL5X(r.text, { only: ["fill_seq"] }).text).toBe(full.text);
  });
});
