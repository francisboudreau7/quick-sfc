import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile.js";
import { Simulator } from "../../src/sim/index.js";

const sim = (src: string) => {
  const r = compile(src, { fileName: "t.qsfc" });
  if (!r.graph && !r.routines.some((x) => x.graph)) throw new Error(JSON.stringify(r.diagnostics));
  return new Simulator(r);
};
const active = (s: Simulator) => s.stepList().filter((x) => x.active).map((x) => x.name);
const tag = (s: Simulator, n: string) => s.tagList().find((t) => t.name === n)?.value;
const scans = (s: Simulator, n: number) => {
  for (let i = 0; i < n; i++) s.scan();
};

const TANK = [
  "init idle",
  "-- start_btn",
  "step fill 1s",
  "  on valve",
  "-- fill.done",
  "step check",
  "select",
  "  -- level_ok",
  "  step mix 500ms",
  "    on mixer",
  "  -- mix.done -> idle",
  "|",
  "  -- else",
  "  step alarm",
  "    set alarm_lamp",
  "  -- ack_btn -> idle",
  "end",
  "",
].join("\n");

describe("simulation: one step forward per scan, like the PLC", () => {
  it("runs the tank: inputs, step timers, [:=] reset on the last scan, the else leg", () => {
    const s = sim(TANK);
    s.scan();
    expect(active(s)).toEqual(["idle"]);
    expect(s.tagList().filter((t) => t.input).map((t) => t.name).sort()).toEqual(["ack_btn", "level_ok", "start_btn"]);
    s.setTag("start_btn", true);
    s.scan(); // idle -> fill
    expect(active(s)).toEqual(["fill"]);
    s.setTag("start_btn", false);
    s.scan(); // fill's first scan
    expect(tag(s, "valve")).toBe(true);
    scans(s, 10); // 1 s
    expect(active(s)).toEqual(["check"]);
    expect(tag(s, "valve")).toBe(false); // [:=]: back to 0 when fill ended
    s.scan(); // check -> else leg (level_ok is 0)
    expect(active(s)).toEqual(["alarm"]);
    s.scan();
    expect(tag(s, "alarm_lamp")).toBe(true);
    expect(s.trace.some((e) => e.kind === "fire" && e.text.includes("check → alarm") && e.text.includes("-- else fires"))).toBe(true);
  });

  it("parallel: both legs start; the transition after end waits for both", () => {
    const s = sim("init a\n-- go\nparallel\n  step b\n  -- x\n  step b2\n|\n  step c\nend\n-- TRUE -> a\n");
    s.setTag("go", true);
    scans(s, 2);
    expect(active(s).sort()).toEqual(["b", "c"]);
    scans(s, 3);
    expect(active(s).sort()).toEqual(["b", "c"]);
    s.setTag("x", true);
    s.scan(); // b -> b2
    expect(active(s).sort()).toEqual(["b2", "c"]);
    s.scan(); // both legs done -> a
    expect(active(s)).toEqual(["a"]);
  });

  it("qualifiers: S runs on after its step until an R action, P once, L limited, D delayed", () => {
    const s = sim("init a\n  S\n    lock := 1;\n  P\n    n := n + 1;\n  L 300ms\n    horn [:=] 1;\n  D 200ms\n    light [:=] 1;\n-- go\nstep b\n  R\n    lock := 0;\n-- back -> a\n");
    s.scan();
    expect(tag(s, "lock")).toBe(true);
    expect(tag(s, "n")).toBe(1);
    expect(tag(s, "horn")).toBe(true);
    expect(tag(s, "light")).toBe(false);
    scans(s, 3);
    expect(tag(s, "n")).toBe(1);
    expect(tag(s, "horn")).toBe(false);
    expect(tag(s, "light")).toBe(true);
    s.setTag("go", true);
    scans(s, 2); // a -> b; lock still 1 (stored) until b's R runs
    s.setTag("go", false);
    expect(active(s)).toEqual(["b"]);
    s.scan();
    expect(tag(s, "lock")).toBe(false);
  });

  it("an ST main routine calls the SFC; IF works; other statements are skipped with a note", () => {
    const s = sim("st main\n  call seq;\n  IF seq_run.X THEN lamp := 1; ELSE lamp := 0; END_IF;\n  TON(t1, x, 0);\n\nsfc seq\ninit seq_idle\n-- go\nstep seq_run\n-- stop -> seq_idle\n");
    s.setTag("go", true);
    scans(s, 3);
    expect(active(s)).toEqual(["seq_run"]);
    expect(tag(s, "lamp")).toBe(true);
    expect(s.trace.filter((e) => e.kind === "note").map((e) => e.text)).toEqual(["line 4: `TON(t1, x, 0);` is not simulated yet (skipped)"]);
  });

  it("fires a transition by hand, when its step is active", () => {
    const s = sim(TANK);
    s.scan();
    const g = compile(TANK, { fileName: "t.qsfc" }).graph!;
    const t1 = g.transitions.find((t) => t.condition === "fill.done")!.id;
    expect(s.fire("t", t1)).toBe("fill must be active");
    const t0 = g.transitions.find((t) => t.condition === "start_btn")!.id;
    expect(s.fire("t", t0)).toBeUndefined();
    s.scan();
    expect(active(s)).toEqual(["fill"]);
    expect(s.trace.at(-1)!.text).toBe("by hand: -- start_btn fires: idle → fill");
  });

  it("condition parts: inputs are buttons, comparisons show their value, after and members", () => {
    const s = sim("init a\n-- go AND NOT stop AND count < 10 AND a.done\nstep b 1s\n-- after 300ms -> a\n");
    s.setTag("count", 7);
    s.setTag("go", true);
    const g = compile("init a\n-- go AND NOT stop AND count < 10 AND a.done\nstep b 1s\n-- after 300ms -> a\n", { fileName: "t.qsfc" }).graph!;
    const parts = s.conditionParts("t", g.transitions[0]!.id);
    expect(parts.map((p) => `${p.input ?? ""}${p.label ?? ""}:${p.value}`)).toEqual(["go:true", "stop:false", "count=7:true", ":false"]);
    s.scan();
    expect(active(s)).toEqual(["b"]);
    scans(s, 3); // b has been active 200 ms
    expect(s.conditionParts("t", g.transitions[1]!.id)[0]!.value).toBe(false);
    s.scan(); // 300 ms: after 300ms is true and fires
    expect(active(s)).toEqual(["a"]);
  });
});
