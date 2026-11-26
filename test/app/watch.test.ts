import { describe, expect, it } from "vitest";
import { decidePoll, MAX_FAILURES, sameStamp, shouldApplyText, Watcher, type PollState, type WatchFile } from "../../app/watch.js";

describe("decidePoll", () => {
  const s1 = { lastModified: 1000, size: 10 };
  it("first read reloads", () => {
    expect(decidePoll({ stamp: undefined, failures: 0 }, { ok: true, stamp: s1 })).toEqual({
      state: { stamp: s1, failures: 0 },
      action: "reload",
    });
  });
  it("same stamp: nothing", () => {
    expect(decidePoll({ stamp: s1, failures: 0 }, { ok: true, stamp: { ...s1 } }).action).toBe("none");
  });
  it("changed time or size: reload", () => {
    expect(decidePoll({ stamp: s1, failures: 0 }, { ok: true, stamp: { lastModified: 2000, size: 10 } }).action).toBe("reload");
    expect(decidePoll({ stamp: s1, failures: 0 }, { ok: true, stamp: { lastModified: 1000, size: 11 } }).action).toBe("reload");
  });
  it("failures count up, stop after MAX_FAILURES, reset on success", () => {
    let st: PollState = { stamp: s1, failures: 0 };
    for (let i = 1; i < MAX_FAILURES; i++) {
      const r = decidePoll(st, { ok: false, error: "gone" });
      expect(r.action).toBe("none");
      st = r.state;
    }
    expect(decidePoll(st, { ok: false, error: "gone" }).action).toBe("stop");
    expect(decidePoll(st, { ok: true, stamp: s1 }).state.failures).toBe(0);
  });
  it("helpers", () => {
    expect(sameStamp(undefined, s1)).toBe(false);
    expect(sameStamp(s1, { ...s1 })).toBe(true);
    expect(shouldApplyText("a", "a")).toBe(false);
    expect(shouldApplyText("a", "b")).toBe(true);
  });
});

describe("Watcher", () => {
  function setup() {
    let file: WatchFile | Error = { lastModified: 1, size: 1, text: async () => "v1" };
    const changes: string[] = [];
    const stops: string[] = [];
    const timers: Array<() => void> = [];
    const w = new Watcher({
      getFile: async () => {
        if (file instanceof Error) throw file;
        return file;
      },
      onChange: (t) => changes.push(t),
      onStop: (r) => stops.push(r),
      setTimer: (fn) => timers.push(fn) - 1,
      clearTimer: () => {},
    });
    return {
      w,
      changes,
      stops,
      timers,
      set(f: WatchFile | Error) {
        file = f;
      },
      async next() {
        const fn = timers.shift();
        fn?.();
        await new Promise((r) => setTimeout(r, 0));
      },
    };
  }

  it("reads at start, then reloads only on change", async () => {
    const t = setup();
    await t.w.start();
    expect(t.changes).toEqual(["v1"]);
    expect(t.timers.length).toBe(1);
    await t.next();
    expect(t.changes).toEqual(["v1"]);
    t.set({ lastModified: 2, size: 1, text: async () => "v2" });
    await t.next();
    expect(t.changes).toEqual(["v1", "v2"]);
  });

  it("stops after repeated errors and reports why", async () => {
    const t = setup();
    await t.w.start();
    t.set(new Error("file not found"));
    for (let i = 0; i < MAX_FAILURES; i++) await t.next();
    expect(t.stops).toEqual(["file not found"]);
    expect(t.w.running).toBe(false);
    expect(t.timers.length).toBe(0);
  });

  it("stop() prevents further polls and callbacks", async () => {
    const t = setup();
    await t.w.start();
    t.w.stop();
    t.set({ lastModified: 5, size: 1, text: async () => "v5" });
    await t.next();
    expect(t.changes).toEqual(["v1"]);
  });

  it("overlapping ticks are skipped", async () => {
    const t = setup();
    const a = t.w.tick();
    const b = t.w.tick();
    await Promise.all([a, b]);
    expect(t.changes).toEqual(["v1"]);
  });
});

describe("Watcher: read failures (code review fix)", () => {
  it("stops after MAX_FAILURES failed reads even when the file can still be stat'ed", async () => {
    let n = 0;
    const stops: string[] = [];
    const timers: Array<() => void> = [];
    const w = new Watcher({
      getFile: async () => ({ lastModified: ++n, size: 1, text: async () => { throw new Error("locked"); } }),
      onChange: () => {},
      onStop: (r) => stops.push(r),
      setTimer: (fn) => { timers.push(fn); return timers.length; },
      clearTimer: () => {},
    });
    await w.start();
    for (let i = 1; i < MAX_FAILURES; i++) await w.tick();
    expect(w.running).toBe(false);
    expect(stops).toHaveLength(1);
  });
});
