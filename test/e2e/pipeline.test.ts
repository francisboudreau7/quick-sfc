/** End-to-end: source text → compile → L5X / ASCII, on every valid fixture and test-pack chart. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile, exportL5X, routineName, showAscii } from "../../src/compile.js";
import { checkL5X } from "../../src/l5x/index.js";
import { blockText, descendants, parseXml } from "../../src/l5x/xml.js";

const DATE = new Date(2026, 10, 25, 12, 0, 0);

const charts = [
  ...readdirSync("test/fixtures")
    .filter((f) => f.endsWith(".qsfc") && !f.startsWith("invalid-"))
    .map((f) => `test/fixtures/${f}`),
  ...readdirSync("testpack")
    .filter((f) => f.endsWith(".qsfc"))
    .map((f) => `testpack/${f}`),
];

describe.each(charts)("%s", (path) => {
  const source = readFileSync(path, "utf8");
  const fileName = path.replace(/^.*\//, "");

  it("compiles without errors", () => {
    const r = compile(source);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.graph).toBeDefined();
  });

  it("exports an L5X that passes the self-check, deterministically", () => {
    const a = exportL5X(source, { fileName, exportDate: DATE });
    const b = exportL5X(source, { fileName, exportDate: DATE });
    expect(a.text).toBeDefined();
    expect(a.text).toBe(b.text);
    expect(checkL5X(a.text!)).toEqual([]);
  });

  it("rewrites every step reference to its operand", () => {
    const { text } = exportL5X(source, { fileName, exportDate: DATE });
    const r = compile(source);
    const lines = descendants(parseXml(text!), "Line").map(blockText);
    for (const s of r.graph!.steps) {
      const ref = new RegExp(`(?<![\\w.])${s.name}\\.[A-Za-z]+`, "i");
      // the step-name comment (`// fill ...`) is the only place a step name may remain
      expect(lines.filter((l) => !l.startsWith("//")).some((l) => ref.test(l.replace(/\/\/.*$/, "")))).toBe(false);
    }
  });

  it("renders an ASCII view", () => {
    const { text } = showAscii(source);
    expect(text).toBeDefined();
    expect(text!.length).toBeGreaterThan(0);
  });
});

describe.each(readdirSync("testpack").filter((f) => f.endsWith(".qsfc")))("testpack/%s", (f) => {
  it("exports the committed testpack L5X byte for byte (apart from ExportDate)", () => {
    // The SVG view routes its wires at render time; the layout and the L5X coordinates must not move.
    const noDate = (t: string): string => t.replace(/ExportDate="[^"]*"/, 'ExportDate=""');
    const { text } = exportL5X(readFileSync(`testpack/${f}`, "utf8"), { fileName: f, exportDate: DATE });
    const committed = readFileSync(`testpack/${f.replace(/\.qsfc$/, ".L5X")}`, "utf8");
    expect(noDate(text!)).toBe(noDate(committed));
  });
});

describe("export options and names", () => {
  const src = "init a\n-- go -> a\n";

  it("routine name comes from the header, else the file name", () => {
    expect(routineName(compile("sfc my_chart\n" + src).chart, "x.qsfc")).toBe("my_chart");
    expect(routineName(compile(src).chart, "C:/dir/My Chart-2.qsfc")).toBe("My_Chart_2");
    expect(routineName(compile(src).chart, "2nd.qsfc")).toBe("sfc_2nd");
  });

  it("program defaults to the routine name; --program and --version are honored", () => {
    const t = exportL5X(src, { fileName: "demo.qsfc", exportDate: DATE, programName: "Prog_1", softwareRevision: "33.00" }).text!;
    expect(t).toContain('TargetName="Prog_1"');
    expect(t).toContain('SoftwareRevision="33.00"');
    expect(t).toContain('MainRoutineName="demo"');
  });

  it("E501 / E502 for a bad revision or program name", () => {
    expect(exportL5X(src, { fileName: "d.qsfc", softwareRevision: "32" }).diagnostics.map((d) => d.code)).toContain("E501");
    expect(exportL5X(src, { fileName: "d.qsfc", programName: "bad-name" }).diagnostics.map((d) => d.code)).toContain("E502");
  });

  it("no L5X when the chart has errors", () => {
    const r = exportL5X("step a\n", { fileName: "d.qsfc" });
    expect(r.text).toBeUndefined();
    expect(r.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });
});

describe("CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "qsfc-cli-"));
  const run = (...args: string[]): { code: number; out: string } => {
    try {
      const out = execFileSync(process.execPath, ["--import", "tsx", "src/cli/main.ts", ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      return { code: err.status, out: err.stdout + err.stderr };
    }
  };

  it("check: 0 on a valid chart, 1 with errors, 2 on usage errors", () => {
    expect(run("check", "testpack/tp01_linear.qsfc").code).toBe(0);
    const bad = join(dir, "bad.qsfc");
    writeFileSync(bad, "step a\nstep b\n");
    const r = run("check", bad);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/bad\.qsfc:\d+:\d+: error E\d{3}/);
    expect(run("frobnicate").code).toBe(2);
    expect(run("check", join(dir, "missing.qsfc")).code).toBe(2);
  });

  it("export writes a BOM + CRLF file", () => {
    const out = join(dir, "out.L5X");
    expect(run("export", "testpack/tp03_parallel.qsfc", "-o", out).code).toBe(0);
    const raw = readFileSync(out);
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(raw.toString("utf8")).toContain("\r\n");
    expect(checkL5X(raw.toString("utf8"))).toEqual([]);
  });

  it("show prints the diagram", () => {
    const r = run("show", "testpack/tp01_linear.qsfc");
    expect(r.code).toBe(0);
    expect(r.out).toContain("idle");
    rmSync(dir, { recursive: true, force: true });
  });
}, 60_000);
