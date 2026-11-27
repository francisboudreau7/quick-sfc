/**
 * qsfc command-line tool.
 *   qsfc check  <file.qsfc>
 *   qsfc export <file.qsfc> [-o out.L5X] [--program NAME] [--version 32.01]
 *   qsfc show   <file.qsfc>
 *   qsfc tidy   <in.L5X> [-o out.L5X]      (Phase 4a, SPEC §8.6; default out: <in>_tidy.L5X)
 *   qsfc import <in.L5X> [-o out.qsfc] [--program NAME] [--sfc-tags-at-program]   (SPEC §8.7; default out: <in>.qsfc)
 * Exit codes: 0 OK (warnings allowed; tidy: the file was written, even if some routines were
 * skipped; import: the file was written, even with notes), 1 errors in the chart (tidy: no SFC
 * routine could be tidied, nothing written; import: nothing could be imported),
 * 2 usage or file error.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { compile, exportL5X, showAscii } from "../compile.js";
import { formatDiagnostic, hasErrors, type Diagnostic } from "../model/diagnostics.js";
import { importL5X, type ImportOptions } from "../import/index.js";
import { tidyL5X } from "../tidy/index.js";

const USAGE = `usage:
  qsfc check  <file.qsfc>
  qsfc export <file.qsfc> [-o out.L5X] [--program NAME] [--version 32.01]
  qsfc show   <file.qsfc>
  qsfc tidy   <in.L5X> [-o out.L5X]
  qsfc import <in.L5X> [-o out.qsfc] [--program NAME] [--sfc-tags-at-program]`;

interface Args {
  command: string;
  file: string;
  out?: string;
  program?: string;
  version?: string;
  /** import: step and transition tags at controller scope become program tags (SPEC §7.7). */
  sfcTagsAtProgram?: boolean;
}

function parseArgs(argv: string[]): Args | string {
  const [command, ...rest] = argv;
  if (!command || !["check", "export", "show", "tidy", "import"].includes(command)) return USAGE;
  const args: Partial<Args> = { command };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    const value = (): string | undefined => rest[++i];
    if (a === "-o" || a === "--out") args.out = value();
    else if (a === "--program") args.program = value();
    else if (a === "--version") args.version = value();
    else if (a === "--sfc-tags-at-program" && command === "import") args.sfcTagsAtProgram = true;
    else if (a.startsWith("-")) return `unknown option ${a}\n${USAGE}`;
    else if (args.file === undefined) args.file = a;
    else return `unexpected argument ${a}\n${USAGE}`;
  }
  if (!args.file) return USAGE;
  for (const opt of ["out", "program", "version"] as const) {
    if (opt in args && args[opt] === undefined) return `option needs a value\n${USAGE}`;
  }
  return args as Args;
}

function report(diags: Diagnostic[], file: string): void {
  for (const d of diags) console.error(formatDiagnostic(d, file));
  const errors = diags.filter((d) => d.severity === "error").length;
  const warnings = diags.length - errors;
  if (diags.length) console.error(`${errors} error(s), ${warnings} warning(s)`);
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (typeof args === "string") {
    console.error(args);
    return 2;
  }
  if (args.command === "tidy") return tidy(args);
  if (args.command === "import") return importCommand(args);
  let source: string;
  try {
    source = readFileSync(args.file, "utf8").replace(/^﻿/, "");
  } catch (e) {
    console.error(`cannot read ${args.file}: ${(e as Error).message}`);
    return 2;
  }
  const name = basename(args.file);

  if (args.command === "check") {
    const { diagnostics } = compile(source, { fileName: name });
    report(diagnostics, name);
    if (!hasErrors(diagnostics)) console.error(`${name}: OK`);
    return hasErrors(diagnostics) ? 1 : 0;
  }

  if (args.command === "show") {
    const { text, diagnostics } = showAscii(source, { fileName: name });
    report(diagnostics, name);
    if (text === undefined) return 1;
    console.log(text);
    return 0;
  }

  const options: Parameters<typeof exportL5X>[1] = { fileName: name };
  if (args.program !== undefined) options.programName = args.program;
  if (args.version !== undefined) options.softwareRevision = args.version;
  const { text, diagnostics } = exportL5X(source, options);
  report(diagnostics, name);
  if (text === undefined) return 1;
  const out = args.out ?? args.file.replace(/\.qsfc$/i, "") + ".L5X";
  try {
    writeFileSync(out, text, "utf8");
  } catch (e) {
    console.error(`cannot write ${out}: ${(e as Error).message}`);
    return 2;
  }
  console.error(`wrote ${out}`);
  return 0;
}

/** `qsfc tidy`: one line per SFC routine on stdout, problems on stderr. */
function tidy(args: Args): number {
  if (args.program !== undefined || args.version !== undefined) {
    console.error(`tidy takes only -o\n${USAGE}`);
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(args.file, "utf8");
  } catch (e) {
    console.error(`cannot read ${args.file}: ${(e as Error).message}`);
    return 2;
  }
  const result = tidyL5X(text);
  if (result.error) {
    console.error(`${basename(args.file)}: ${result.error}`);
    return 1;
  }
  if (result.routines.length === 0) {
    console.error(`${basename(args.file)}: no SFC routine in the file`);
    return 1;
  }
  for (const r of result.routines) {
    if (r.status === "skipped") console.log(`${r.name}: skipped, ${r.reason}`);
    else if (r.status === "unchanged") console.log(`${r.name}: unchanged (already tidy)`);
    else console.log(`${r.name}: tidied, ${r.moved} element(s) moved, ${r.hidden} hidden wire(s)`);
  }
  if (result.routines.every((r) => r.status === "skipped")) {
    console.error("nothing could be tidied, no file written");
    return 1;
  }
  const out = args.out ?? args.file.replace(/\.l5x$/i, "") + "_tidy.L5X";
  try {
    writeFileSync(out, result.text, "utf8");
  } catch (e) {
    console.error(`cannot write ${out}: ${(e as Error).message}`);
    return 2;
  }
  console.error(`wrote ${out}`);
  return 0;
}

/** `qsfc import`: the notes on stderr (warnings first), the .qsfc file written. */
function importCommand(args: Args): number {
  if (args.version !== undefined) {
    console.error(`import takes only -o, --program and --sfc-tags-at-program
${USAGE}`);
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(args.file, "utf8");
  } catch (e) {
    console.error(`cannot read ${args.file}: ${(e as Error).message}`);
    return 2;
  }
  const options: ImportOptions = {};
  if (args.program !== undefined) options.program = args.program;
  if (args.sfcTagsAtProgram) options.sfcTagsAtProgram = true;
  const result = importL5X(text, options);
  if (result.error) {
    console.error(`${basename(args.file)}: ${result.error}`);
    if (result.programs.length > 1) console.error(`programs in the file: ${result.programs.join(", ")} (choose one with --program)`);
    return 1;
  }
  if (result.programs.length > 1 && args.program === undefined) {
    console.error(`the file has ${result.programs.length} programs (${result.programs.join(", ")}); importing ${result.program} (choose with --program)`);
  }
  const notes = [...result.notes].sort((a, b) => Number(a.level === "info") - Number(b.level === "info"));
  for (const n of notes) console.error(`${n.level}: ${n.routine ? `${n.routine}: ` : ""}${n.text}`);
  const out = args.out ?? args.file.replace(/\.l5x$/i, "") + ".qsfc";
  try {
    writeFileSync(out, result.source, "utf8");
  } catch (e) {
    console.error(`cannot write ${out}: ${(e as Error).message}`);
    return 2;
  }
  console.error(`wrote ${out} (program ${result.program}, ${result.routines.filter((r) => r.imported).length} routine(s))`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
