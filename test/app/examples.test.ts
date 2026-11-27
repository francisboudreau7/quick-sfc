import { describe, expect, it } from "vitest";
import { compile, exportL5X } from "../../src/compile.js";
import { EXAMPLES, findExample } from "../../app/examples.js";

describe("Help → Examples", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.label}: no errors or warnings, exports`, () => {
      const r = compile(ex.source, { fileName: ex.fileName });
      expect(r.diagnostics.map((d) => `${d.span.line}:${d.code} ${d.message}`)).toEqual([]);
      expect(exportL5X(ex.source, { fileName: ex.fileName }).text).toBeDefined();
    });
  }

  it("ids and file names are unique", () => {
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    expect(new Set(EXAMPLES.map((e) => e.fileName)).size).toBe(EXAMPLES.length);
    expect(findExample("start-stop")?.label).toBe("Start / stop");
    expect(findExample("nope")).toBeUndefined();
  });
});
