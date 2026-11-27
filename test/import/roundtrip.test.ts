import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportL5X } from "../../src/compile.js";
import { importL5X } from "../../src/import/index.js";

const files = [
  ...readdirSync("testpack").filter((f) => f.endsWith(".qsfc")).map((f) => `testpack/${f}`),
  ...readdirSync("test/fixtures").filter((f) => f.endsWith(".qsfc") && !f.startsWith("invalid")).map((f) => `test/fixtures/${f}`),
];
const date = new Date(2026, 0, 1);

describe("export → import → export gives the same L5X", () => {
  for (const file of files) {
    it(file, () => {
      const fileName = file.replace(/^.*\//, "");
      const first = exportL5X(readFileSync(file, "utf8"), { fileName, exportDate: date });
      expect(first.text, JSON.stringify(first.diagnostics)).toBeDefined();
      const imported = importL5X(first.text!);
      expect(imported.error).toBeUndefined();
      expect(imported.errors, imported.source).toBe(0);
      const second = exportL5X(imported.source, { fileName, exportDate: date });
      expect(second.text, imported.source).toBe(first.text);
      expect(imported.notes.filter((n) => n.level === "warning")).toEqual([]);
    });
  }
});
