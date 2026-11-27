import { describe, expect, it } from "vitest";
import { activeLines, clockText, routineLive, simDraw, traceLines } from "../../app/sim.js";
import { compile } from "../../src/compile.js";
import { Simulator } from "../../src/sim/index.js";

const SRC = ["init idle", "-- start_btn", "step fill 1s", "  on valve", "-- fill.done -> idle", ""].join("\n");

describe("app/sim: what the window shows while simulating", () => {
  it("simDraw: the active step, its timer, each transition's state and parts", () => {
    const r = compile(SRC, { fileName: "t.qsfc" });
    const s = new Simulator(r);
    s.scan();
    const routine = r.routines[0]!;
    let d = simDraw(s, routine)!;
    const [t0, t1] = routine.graph!.transitions;
    expect([...d.active].map((id) => routine.graph!.steps.find((x) => x.id === id)!.name)).toEqual(["idle"]);
    expect(d.transitions.get(t0!.id)!.state).toBe("false");
    expect(d.transitions.get(t1!.id)!.state).toBe("idle");
    expect(d.transitions.get(t0!.id)!.parts).toEqual([expect.objectContaining({ input: "start_btn", value: false })]);
    s.setTag("start_btn", true);
    s.scan();
    s.scan();
    s.scan();
    d = simDraw(s, routine)!;
    expect([...d.badges!.values()]).toEqual(["0.1 / 1.0 s"]); // T = 0 on its first scan
    expect(d.transitions.get(t1!.id)!.state).toBe("false");
  });

  it("activeLines: the active step's line and its action lines", () => {
    const r = compile(SRC, { fileName: "t.qsfc" });
    const s = new Simulator(r);
    s.scan();
    expect(activeLines(s, r.routines)).toEqual({ steps: [1], actions: [] });
    s.setTag("start_btn", true);
    s.scan();
    expect(activeLines(s, r.routines)).toEqual({ steps: [3], actions: [4] });
    expect(routineLive(s, r.routines[0]!.name)).toBe(true);
    expect(routineLive(s, "other")).toBe(false);
  });

  it("clock and trace text", () => {
    expect(clockText(6400, 64)).toBe("t = 00:06.400 · scan 64");
    expect(clockText(61_000, 610)).toBe("t = 01:01.000 · scan 610");
    const lines = traceLines([
      { scan: 1, time: 0, kind: "start", text: "X starts at idle" },
      { scan: 50, time: 5000, kind: "fire", text: "-- fill.done fires: fill → idle" },
    ]);
    expect(lines).toEqual([
      { kind: "fire", text: "scan 50 · t 05.0 · -- fill.done fires: fill → idle" },
      { kind: "start", text: "scan 1 · t 00.0 · X starts at idle" },
    ]);
  });
});
