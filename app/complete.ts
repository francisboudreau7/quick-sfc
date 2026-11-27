/**
 * Autocomplete logic without CodeMirror: given one line, the cursor and what the last
 * compile knows (steps, tags), returns the word being completed and the candidates.
 * app/editor.ts turns the result into a CodeMirror completion source (CodeMirror does
 * the fuzzy filtering). Unit-tested in test/app.
 */
import { jumpArrow, lineKind, ST_KEYWORDS, tokenBefore, tokenizeLine } from "./highlight.js";

export interface StepInfo {
  name: string;
  presetMs?: number;
  description?: string;
  initial?: boolean;
}

export interface TagLike {
  name: string;
  type: string;
  declared: boolean;
  description?: string;
  uses: ReadonlyArray<{ line: number; col: number }>;
}

export interface RoutineInfo {
  name: string;
  kind: "sfc" | "st";
  /** The first routine of the file (SPEC §4.5). */
  main?: boolean;
}

export interface CompletionInfo {
  steps: readonly StepInfo[];
  tags: readonly TagLike[];
  /** Routines of the file, for `call name;` and `JSR(name, 0);`. */
  routines?: readonly RoutineInfo[];
}

export type OptionType = "keyword" | "variable" | "type" | "property" | "class" | "constant";

export interface Option {
  label: string;
  type: OptionType;
  /** Short text shown after the label. */
  detail?: string;
  /** Longer description shown beside the list. */
  info?: string;
  /** Text inserted instead of the label. */
  apply?: string;
  /** Sort priority (higher first), CodeMirror's `boost`. */
  boost?: number;
}

export interface CompletionResult {
  /** 0-based offsets in the line of the text the completion replaces. */
  from: number;
  to: number;
  options: Option[];
}

export interface CompleteOptions {
  /** Ctrl+Space: also complete with nothing typed yet. */
  explicit?: boolean;
  /** 1-based number of the line, to leave out a tag that is only the word being typed. */
  lineNumber?: number;
}

/**
 * SFC_STEP members (SPEC §7.3) with a short description; the readable names (`.active` `.done`
 * `.time` `.first`, Phase 4c) first. They export as `.X` `.DN` `.T` `.FS`.
 */
export const STEP_MEMBERS: ReadonlyArray<{ name: string; detail: string; info: string }> = [
  { name: "active", detail: "step active (= X)", info: "TRUE while the step is active. Exported as .X." },
  { name: "done", detail: "timer done (= DN)", info: "TRUE once the step has been active for its preset. Exported as .DN." },
  { name: "time", detail: "time active, ms (= T)", info: "Time the step has been active, in milliseconds. Exported as .T." },
  { name: "first", detail: "first scan (= FS)", info: "TRUE only on the first scan after the step becomes active. Exported as .FS." },
  { name: "X", detail: "step active", info: "TRUE while the step is active." },
  { name: "FS", detail: "first scan", info: "TRUE only on the first scan after the step becomes active." },
  { name: "LS", detail: "last scan", info: "TRUE on the last scan before the step becomes inactive." },
  { name: "DN", detail: "timer done", info: "TRUE once the step has been active for its preset (PRE)." },
  { name: "T", detail: "time active (ms)", info: "Time the step has been active, in milliseconds (DINT)." },
  { name: "PRE", detail: "preset (ms)", info: "Timer preset in milliseconds, set by the step's duration." },
  { name: "SA", detail: "step active (SA bit)", info: "SFC_STEP SA bit (see the Studio 5000 SFC_STEP reference)." },
  { name: "OV", detail: "timer overflow", info: "TRUE when the step timer overflowed." },
  { name: "TMax", detail: "longest time active (ms)", info: "Longest time the step has been active, in milliseconds." },
  { name: "Count", detail: "activation count", info: "Number of times the step has become active." },
  { name: "Reset", detail: "reset the step", info: "Set to reset the step's timer and counters." },
  { name: "PauseTimer", detail: "pause the timer", info: "Set to pause the step timer." },
  { name: "AlarmEn", detail: "enable time alarms", info: "Enables the LimitLow / LimitHigh time alarms." },
  { name: "AlarmLow", detail: "active too short", info: "Alarm: the step was active for less than LimitLow." },
  { name: "AlarmHigh", detail: "active too long", info: "Alarm: the step has been active for more than LimitHigh." },
  { name: "LimitLow", detail: "low time limit (ms)", info: "Low alarm limit, in milliseconds." },
  { name: "LimitHigh", detail: "high time limit (ms)", info: "High alarm limit, in milliseconds." },
  { name: "Status", detail: "status word", info: "SFC_STEP status (DINT)." },
];

/** TIMER members, for tags declared `: TIMER`. */
export const TIMER_MEMBERS: ReadonlyArray<{ name: string; detail: string }> = [
  { name: "DN", detail: "done" },
  { name: "TT", detail: "timing" },
  { name: "EN", detail: "enabled" },
  { name: "PRE", detail: "preset (ms)" },
  { name: "ACC", detail: "accumulated (ms)" },
];

export const TAG_TYPES: ReadonlyArray<{ name: string; detail: string }> = [
  { name: "BOOL", detail: "TRUE / FALSE" },
  { name: "DINT", detail: "32-bit integer" },
  { name: "REAL", detail: "floating point" },
  { name: "TIMER", detail: "timer (.DN, .ACC, .PRE)" },
];

/** Keywords offered at the start of a line, with what they insert. */
export const LINE_KEYWORDS: ReadonlyArray<Option> = [
  { label: "step", type: "keyword", apply: "step ", detail: "step name [5s] [\"description\"]", boost: 3 },
  { label: "--", type: "keyword", apply: "-- ", detail: "transition: -- [name:] condition [-> step]", boost: 3 },
  { label: "init", type: "keyword", apply: "init ", detail: "initial step", boost: 2 },
  { label: "select", type: "keyword", detail: "selection branch (one leg runs)", boost: 1 },
  { label: "parallel", type: "keyword", detail: "parallel branch (all legs run)", boost: 1 },
  { label: "end", type: "keyword", detail: "end of a select / parallel block", boost: 1 },
  { label: "tag", type: "keyword", apply: "tag ", detail: "tag name [: TYPE] [\"description\"]" },
  { label: "sfc", type: "keyword", apply: "sfc ", detail: "sfc name: starts an SFC routine" },
  { label: "st", type: "keyword", apply: "st ", detail: "st name: starts an ST routine" },
  { label: "program", type: "keyword", apply: "program ", detail: "program name [\"title\"] (before the first routine)" },
  { label: "io", type: "keyword", detail: "io … end: name  Local:1:I.Data.0  [\"description\"] (alias tags)" },
  { label: "course", type: "keyword", apply: "course \"", detail: "course \"…\": printed in the title block" },
  { label: "author", type: "keyword", apply: "author \"", detail: "author \"…\": printed in the title block" },
];

/** `after 5s` in a condition (SPEC §4.4): offered with the condition keywords. */
export const AFTER_OPTION: Option = {
  label: "after",
  type: "keyword",
  apply: "after ",
  detail: "after 5s: the step above has been active 5 s",
  info: "Exported as step.T >= 5000, where step is the step before this transition.",
};

/** Action qualifiers (SPEC §4.3), offered at the start of a line: a qualifier line starts an action. */
export const QUALIFIER_OPTIONS: ReadonlyArray<Option> = [
  { label: "N", type: "keyword", detail: "action: while the step is active", boost: -2 },
  { label: "S", type: "keyword", detail: "action: stored, runs until reset (R)", boost: -2 },
  { label: "R", type: "keyword", detail: "action: resets a stored action", boost: -2 },
  { label: "L", type: "keyword", apply: "L 5s", detail: "action: time limited (L 5s)", boost: -2 },
  { label: "D", type: "keyword", apply: "D 5s", detail: "action: time delayed (D 5s)", boost: -2 },
  { label: "P", type: "keyword", detail: "action: pulse, once when the step becomes active", boost: -2 },
];

/** Output sugar keywords (SPEC §4.3), offered at the start of a line. */
export const SUGAR_OPTIONS: ReadonlyArray<Option> = [
  { label: "on", type: "keyword", apply: "on ", detail: "on a, b: a [:=] 1; b [:=] 1;", boost: 1 },
  { label: "set", type: "keyword", apply: "set ", detail: "set a: a := 1;", boost: 1 },
  { label: "reset", type: "keyword", apply: "reset ", detail: "reset a: a := 0;", boost: 1 },
];

const CONDITION_KEYWORDS = ["AND", "OR", "XOR", "NOT", "TRUE", "FALSE", "MOD"];
const ACTION_KEYWORDS = [...ST_KEYWORDS, "call"];

function routineOption(r: RoutineInfo): Option {
  return { label: r.name, type: "class", detail: `${r.kind.toUpperCase()} routine${r.main ? " · main" : ""}` };
}

function formatMs(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

function stepOption(s: StepInfo): Option {
  const bits = [s.initial ? "initial step" : "step"];
  if (s.presetMs !== undefined) bits.push(formatMs(s.presetMs));
  const o: Option = { label: s.name, type: "class", detail: bits.join(" · ") };
  if (s.description) o.info = s.description;
  return o;
}

function tagOption(t: TagLike): Option {
  const o: Option = { label: t.name, type: "variable", detail: t.declared ? `${t.type} (declared)` : t.type, boost: 1 };
  if (t.description) o.info = t.description;
  return o;
}

/** Tags, leaving out one whose only use is the word being typed (it would complete itself). */
function tagOptions(info: CompletionInfo, lineNumber: number | undefined, wordCol: number): Option[] {
  return info.tags
    .filter((t) => !(lineNumber !== undefined && t.uses.length <= 1 && !t.declared && t.uses.every((u) => u.line === lineNumber && u.col === wordCol)))
    .map(tagOption);
}

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Completion in ST text (condition or action) at `pos`. */
function completeST(
  line: string,
  pos: number,
  info: CompletionInfo,
  opts: CompleteOptions,
  where: "condition" | "action",
): CompletionResult | null {
  const before = line.slice(0, pos);
  // `call name` and `JSR(name`: routine names (SPEC §4.5).
  const callM = /(?:^|[^\w.])call[ \t]+(\w*)$/i.exec(before) ?? /(?:^|[^\w.])JSR[ \t]*\([ \t]*(\w*)$/i.exec(before);
  if (callM) {
    if (where === "condition") return null; // E602: a call is a statement
    const typed = callM[1]!;
    return { from: pos - typed.length, to: pos, options: (info.routines ?? []).map(routineOption) };
  }
  const member =/([A-Za-z_]\w*)[ \t]*\.(\w*)$/.exec(before);
  if (member) {
    const base = member[1]!;
    const typed = member[2]!;
    const from = pos - typed.length;
    const step = info.steps.find((s) => sameName(s.name, base));
    if (step) {
      const options = STEP_MEMBERS.map((m, i): Option => {
        const o: Option = { label: m.name, type: "property", detail: m.detail, info: m.info, boost: -i };
        if ((m.name === "DN" || m.name === "done") && step.presetMs === undefined) {
          o.info = `${m.info} ${step.name} has no preset, so ${m.name} is TRUE immediately (W302): add a duration, e.g. step ${step.name} 5s.`;
        }
        return o;
      });
      return { from, to: pos, options };
    }
    const tag = info.tags.find((t) => sameName(t.name, base));
    if (tag?.type === "TIMER") {
      return { from, to: pos, options: TIMER_MEMBERS.map((m) => ({ label: m.name, type: "property", detail: m.detail })) };
    }
    return null;
  }
  const word = /[A-Za-z_]\w*$/.exec(before)?.[0] ?? "";
  const from = pos - word.length;
  if (/[\w.#]$/.test(line.slice(0, from))) return null; // inside a number like 16#FF or after a dot
  if (!word && !opts.explicit) return null;
  const options: Option[] = [
    ...tagOptions(info, opts.lineNumber, from + 1),
    ...info.steps.map(stepOption),
    ...(where === "condition" ? CONDITION_KEYWORDS : ACTION_KEYWORDS).map(
      (k): Option => ({ label: k, type: "keyword", boost: -1 }),
    ),
    ...(where === "condition" ? [AFTER_OPTION] : []),
  ];
  return { from, to: pos, options };
}

/**
 * Completion at `pos` (0-based offset in `line`). Returns null when there is nothing to
 * offer (inside a string or comment, naming a new step, ...).
 */
export function completeLine(line: string, pos: number, info: CompletionInfo, opts: CompleteOptions = {}): CompletionResult | null {
  const tokens = tokenizeLine(line);
  const inside = tokenBefore(tokens, pos);
  if (inside && (inside.kind === "comment" || (inside.kind === "string" && !(pos === inside.to && isClosedString(line, inside))))) {
    return null;
  }
  const before = line.slice(0, pos);
  const lead = /^[ \t]*/.exec(before)![0].length;
  const first = before.slice(lead);

  // `on` / `set` / `reset` names (SPEC §4.3): tags only, BOOL ones first.
  const sugarM = /^[ \t]*(?:on|set|reset)[ \t]+(?:[A-Za-z_]\w*[ \t]*,[ \t]*)*(\w*)$/i.exec(before);
  if (sugarM) {
    const typed = sugarM[1]!;
    const from = pos - typed.length;
    const options = tagOptions(info, opts.lineNumber, from + 1).map((o) => (o.detail?.startsWith("BOOL") ? { ...o, boost: 2 } : o));
    return { from, to: pos, options };
  }

  // Start of a line: keywords, and (for action lines) tags.
  if (/^-{1,2}$/.test(first)) {
    if (line.slice(pos).trim() !== "") return null;
    return { from: lead, to: pos, options: LINE_KEYWORDS.filter((k) => k.label === "--") };
  }
  if (/^[A-Za-z_]\w*$/.test(first) || (first === "" && opts.explicit)) {
    const options: Option[] = [...LINE_KEYWORDS, ...SUGAR_OPTIONS, ...QUALIFIER_OPTIONS];
    if (first !== "") {
      options.push(...completeST(line, pos, info, opts, "action")!.options);
    }
    return { from: lead, to: pos, options };
  }
  if (first === "") return null;

  const { kind } = lineKind(line);
  switch (kind) {
    case "tag": {
      const typeM = /^[ \t]*tag[ \t]+\w+[ \t]*:[ \t]*(\w*)$/i.exec(before);
      if (typeM) {
        const typed = typeM[1]!;
        return { from: pos - typed.length, to: pos, options: TAG_TYPES.map((t) => ({ label: t.name, type: "type", detail: t.detail })) };
      }
      const nameM = /^[ \t]*tag[ \t]+(\w*)$/i.exec(before);
      if (nameM) {
        const typed = nameM[1]!;
        if (!typed && !opts.explicit) return null;
        return { from: pos - typed.length, to: pos, options: info.tags.filter((t) => !t.declared).map(tagOption) };
      }
      return null;
    }
    case "transition": {
      const start = before.indexOf("--") + 2;
      const arrow = jumpArrow(line, start);
      if (arrow >= 0 && arrow + 2 <= pos) {
        const m = /^[ \t]*(\w*)$/.exec(line.slice(arrow + 2, pos));
        if (!m) return null;
        const typed = m[1]!;
        return { from: pos - typed.length, to: pos, options: info.steps.map(stepOption) };
      }
      // Right after `--` (no space yet): nothing to complete.
      if (pos <= start) return null;
      return completeST(line, pos, info, opts, "condition");
    }
    case "action":
      return completeST(line, pos, info, opts, "action");
    default:
      // step / init / sfc / select / parallel / end / | lines: names are new, nothing to offer.
      return null;
  }
}

function isClosedString(line: string, t: { from: number; to: number }): boolean {
  const q = line[t.from];
  return t.to - t.from >= 2 && line[t.to - 1] === q;
}
