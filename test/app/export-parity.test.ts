/**
 * Phase 2 acceptance: the window's Export L5X gives the same file as the CLI.
 * The window calls exportL5X(stripBom(text), { fileName }); the CLI writes the file.
 * Only ExportDate differs (it is the time of export).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { exportL5X } from "../../src/compile.js";
import { l5xFileName, stripBom } from "../../app/state.js";

const noDate = (text: string): string => text.replace(/ExportDate="[^"]*"/, 'ExportDate=""');
const dir = mkdtempSync(join(tmpdir(), "qsfc-parity-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const charts = [
  ...readdirSync("testpack").filter((f) => f.endsWith(".qsfc")).map((f) => `testpack/${f}`),
  "docs/mockups/demo.qsfc",
];

describe.each(charts)("%s", (path) => {
  it("app export equals CLI export apart from ExportDate", () => {
    const fileName = path.replace(/^.*\//, "");
    const out = join(dir, l5xFileName(fileName));
    execFileSync(process.execPath, ["--import", "tsx", "src/cli/main.ts", "export", path, "-o", out], { stdio: "ignore" });
    const cli = readFileSync(out, "utf8");
    const app = exportL5X(stripBom(readFileSync(path, "utf8")), { fileName }).text;
    expect(app).toBeDefined();
    expect(noDate(app!)).toBe(noDate(cli));
  });
});
