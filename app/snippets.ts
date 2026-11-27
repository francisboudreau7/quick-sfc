/**
 * Snippets (Phase 4c): five small qSFC patterns, inserted where a step can start. No DOM
 * and no CodeMirror: this module says where a snippet fits (snippetContext), renames its
 * placeholder names that are already used in the file (`fault` → `fault2`) and builds the
 * CodeMirror snippet template (`${name}` fields, filled with Tab) or the plain text.
 * app/editor.ts offers them in autocomplete and app/main.ts in the Insert menu.
 * Unit-tested in test/app (each snippet compiles without errors).
 */
import { ioStateAfter, jumpArrow, lineKind, tokenizeLine } from "./highlight.js";

/** Where the snippet goes, worked out from the lines around it. */
export interface SnippetContext {
  /** First step keyword: `init` when the routine has no initial step yet. */
  first: "init" | "step";
  /** A step comes last above (or a parallel `end`): the snippet starts with a transition. */
  lead: boolean;
  /**
   * Nothing follows in the routine: the snippet's last transition jumps, to the routine's
   * initial step (`target`) or, without one, to the snippet's own first step.
   */
  close: boolean;
  /** The routine's initial step, the jump target of a closed snippet. */
  target?: string;
}

/** A field name: the placeholder text, filled with Tab. */
type Field = (name: string) => string;

export interface SnippetDef {
  id: string;
  label: string;
  detail: string;
  /** Lines of the open form; a leading tab is one indent unit. `tail` ends the last transition. */
  lines(f: Field, ctx: { first: string; tail: string }): string[];
  /** The placeholder that names the snippet's first step (the jump target without an initial step). */
  firstName: string;
}

export const SNIPPETS: readonly SnippetDef[] = [
  {
    id: "start-stop",
    label: "start / stop",
    detail: "stopped, running, stop: the running step holds the motor (seal-in)",
    firstName: "stopped",
    lines: (f, c) => [
      `${c.first} ${f("stopped")} "Waiting for start"`,
      `-- ${f("start_btn")} AND NOT ${f("stop_btn")}`,
      `step ${f("running")} "Running until stop"`,
      `\ton ${f("motor")}`,
      `-- ${f("stop_btn")}${c.tail}`,
    ],
  },
  {
    id: "timeout-fault",
    label: "timeout → fault",
    detail: "select: done | after 30s → fault, reset back",
    firstName: "work",
    lines: (f, c) => [
      `${c.first} ${f("work")} "Wait for done, at most 30 s"`,
      `\ton ${f("output")}`,
      "select",
      `\t-- ${f("work_done")}${c.tail}`,
      "|",
      "\t-- after 30s",
      `\tstep ${f("fault")} "Took too long"`,
      `\t\ton ${f("alarm")}`,
      `\t-- ${f("reset_btn")} -> ${f("work")}`,
      "end",
    ],
  },
  {
    id: "reset-sequence",
    label: "reset sequence",
    detail: "wait for the reset button, clear the outputs, back to idle",
    firstName: "halted",
    lines: (f, c) => [
      `${c.first} ${f("halted")} "Stopped: press reset"`,
      `\ton ${f("reset_lamp")}`,
      `-- ${f("reset_btn")}`,
      `step ${f("resetting")} 1s "Clear the outputs"`,
      `\treset ${f("motor")}, ${f("valve")}`,
      `-- ${f("resetting")}.done${c.tail}`,
    ],
  },
  {
    id: "parallel-join",
    label: "parallel join",
    detail: "two legs run together; wait for both",
    firstName: "ready",
    lines: (f, c) => [
      `${c.first} ${f("ready")} "Start both legs"`,
      `-- ${f("go")}`,
      "parallel",
      `\tstep ${f("work_a")}`,
      `\t\ton ${f("motor_a")}`,
      `\t-- ${f("done_a")}`,
      `\tstep ${f("wait_a")}`,
      "|",
      `\tstep ${f("work_b")}`,
      `\t\ton ${f("motor_b")}`,
      `\t-- ${f("done_b")}`,
      `\tstep ${f("wait_b")}`,
      "end",
      `-- TRUE${c.tail}`,
    ],
  },
  {
    id: "counter-loop",
    label: "counter loop",
    detail: "repeat a step 3 times, then go on",
    firstName: "load",
    lines: (f, c) => [
      `${c.first} ${f("load")} "Reset the counter"`,
      `\t${f("count")} := 0;`,
      "-- TRUE",
      `step ${f("cycle")} 1s "One cycle"`,
      "\tP",
      `\t\t${f("count")} := ${f("count")} + 1;`,
      "select",
      `\t-- ${f("cycle")}.done AND ${f("count")} < 3 -> ${f("cycle")}`,
      "|",
      `\t-- ${f("cycle")}.done AND ${f("count")} >= 3${c.tail}`,
      "end",
    ],
  },
];

export function findSnippet(id: string): SnippetDef | undefined {
  return SNIPPETS.find((s) => s.id === id);
}

type Structure = "step" | "init" | "transition" | "jump" | "select" | "parallel" | "bar" | "end-select" | "end-parallel";

/**
 * Where a snippet fits when it is written on line `at` (0-based in `lines`; that line is
 * replaced, so it is left out of the scan), or undefined when it doesn't fit there:
 *  - where a step can start: after a transition without a jump, after a `select … end`, or
 *    in an SFC routine without steps;
 *  - after the last step of a routine (the snippet then starts with a transition).
 * Nothing after it in the routine: the snippet is closed with a jump.
 */
export function snippetContext(lines: readonly string[], at: number): SnippetContext | undefined {
  // The routine holding line `at`: from the last header above to the next header.
  let start = 0;
  let kind: "sfc" | "st" = "sfc";
  let end = lines.length;
  let io = false;
  const inIo: boolean[] = [];
  for (let i = 0; i < lines.length; i++) {
    const here = io;
    io = ioStateAfter(lines[i]!, io);
    inIo.push(here || io);
    if (here || io) continue;
    const lk = lineKind(lines[i]!);
    if (lk.kind !== "header" || lk.word?.toLowerCase() === "program") continue;
    if (i < at) {
      start = i + 1;
      kind = lk.word!.toLowerCase() === "st" ? "st" : "sfc";
    } else if (i > at) {
      end = i;
      break;
    }
  }
  if (kind === "st") return undefined;

  const stack: Array<"select" | "parallel"> = [];
  const before: Structure[] = [];
  const after: Structure[] = [];
  let target: string | undefined;
  for (let i = start; i < end; i++) {
    if (i === at || inIo[i]) continue;
    const s = structureOf(lines[i]!, stack);
    if (!s) continue;
    if (s === "init") target ??= /^[ \t]*init[ \t]+([A-Za-z_]\w*)/i.exec(lines[i]!)?.[1];
    (i < at ? before : after).push(s);
  }
  const prev = before[before.length - 1];
  const close = after.length === 0;
  const first = target === undefined ? "init" : "step";
  const ctx = (lead: boolean): SnippetContext => (target === undefined ? { first, lead, close } : { first, lead, close, target });
  if (prev === undefined) return after.length === 0 ? ctx(false) : undefined;
  if (prev === "transition" || prev === "end-select") return ctx(false);
  if ((prev === "step" || prev === "init" || prev === "end-parallel") && close) return ctx(true);
  return undefined;
}

function structureOf(line: string, stack: Array<"select" | "parallel">): Structure | undefined {
  const { kind, word, start } = lineKind(line);
  switch (kind) {
    case "step":
      return word!.toLowerCase() === "init" ? "init" : "step";
    case "transition":
      return jumpArrow(line, start + 2) >= 0 ? "jump" : "transition";
    case "branch": {
      const b = word!.toLowerCase() === "select" ? "select" : "parallel";
      stack.push(b);
      return b;
    }
    case "bar":
      return "bar";
    case "end":
      return stack.pop() === "parallel" ? "end-parallel" : "end-select";
    default:
      return undefined;
  }
}

/** Every name written in the file (lower case), except on line `skip` (0-based). */
export function usedNames(lines: readonly string[], skip = -1): Set<string> {
  const out = new Set<string>();
  let io = false;
  lines.forEach((line, i) => {
    const here = io;
    io = ioStateAfter(line, io);
    if (i === skip) return;
    for (const t of tokenizeLine(line, { inIo: here })) {
      if (t.kind === "def" || t.kind === "ident" || t.kind === "label" || t.kind === "target" || t.kind === "func") {
        out.add(line.slice(t.from, t.to).toLowerCase());
      }
    }
  });
  return out;
}

/** Placeholder names of a snippet, in Tab order (first use). */
export function snippetNames(def: SnippetDef): string[] {
  const names: string[] = [];
  def.lines((n) => {
    if (!names.includes(n)) names.push(n);
    return n;
  }, { first: "step", tail: "" });
  return names;
}

/** `name`, or `name2`, `name3`… : the first one not in `used` (lower-case names). */
export function uniqueName(name: string, used: ReadonlySet<string>): string {
  if (!used.has(name.toLowerCase())) return name;
  for (let k = 2; ; k++) {
    const n = `${name}${k}`;
    if (!used.has(n.toLowerCase())) return n;
  }
}

/** Placeholder → the name to insert, so no name clashes with one in the file. */
export function renameMap(def: SnippetDef, used: ReadonlySet<string>): Map<string, string> {
  const taken = new Set(used);
  const out = new Map<string, string>();
  for (const n of snippetNames(def)) {
    const u = uniqueName(n, taken);
    taken.add(u.toLowerCase());
    out.set(n, u);
  }
  return out;
}

/**
 * The CodeMirror snippet template (`${name}` fields, tab-indented lines) for `def` in `ctx`,
 * with the names renamed so they are not used in the file yet.
 */
export function snippetTemplate(def: SnippetDef, ctx: SnippetContext, used: ReadonlySet<string>): string {
  const names = renameMap(def, used);
  const f: Field = (n) => `\${${names.get(n) ?? n}}`;
  const tail = ctx.close ? ` -> ${ctx.target ?? f(def.firstName)}` : "";
  const body = def.lines(f, { first: ctx.first, tail });
  // After a step: a transition first (its condition is the first field).
  return (ctx.lead ? ["-- ${TRUE}", ...body] : body).join("\n");
}

/** The text a template inserts with its fields as written, indented with `indent` per tab. */
export function templateText(template: string, indent = "  "): string {
  return template
    .split("\n")
    .map((l) => {
      const tabs = /^\t*/.exec(l)![0].length;
      return indent.repeat(tabs) + l.slice(tabs);
    })
    .join("\n")
    .replace(/[#$]\{([^{}]*)\}/g, "$1");
}

/** Autocomplete offers snippets only on a line holding at most one word, before the cursor. */
export function snippetLine(line: string, pos: number): boolean {
  return /^[ \t]*[A-Za-z_]?\w*$/.test(line.slice(0, pos)) && line.slice(pos).trim() === "";
}
