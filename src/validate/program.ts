/**
 * Program-level rules (SPEC §4.5): every SFC routine is validated on its own, then names are
 * checked across routines (E309) and calls against the routines (E600, W600-W603).
 * Never throws.
 */
import { key, operandName, walk, type ProgramNode, type RoutineNode, type UsesEntry } from "../model/ast.js";
import { error, sortDiagnostics, warning, type Diagnostic, type Span } from "../model/diagnostics.js";
import type { CallRef } from "../tags/index.js";
import { closest } from "../parse/names.js";
import { validate } from "./index.js";

/** Name of a routine as written; "" for a header-less first routine. */
export function routineLabel(r: RoutineNode): string {
  return r.kind === "sfc" ? (r.name?.text ?? "") : r.name.text;
}

export function validateProgram(program: ProgramNode, calls: readonly CallRef[] = []): Diagnostic[] {
  const diags: Diagnostic[] = [];
  try {
    run(program, calls, diags);
  } catch (e) {
    diags.push(error("E000", { line: 1, col: 1 }, `internal validator error: ${String(e)}`));
  }
  return sortDiagnostics(diags);
}

interface Owner {
  what: string;
  span: Span;
  routine: string;
}

function run(program: ProgramNode, calls: readonly CallRef[], diags: Diagnostic[]): void {
  const routines = program.routines;
  if (routines.length === 0) {
    diags.push(error("E200", { line: 1, col: 1 }, "the file has no steps", "start with  init name"));
    return;
  }

  // ---- names across routines (E309) ------------------------------------------------------
  const stepRoutine = new Map<string, string>();
  const owners = new Map<string, Owner>();
  const claim = (text: string, span: Span, what: string, routine: string, sameRoutineChecked: boolean): void => {
    if (!text) return;
    const k = key(text);
    const other = owners.get(k);
    if (!other) {
      owners.set(k, { what, span, routine });
      return;
    }
    // two elements of the same SFC routine: validate() reports it
    if (sameRoutineChecked && other.what !== "routine" && other.routine === routine) return;
    const where = other.what === "routine" || other.routine === routine ? "" : ` (routine \`${other.routine}\`)`;
    diags.push(error("E309", span, `name \`${text}\` is already used by the ${other.what} at line ${other.span.line}${where}`));
  };
  for (const r of routines) {
    const label = routineLabel(r);
    if (r.kind === "st") claim(label, r.name.span, "routine", label, false);
    else if (r.name) claim(label, r.name.span, "routine", label, false);
  }
  for (const u of program.uses ?? []) claim(u.name.text, u.name.span, "routine", u.name.text, false);
  for (const r of routines) {
    if (r.kind !== "sfc") continue;
    const label = routineLabel(r);
    for (const el of walk(r.chart.body)) {
      if (el.kind !== "step" && el.kind !== "transition") continue;
      claim(el.name.text, el.name.span, el.kind, label, true);
      if (el.kind === "step" && el.name.text && !stepRoutine.has(key(el.name.text))) {
        stepRoutine.set(key(el.name.text), label || "(first routine)");
      }
    }
  }

  // ---- each SFC routine; ST routines ----------------------------------------------------------
  for (const r of routines) {
    if (r.kind === "sfc") {
      const label = routineLabel(r);
      const others = new Map([...stepRoutine].filter(([, routine]) => routine !== (label || "(first routine)")));
      diags.push(...validate(r.chart, { stepRoutine: others }));
    } else if (r.body.length === 0 && r.name.text) {
      diags.push(warning("W603", r.name.span, `ST routine \`${r.name.text}\` is empty`));
    }
  }

  // ---- calls (E600, W601, W602), SFR / SFP (E603, E604), routines nobody calls (W600) -----------
  const byKey = new Map<string, RoutineNode | UsesEntry>();
  for (const r of routines) {
    const label = routineLabel(r);
    if (label && !byKey.has(key(label))) byKey.set(key(label), r);
  }
  for (const u of program.uses ?? []) if (!byKey.has(key(u.name.text))) byKey.set(key(u.name.text), u);
  // the main routine: `uses X (main)` when it isn't in the file, else the first routine (SPEC §4.5)
  const main: RoutineNode | UsesEntry = program.uses?.find((u) => u.main) ?? routines[0]!;
  const mainKey = key("kind" in main ? routineLabel(main) : main.name.text);
  const called = new Set<string>();
  const names = [...byKey.keys()].map((k) => {
    const v = byKey.get(k)!;
    return "kind" in v ? routineLabel(v) : v.name.text;
  });
  for (const c of calls) {
    const k = key(c.name);
    const target = byKey.get(k);
    const written =
      c.via === "call" ? `call ${c.name}` : c.via === "jsr" ? `JSR(${c.name}, ...)` : `${c.via.toUpperCase()}(${c.name}, ...)`;
    if (!target) {
      const near = closest(c.name, names);
      diags.push(
        error("E600", c.span, `\`${written}\`: there is no routine \`${c.name}\`${near ? `; did you mean \`${near}\`?` : ""}`,
          near ? undefined : "start one with `sfc name` or `st name`, or name it on a `uses` line if it isn't in this file"),
      );
      continue;
    }
    if (c.via === "sfr" || c.via === "sfp") {
      sfcControl(c, target, stepRoutine, diags);
      continue;
    }
    if (k !== key(c.from)) called.add(k);
    if (k === key(c.from)) {
      diags.push(warning("W601", c.span, `routine \`${c.name}\` calls itself`, "Studio runs a routine that calls itself again and again in the same scan"));
    } else if (target === main && mainKey) {
      diags.push(warning("W602", c.span, `\`${c.name}\` is the main routine: Studio already runs it every scan`));
    }
  }
  // routines outside the file may call the others: no W600 then
  if (program.uses?.length) return;
  routines.forEach((r, i) => {
    if (i === 0) return;
    const label = routineLabel(r);
    if (!label || called.has(key(label))) return;
    const span = r.kind === "st" ? r.name.span : (r.name?.span ?? r.span ?? { line: 1, col: 1 });
    diags.push(
      warning("W600", span, `routine \`${label}\` is never called (only the main routine runs by itself)`,
        `add \`call ${label};\` to the main routine \`${routineLabel(routines[0]!) || "(first routine)"}\` or to an action`),
    );
  });
}

/**
 * `SFR(routine, step)` / `SFP(routine, Execute|Pause)` (SPEC §4.5): the routine is an SFC routine;
 * SFR's step is a step of it (its name when the routine is in the file, else its operand
 * `Step_007`); SFP's state is Execute or Pause.
 */
function sfcControl(c: CallRef, target: RoutineNode | UsesEntry, stepRoutine: ReadonlyMap<string, string>, diags: Diagnostic[]): void {
  const fn = c.via.toUpperCase();
  const inFile = "kind" in target;
  if (inFile && target.kind === "st") {
    diags.push(error("E603", c.span, `\`${fn}\` needs an SFC routine; \`${c.name}\` is an ST routine`));
    return;
  }
  const arg = c.arg;
  if (c.via === "sfp") {
    if (!arg || !/^(execute|pause)$/i.test(arg.text)) {
      diags.push(error("E604", arg?.span ?? c.span, `\`SFP(${c.name}, ...)\`: the second argument is \`Execute\` or \`Pause\``));
    }
    return;
  }
  if (!arg) {
    diags.push(error("E604", c.span, `\`SFR(${c.name}, ...)\`: the second argument is a step of \`${c.name}\``, "write `SFR(routine, step);`"));
    return;
  }
  const owner = stepRoutine.get(key(arg.text));
  if (inFile) {
    const label = routineLabel(target) || "(first routine)";
    if (owner !== label) {
      diags.push(
        error("E604", arg.span, `\`${arg.text}\` is not a step of \`${c.name}\`${owner ? ` (it is in \`${owner}\`)` : ""}`,
          operandName(arg.text) ? `\`${c.name}\` is in this file: write its step's name` : undefined),
      );
    }
  } else if (owner) {
    diags.push(error("E604", arg.span, `\`${arg.text}\` is a step of \`${owner}\`, not of \`${c.name}\``));
  } else if (operandName(arg.text)?.kind !== "step") {
    diags.push(
      error("E604", arg.span, `\`${c.name}\` is not in this file: name its step by its operand`, `e.g. \`SFR(${c.name},Step_000);\``),
    );
  }
}
