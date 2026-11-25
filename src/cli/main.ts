/**
 * qsfc command-line tool (Phase 1).
 *   qsfc check  <file.qsfc>
 *   qsfc export <file.qsfc> [-o out.L5X] [--program NAME] [--version 32.01]
 *   qsfc show   <file.qsfc>
 * Exit codes: 0 OK (warnings allowed), 1 errors in the chart, 2 usage or file error.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { compile, exportL5X, showAscii } from "../compile.js";
import { formatDiagnostic, hasErrors, type Diagnostic } from "../model/diagnostics.js";

const USAGE = `usage:
  qsfc check  <file.qsfc>
  qsfc export <file.qsfc> [-o out.L5X] [--program NAME] [--version 32.01]
  qsfc show   <file.qsfc>`;

interface Args {
  command: string;
  file: string;
  out?: string;
  program?: string;
  version?: string;
}

function parseArgs(argv: string[]): Args | string {
  const [command, ...rest] = argv;
  if (!command || !["check", "export", "show"].includes(command)) return USAGE;
  const args: Partial<Args> = { command };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    const value = (): string | undefined => rest[++i];
    if (a === "-o" || a === "--out") args.out = value();
    else if (a === "--program") args.program = value();
    else if (a === "--version") args.version = value();
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
  let source: string;
  try {
    source = readFileSync(args.file, "utf8").replace(/^﻿/, "");
  } catch (e) {
    console.error(`cannot read ${args.file}: ${(e as Error).message}`);
    return 2;
  }
  const name = basename(args.file);

  if (args.command === "check") {
    const { diagnostics } = compile(source);
    report(diagnostics, name);
    if (!hasErrors(diagnostics)) console.error(`${name}: OK`);
    return hasErrors(diagnostics) ? 1 : 0;
  }

  if (args.command === "show") {
    const { text, diagnostics } = showAscii(source);
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

process.exitCode = main(process.argv.slice(2));
