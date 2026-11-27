/**
 * Simulation in the window (Phase 4e, docs/mockups/sim): the pure part. What the diagram draws
 * (SimDraw), the editor lines to light up, the trace lines and the clock. Unit-tested in test/app.
 */
import type { CompiledRoutine } from "../src/compile.js";
import { walk } from "../src/model/ast.js";
import type { SimDraw, SimTransition } from "../src/render/svg.js";
import type { Simulator, TraceEvent } from "../src/sim/index.js";

const secs = (ms: number): string => (ms / 1000).toFixed(1);

/** The live state of one SFC routine, for renderSvg's `sim` option. */
export function simDraw(sim: Simulator, routine: CompiledRoutine): SimDraw | undefined {
  const g = routine.graph;
  if (!g) return undefined;
  const steps = sim.stepList().filter((s) => s.routine === routine.name);
  const active = new Set(steps.filter((s) => s.active).map((s) => s.id));
  const badges = new Map<string, string>();
  for (const s of steps) if (s.active && s.presetMs > 0) badges.set(s.id, `${secs(Math.min(s.t, s.presetMs))} / ${secs(s.presetMs)} s`);
  const transitions = new Map<string, SimTransition>();
  for (const t of g.transitions) {
    const v = sim.transition(routine.name, t.id);
    transitions.set(t.id, { state: v.enabled ? (v.value ? "true" : "false") : "idle", parts: sim.conditionParts(routine.name, t.id) });
  }
  return { active, badges, transitions };
}

/** Editor lines to light up: each active step's line, and its action lines. */
export function activeLines(sim: Simulator, routines: readonly CompiledRoutine[]): { steps: number[]; actions: number[] } {
  const live = new Set(sim.stepList().filter((s) => s.active).map((s) => `${s.routine}/${s.name.toLowerCase()}`));
  const steps: number[] = [];
  const actions: number[] = [];
  for (const r of routines) {
    if (r.node.kind !== "sfc") continue;
    for (const el of walk(r.node.chart.body)) {
      if (el.kind !== "step" || !live.has(`${r.name}/${el.name.text.toLowerCase()}`)) continue;
      steps.push(el.span.line);
      for (const a of el.actions) {
        if (a.header) actions.push(a.header.line);
        for (const l of a.lines) actions.push(l.span.line);
      }
    }
  }
  return { steps, actions };
}

/** "t = 00:06.400 · scan 64" */
export function clockText(timeMs: number, scans: number): string {
  const m = Math.floor(timeMs / 60000);
  const s = (timeMs % 60000) / 1000;
  return `t = ${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")} · scan ${scans}`;
}

/** The trace, newest first, as text lines: "scan 50 · t 05.0 · -- fill.done fires: fill → check". */
export function traceLines(trace: readonly TraceEvent[], max = 200): Array<{ kind: TraceEvent["kind"]; text: string }> {
  return trace
    .slice(-max)
    .reverse()
    .map((e) => ({ kind: e.kind, text: `scan ${e.scan} · t ${secs(e.time).padStart(4, "0")} · ${e.text}` }));
}

/** Whether a routine has an active step (a dot on its tab). */
export function routineLive(sim: Simulator, name: string): boolean {
  return sim.stepList().some((s) => s.routine === name && s.active);
}
