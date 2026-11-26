/**
 * Watch mode (Edge/Chrome): follow a file edited elsewhere by polling its
 * `lastModified` and size. The decision logic is pure; `Watcher` runs it with injected
 * file access and timers, so both are unit-tested in test/app.
 */

export const POLL_MS = 700;
/** Consecutive read failures (file deleted, permission lost) before watching stops. */
export const MAX_FAILURES = 3;

export interface Stamp {
  lastModified: number;
  size: number;
}

export interface PollState {
  /** Stamp of the content currently shown; undefined before the first read. */
  stamp: Stamp | undefined;
  failures: number;
}

export type PollOutcome = { ok: true; stamp: Stamp } | { ok: false; error: string };
export type PollAction = "none" | "reload" | "stop";

export function sameStamp(a: Stamp | undefined, b: Stamp | undefined): boolean {
  return !!a && !!b && a.lastModified === b.lastModified && a.size === b.size;
}

/** What to do after one poll. */
export function decidePoll(state: PollState, outcome: PollOutcome): { state: PollState; action: PollAction } {
  if (!outcome.ok) {
    const failures = state.failures + 1;
    return { state: { stamp: state.stamp, failures }, action: failures >= MAX_FAILURES ? "stop" : "none" };
  }
  if (sameStamp(state.stamp, outcome.stamp)) return { state: { stamp: state.stamp, failures: 0 }, action: "none" };
  return { state: { stamp: outcome.stamp, failures: 0 }, action: "reload" };
}

/**
 * Replace the editor text only when the file content differs, so an unchanged save
 * (or a touch) does not move the cursor.
 */
export function shouldApplyText(current: string, incoming: string): boolean {
  return current !== incoming;
}

export interface WatchFile {
  lastModified: number;
  size: number;
  text(): Promise<string>;
}

export interface WatcherDeps {
  /** Reads the watched file (handle.getFile()). */
  getFile(): Promise<WatchFile>;
  /** Called with the new content after each change (and once at start). */
  onChange(text: string): void;
  /** Called once when watching stops on its own (after MAX_FAILURES errors). */
  onStop(reason: string): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
}

export class Watcher {
  private state: PollState = { stamp: undefined, failures: 0 };
  private timer: unknown;
  private busy = false;
  private stopped = false;

  constructor(private readonly deps: WatcherDeps, private readonly interval = POLL_MS) {}

  /** Reads the file now, then polls. */
  start(): Promise<void> {
    return this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) this.deps.clearTimer(this.timer);
    this.timer = undefined;
  }

  get running(): boolean {
    return !this.stopped;
  }

  /** One poll. Overlapping polls are skipped (a slow disk must not pile them up). */
  async tick(): Promise<void> {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      let outcome: PollOutcome;
      let file: WatchFile | undefined;
      try {
        file = await this.deps.getFile();
        outcome = { ok: true, stamp: { lastModified: file.lastModified, size: file.size } };
      } catch (e) {
        outcome = { ok: false, error: (e as Error)?.message ?? String(e) };
      }
      if (this.stopped) return;
      const { state, action } = decidePoll(this.state, outcome);
      if (action === "reload" && file) {
        try {
          const text = await file.text();
          if (this.stopped) return;
          this.state = state;
          this.deps.onChange(text);
        } catch (e) {
          const failed = decidePoll(this.state, { ok: false, error: String(e) });
          this.state = failed.state;
          if (failed.action === "stop") {
            this.stop();
            this.deps.onStop(String(e));
            return;
          }
        }
      } else {
        this.state = state;
      }
      if (action === "stop") {
        this.stop();
        this.deps.onStop(outcome.ok ? "stopped" : outcome.error);
        return;
      }
    } finally {
      this.busy = false;
    }
    if (!this.stopped) this.timer = this.deps.setTimer(() => void this.tick(), this.interval);
  }
}
