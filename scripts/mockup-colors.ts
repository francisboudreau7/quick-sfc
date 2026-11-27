/**
 * Builds docs/mockups/colors/index.html: readability stress tests of the editor's colors, the
 * current scheme against candidate schemes, in light / dark and under color-vision deficiency
 * simulations, with a measured scorecard (WCAG contrast, CIE76 ΔE between roles that must differ).
 *   npx tsx scripts/mockup-colors.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ioStateAfter, lineKind, tokenizeLine, type TokKind } from "../app/highlight.js";

// ---- stress tests --------------------------------------------------------------------------------

interface Test {
  id: string;
  title: string;
  check: string;
  source: string;
  /** 1-based line → a diagnostic squiggle from col a to b (1-based, end exclusive). */
  squiggles?: Array<{ line: number; from: number; to: number; severity: "error" | "warning" }>;
}

const T = (...l: string[]) => l.join("\n");

const TESTS: Test[] = [
  {
    id: "scan",
    title: "1 · Scan a chart",
    check: "Without reading: where are the steps? where are the transitions? which lines are actions?",
    source: T(
      "sfc cycle",
      "init cycle_wait",
      "  reset done_lamp",
      "-- start_btn AND NOT fault",
      "step cycle_fill 4s",
      "  on conveyor, fill_valve",
      "  speed := 1500;",
      "-- cycle_fill.DN OR level_high",
      "step cycle_mix 10s",
      "  on mixer",
      "  IF temp > 80 THEN",
      "    heater [:=] 0;",
      "  END_IF;",
      "-- cycle_mix.done",
      "step cycle_drain",
      "  on drain_valve",
      "-- after 3s -> cycle_wait",
    ),
  },
  {
    id: "dense",
    title: "2 · A dense condition",
    check: "Tell steps (cycle_run), tags (gros, t1), members (.DN, .ACC), operators and numbers apart.",
    source: T(
      "init cycle_wait",
      "-- go: (gros OR moyen) AND cycle_wait.DN AND NOT (man AND start_edge) OR count >= 10 AND t1.ACC > 500",
      "step cycle_run 2s",
      "-- cycle_run.DN AND (auto OR (man AND start_edge)) -> cycle_wait",
    ),
  },
  {
    id: "actions",
    title: "3 · Actions",
    check: "Qualifier lines, sugar, ST keywords, [:=] vs :=, function calls, strings and comments.",
    source: T(
      "init idle",
      "-- start_btn",
      'step heat 20s "Heat the oven"',
      "  on heater, fan          // N while active",
      "  S",
      "    door_lock := 1;",
      "  L 5s",
      "    buzzer [:=] 1;",
      "  P",
      "    cycles := cycles + 1;",
      "    TON(t_cool, fan, 0);",
      "    msg := 'cycle started';",
      "  CASE mode OF",
      "    1: speed := 100;",
      "    2: speed := 250;",
      "  END_CASE;",
      "-- heat.done -> idle",
    ),
  },
  {
    id: "branches",
    title: "4 · Nested branches",
    check: "Follow select / parallel / | / end, and see where each jump goes.",
    source: T(
      "init idle",
      "-- start_btn",
      "parallel",
      "  step check",
      "  select",
      "    -- ok",
      "    step good",
      "    -- TRUE",
      "  |",
      "    -- NOT ok",
      "    step bad",
      "    -- TRUE",
      "  end",
      "  step checked",
      "|",
      "  step move",
      "  -- in_place",
      "  step moved",
      "end",
      "-- TRUE -> idle",
    ),
  },
  {
    id: "header",
    title: "5 · Declarations",
    check: "Names declared, their types, values, addresses and descriptions.",
    source: T(
      "controller",
      '  tag stop_req : BOOL = 1 "Stop at end of cycle"',
      "  io",
      '    e_stop     Local:1:I.Data.15  "Emergency stop"',
      "    ejections  cycle_run.Count",
      "  end",
      "  sfc tags cycle_wait",
      "end",
      'program line "Production line"',
      "uses INIT, MainRoutine (main)",
      'tag target : DINT = 10 "Parts per batch"',
      "tag t_cool : TIMER 3s",
      "",
      "sfc cycle",
      "init cycle_wait",
      "-- start_btn -> cycle_wait",
    ),
  },
  {
    id: "errors",
    title: "6 · Problems on colored text",
    check: "Error and warning squiggles must stay visible on every color.",
    source: T("init idle", "-- start_btn", "step fill 5", "  valve [:=] 1", "-- fill.done -> idel"),
    squiggles: [
      { line: 3, from: 11, to: 12, severity: "error" },
      { line: 4, from: 15, to: 16, severity: "warning" },
      { line: 5, from: 17, to: 21, severity: "error" },
    ],
  },
  {
    id: "names",
    title: "7 · Look-alike names",
    check: "fill (a step), fill_valve (a tag), fill.done (a step member), go (a transition), routines.",
    source: T(
      "st main",
      "  call fill_seq;",
      "  busy := fill.X OR rinse.X;",
      "",
      "sfc fill_seq",
      "init fill_idle",
      "-- go: start_btn",
      "step fill 5s",
      "  on fill_valve",
      "-- fill.done AND fill_level > 80",
      "step rinse",
      "  SFR(fill_seq, fill_idle);",
      "-- rinse.done -> fill_idle",
    ),
  },
];

// ---- roles and schemes -----------------------------------------------------------------------

type Role =
  | "kw" | "trans" | "branch" | "stkw" | "step" | "stepmember" | "def" | "label" | "literal" | "string" | "comment"
  | "member" | "func" | "type" | "op" | "ident" | "address"
  // roles by function (schemes D, E); the other schemes fall back to the roles above
  | "decl" | "declname" | "stepkw" | "action" | "time" | "logic" | "stctl" | "routine";

/** A role a scheme doesn't define takes the first one of these it does. */
const FALLBACK: Partial<Record<Role, Role[]>> = {
  decl: ["kw"], declname: ["def"], stepkw: ["kw"], action: ["kw"], time: ["literal"], logic: ["stkw"], stctl: ["stkw"], routine: ["ident"],
};

interface Style { color: string; weight?: number; italic?: boolean }
interface Scheme {
  id: string;
  /** Kept for the scorecard only (superseded). */
  hidden?: boolean;
  name: string;
  idea: string;
  light: Partial<Record<Role, Style>> & { bg: string; text: string };
  dark: Partial<Record<Role, Style>> & { bg: string; text: string };
  /** Line decorations: step band + transition bar (B), or one of the transition hints (page 2). */
  lines?: boolean;
  deco?: Deco;
}

const cur = (light: boolean): Partial<Record<Role, Style>> => {
  const c = light
    ? { kw: "#8250df", stkw: "#0550ae", def: "#953800", label: "#116329", num: "#0a6f7a", str: "#0a3069", comment: "#6e7781", member: "#8a5c00", func: "#6639ba", type: "#116329", op: "#57606a", ident: "#1d2228" }
    : { kw: "#d2a8ff", stkw: "#79c0ff", def: "#ffa657", label: "#7ee787", num: "#56d4dd", str: "#a5d6ff", comment: "#8b949e", member: "#e3b341", func: "#d2a8ff", type: "#7ee787", op: "#a0aab5", ident: "#e3e7eb" };
  return {
    kw: { color: c.kw, weight: 600 }, trans: { color: c.kw, weight: 600 }, branch: { color: c.kw, weight: 600 },
    stkw: { color: c.stkw, weight: 600 }, step: { color: c.ident }, stepmember: { color: c.member },
    def: { color: c.def, weight: 600 }, label: { color: c.label }, literal: { color: c.num }, string: { color: c.str },
    comment: { color: c.comment, italic: true }, member: { color: c.member }, func: { color: c.func }, type: { color: c.type },
    op: { color: c.op }, ident: { color: c.ident }, address: { color: c.num },
  };
};

const calm = (light: boolean): Partial<Record<Role, Style>> => {
  const c = light
    ? { kw: "#3f3cbb", step: "#b4440a", lit: "#0b7064", comment: "#6b7280", ident: "#1f2328", op: "#5b6270" }
    : { kw: "#a9b1ff", step: "#f5a524", lit: "#5ad7c4", comment: "#9aa3ad", ident: "#e6e8eb", op: "#9aa3ad" };
  return {
    kw: { color: c.kw, weight: 700 }, trans: { color: c.kw, weight: 700 }, branch: { color: c.kw, weight: 700 },
    stkw: { color: c.ident, weight: 700 }, step: { color: c.step, weight: 600 }, stepmember: { color: c.step },
    def: { color: c.ident, weight: 700 }, label: { color: c.kw }, literal: { color: c.lit }, string: { color: c.lit },
    comment: { color: c.comment, italic: true }, member: { color: c.ident }, func: { color: c.ident, italic: true },
    type: { color: c.kw }, op: { color: c.op }, ident: { color: c.ident }, address: { color: c.lit },
  };
};

const safe = (light: boolean): Partial<Record<Role, Style>> => {
  // Okabe-Ito hues, darkened (light) or kept (dark) to reach 4.5:1
  const c = light
    ? { kw: "#005f9e", step: "#a94400", lit: "#8e3d70", member: "#006b4e", comment: "#6b7280", ident: "#1f2328", op: "#5b6270" }
    : { kw: "#56b4e9", step: "#e69f00", lit: "#d88cb8", member: "#3cc59e", comment: "#9aa3ad", ident: "#e6e8eb", op: "#9aa3ad" };
  return {
    kw: { color: c.kw, weight: 700 }, trans: { color: c.kw, weight: 700 }, branch: { color: c.kw, weight: 700 },
    stkw: { color: c.ident, weight: 700 }, step: { color: c.step, weight: 600 }, stepmember: { color: c.step },
    def: { color: c.ident, weight: 700 }, label: { color: c.member }, literal: { color: c.lit }, string: { color: c.lit },
    comment: { color: c.comment, italic: true }, member: { color: c.member }, func: { color: c.ident, italic: true },
    type: { color: c.kw }, op: { color: c.op }, ident: { color: c.ident }, address: { color: c.lit },
  };
};

const roles = (light: boolean, safe: boolean): Partial<Record<Role, Style>> => {
  const c = !safe
    ? light
      ? { decl: "#1f2328", step: "#b4440a", trans: "#1d5fd1", branch: "#7c3aed", action: "#15803d", time: "#0e7490", value: "#be185d", comment: "#6b7280", ident: "#1f2328", op: "#6b7280" }
      : { decl: "#e6e8eb", step: "#f5a524", trans: "#6ea8ff", branch: "#c4a7ff", action: "#4ade80", time: "#22d3ee", value: "#f472b6", comment: "#9aa3ad", ident: "#e6e8eb", op: "#9aa3ad" }
    : light
      ? { decl: "#1f2328", step: "#b03a00", trans: "#005f9e", branch: "#9b3f7a", action: "#1b6e3a", time: "#b03a00", value: "#1f2328", comment: "#6b7280", ident: "#1f2328", op: "#6b7280" }
      : { decl: "#e6e8eb", step: "#ff8a4c", trans: "#56b4e9", branch: "#e48bc0", action: "#3fcf7a", time: "#ff8a4c", value: "#e6e8eb", comment: "#9aa3ad", ident: "#e6e8eb", op: "#9aa3ad" };
  return {
    decl: { color: c.decl, weight: 800 }, declname: { color: c.ident, weight: 700 }, type: { color: c.op }, address: { color: c.op },
    routine: { color: c.ident, weight: 700 },
    stepkw: { color: c.step, weight: 700 }, step: { color: c.step, weight: 600 }, stepmember: { color: c.step },
    trans: { color: c.trans, weight: 700 }, label: { color: c.trans, weight: 600 },
    branch: { color: c.branch, weight: 700 },
    action: { color: c.action, weight: 700 },
    time: { color: c.time, weight: 600, italic: safe },
    literal: { color: c.value, italic: safe }, string: { color: c.value, italic: safe },
    logic: { color: c.ident, weight: 700 }, stctl: { color: c.ident, weight: 700 }, stkw: { color: c.ident, weight: 700 },
    func: { color: c.ident, italic: true }, member: { color: c.ident }, ident: { color: c.ident },
    op: { color: c.op }, comment: { color: c.comment, italic: true }, kw: { color: c.decl, weight: 800 }, def: { color: c.ident, weight: 700 },
  };
};

const SCHEMES: Scheme[] = [
  { id: "cur", name: "Current", idea: "12 colors, one per token kind. Steps colored only where defined.", light: { bg: "#ffffff", text: "#1d2228", ...cur(true) }, dark: { bg: "#1c1f24", text: "#e3e7eb", ...cur(false) } },
  { id: "calm", hidden: true, name: "A · Calm", idea: "4 hues for meaning: structure (indigo), steps everywhere they appear (amber), literals (teal), comments (gray). Tags, members and ST keywords stay text color; bold carries the rest.", light: { bg: "#ffffff", text: "#1f2328", ...calm(true) }, dark: { bg: "#1c1f24", text: "#e6e8eb", ...calm(false) } },
  { id: "lanes", name: "B · Calm + structure", idea: "A's colors, plus line roles: step lines get a tinted band and a bar in the margin, transition lines a thin bar, branch lines are muted.", light: { bg: "#ffffff", text: "#1f2328", ...calm(true) }, dark: { bg: "#1c1f24", text: "#e6e8eb", ...calm(false) }, lines: true },
  { id: "safe", hidden: true, name: "C · Color-blind safe", idea: "Okabe-Ito hues (blue, vermillion, bluish green, reddish purple), chosen to stay apart for every color-vision deficiency. Tag members keep their own hue.", light: { bg: "#ffffff", text: "#1f2328", ...safe(true) }, dark: { bg: "#1c1f24", text: "#e6e8eb", ...safe(false) } },
  { id: "roles", name: "D · Colored by role", idea: "Each kind of word gets the color of what it does in the chart: steps amber (init, step, every use of a step), transitions blue (--, names, ->), branches violet (select, parallel, |, end), actions green (on, set, reset, qualifiers, call, :=, SFR), time teal (durations, after, .done/.time), values rose. Declarations (program, tag, io) stay text-colored and extra bold, types and addresses gray; logic words text-colored bold. With B's line structure.", light: { bg: "#ffffff", text: "#1f2328", ...roles(true, false) }, dark: { bg: "#1c1f24", text: "#e6e8eb", ...roles(false, false) }, lines: true },
  { id: "rolesafe", name: "E · By role, color-blind safe", idea: "D's roles with four Okabe-Ito hues (vermillion steps, blue transitions, green actions, reddish-purple branches). Time takes its step's vermillion in italic (a preset belongs to its step); values are italic text. Fewer hues, so nothing merges under color-vision deficiencies. With B's line structure.", light: { bg: "#ffffff", text: "#1f2328", ...roles(true, true) }, dark: { bg: "#1c1f24", text: "#e6e8eb", ...roles(false, true) }, lines: true },
];

type Deco = "steps" | "tbar" | "tband" | "gutter" | "blocks" | "letters" | "numbered";

// ---- tokens → roles --------------------------------------------------------------------------

function stepNames(src: string): Set<string> {
  const s = new Set<string>();
  for (const m of src.matchAll(/^\s*(?:init|step)\s+([A-Za-z_]\w*)/gim)) s.add(m[1]!.toLowerCase());
  return s;
}

const ACTION_KW = /^(on|set|reset|call|N|S|R|L|D|P)$/i;
const DECL_KW = /^(program|sfc|st|uses|controller|tag|io|course|author)$/i;
const LOGIC = /^(AND|OR|NOT|XOR|MOD|TRUE|FALSE)$/i;
const TIMER_MEMBER = /^(DN|done|T|time|PRE|ACC)$/i;

function roleOf(kind: TokKind, text: string, steps: Set<string>, prevStep: boolean, line: string, ctx: { blocks: string[]; routines: Set<string> }): Role {
  const isStep = steps.has(text.toLowerCase());
  switch (kind) {
    case "kw":
      if (text === "--") return "trans";
      if (/^(init|step)$/i.test(text)) return "stepkw";
      if (/^after$/i.test(text)) return "time";
      if (/^end$/i.test(text)) return ctx.blocks.pop() === "decl" ? "decl" : "branch";
      if (/^(select|parallel)$/i.test(text)) {
        ctx.blocks.push("branch");
        return "branch";
      }
      if (text === "|") return "branch";
      if (/^(io|controller)$/i.test(text)) ctx.blocks.push("decl");
      if (DECL_KW.test(text)) return "decl";
      if (ACTION_KW.test(text)) return "action";
      return "kw";
    case "def":
      if (/^\s*(init|step)\b/i.test(line)) return "step";
      if (/^\s*sfc\s+tags\b/i.test(line) && text === "tags") return "decl";
      return "declname";
    case "target":
      return "step";
    case "arrow":
      return "trans";
    case "label":
      return "label";
    case "duration":
      return "time";
    case "number":
      return "literal";
    case "string":
      return "string";
    case "comment":
      return "comment";
    case "member":
      return prevStep ? (TIMER_MEMBER.test(text) ? "time" : "stepmember") : "member";
    case "func":
      return /^(SFR|SFP|JSR)$/i.test(text) ? "action" : "func";
    case "type":
      return "type";
    case "address":
      return "address";
    case "op":
      return text === ":=" || text === "[:=]" ? "action" : "op";
    case "punct":
      return "op";
    case "stkw":
      return LOGIC.test(text) ? "logic" : "stctl";
    default:
      if (isStep) return "step";
      if (ctx.routines.has(text.toLowerCase())) return "routine";
      return /^\s*(uses|sfc\s+tags)\b/i.test(line) ? (/^\s*uses\b/i.test(line) ? "routine" : "step") : "ident";
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function renderTest(t: Test): string {
  const steps = stepNames(t.source);
  const ctx = { blocks: [] as string[], routines: new Set([...t.source.matchAll(/^\s*(?:sfc|st)\s+([A-Za-z_]\w*)/gim)].map((m) => m[1]!.toLowerCase()).filter((n) => n !== "tags")) };
  let inIo = false;
  let inStep = false;
  let nStep = 0;
  let nTrans = 0;
  const rows = t.source.split("\n").map((line, i) => {
    const toks = tokenizeLine(line, { inIo });
    inIo = ioStateAfter(line, inIo);
    let html = "";
    let at = 0;
    let prevStep = false;
    const sq = t.squiggles?.find((s) => s.line === i + 1);
    for (const tok of toks) {
      if (tok.from > at) html += esc(line.slice(at, tok.from));
      const text = line.slice(tok.from, tok.to);
      const role = roleOf(tok.kind, text, steps, prevStep, line, ctx);
      // a member keeps the step of the name before its dot
      if (!(tok.kind === "punct" && text === ".")) prevStep = (tok.kind === "ident" || tok.kind === "target") && steps.has(text.toLowerCase());
      html += `<span class="r-${role}">${esc(text)}</span>`;
      at = tok.to;
    }
    if (at < line.length) html += esc(line.slice(at));
    if (sq) {
      // wrap the squiggle range (character based, on the plain text) with a marker
      const plain = line;
      const before = plain.slice(0, sq.from - 1);
      void before;
    }
    const lkd = lineKind(line);
    const k = lkd.kind;
    const word = (lkd.word ?? "").toLowerCase();
    if (k === "step") inStep = true;
    else if (k !== "action" && k !== "blank" && k !== "comment") inStep = false;
    const lk =
      k === "step" ? `l-step${word === "init" ? " l-init" : ""}` : k === "transition" ? "l-trans" : k === "branch" || k === "bar" || k === "end" ? "l-branch" : k === "action" && inStep ? "l-action" : "";
    const g = k === "step" ? (word === "init" ? "g-init" : "g-step") : k === "transition" ? "g-trans" : k === "bar" ? "g-bar" : k === "end" ? "g-end" : k === "branch" ? (word === "parallel" ? "g-par" : "g-sel") : "";
    const tag = k === "step" ? `data-s="S" data-n="S${++nStep}"` : k === "transition" ? `data-s="T" data-n="T${++nTrans}"` : k === "branch" || k === "bar" || k === "end" ? `data-s="${k === "bar" ? "┆" : word === "parallel" ? "═" : word === "select" ? "┆" : "┆"}" data-n="${k === "bar" ? "┆" : word === "parallel" ? "═" : "┆"}"` : "";
    return { html, lk, sq, g, tag };
  });
  // squiggles: re-render the marked range by walking text nodes is overkill for a mockup:
  // mark the token(s) overlapping the range instead
  const out = rows.map((r, i) => {
    let html = r.html;
    if (r.sq) {
      let col = 0;
      html = html.replace(/(<span class="r-[a-z]+">)([^<]*)(<\/span>)|([^<]+)/g, (m, open: string, inner: string, close: string, plain: string) => {
        const text = inner ?? plain;
        const from = col + 1;
        col += text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").length;
        const hit = from < r.sq!.to && col + 1 > r.sq!.from && text.trim() !== "";
        if (!hit) return m;
        const cls = `sq-${r.sq!.severity}`;
        return open ? `${open.replace('">', ` ${cls}">`)}${inner}${close}` : `<span class="${cls}">${plain}</span>`;
      });
    }
    return `<div class="ln ${r.lk}"><span class="gl ${r.g}" ${r.tag}></span><span class="no">${i + 1}</span><span class="tx">${html || "&nbsp;"}</span></div>`;
  });
  return out.join("");
}

// ---- color science: WCAG contrast, CVD simulation (Machado 2009, severity 1), CIE76 ΔE -------------

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const lum = (h: string) => {
  const [r, g, b] = hex(h).map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
const CVD: Record<string, number[][]> = {
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const simulate = (h: string, m?: number[][]): [number, number, number] => {
  const l = hex(h).map(lin);
  if (!m) return l as [number, number, number];
  return m.map((row) => Math.min(1, Math.max(0, row[0]! * l[0]! + row[1]! * l[1]! + row[2]! * l[2]!))) as [number, number, number];
};
const lab = ([r, g, b]: [number, number, number]): [number, number, number] => {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const dE = (a: string, b: string, m?: number[][]) => {
  const p = lab(simulate(a, m));
  const q = lab(simulate(b, m));
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
void unlin;

/** Roles a reader must tell apart (when the scheme gives them different colors on purpose). */
const PAIRS: Array<[Role, Role]> = [
  ["step", "trans"], ["step", "action"], ["trans", "action"], ["branch", "trans"], ["branch", "action"], ["branch", "step"],
  ["time", "step"], ["time", "action"], ["time", "trans"], ["decl", "ident"], ["action", "ident"],
  ["kw", "step"], ["step", "ident"], ["kw", "literal"], ["step", "literal"], ["literal", "ident"], ["comment", "ident"],
  ["kw", "ident"], ["member", "ident"], ["stkw", "ident"], ["label", "step"],
];

/** Roles that must never look the same (same color and same weight). */
const MUST: Array<[Role, Role]> = [["step", "trans"], ["step", "action"], ["trans", "action"], ["kw", "step"], ["step", "ident"], ["literal", "ident"], ["comment", "ident"], ["kw", "ident"], ["trans", "ident"]];

function score(s: Scheme, mode: "light" | "dark") {
  const pal = withFallback(s[mode]);
  const roles = Object.entries(pal).filter(([k]) => k !== "bg" && k !== "text") as Array<[Role, Style]>;
  const contrasts = roles.map(([r, st]) => ({ r, c: contrast(st.color, pal.bg) }));
  const minC = contrasts.reduce((a, b) => (b.c < a.c ? b : a));
  const hues = new Set(roles.map(([, st]) => st.color.toLowerCase()));
  const pairs = PAIRS.filter(([a, b]) => pal[a] && pal[b] && pal[a]!.color.toLowerCase() !== pal[b]!.color.toLowerCase());
  const worst = (m?: number[][]) =>
    pairs.map(([a, b]) => ({ p: `${a}/${b}`, d: dE(pal[a]!.color, pal[b]!.color, m) })).reduce((x, y) => (y.d < x.d ? y : x), { p: "-", d: 999 });
  const same = MUST.filter(([a, b]) => pal[a] && pal[b] && pal[a]!.color.toLowerCase() === pal[b]!.color.toLowerCase() && (pal[a]!.weight ?? 400) === (pal[b]!.weight ?? 400) && !!pal[a]!.italic === !!pal[b]!.italic).map(([a, b]) => `${a}/${b}`);
  return { minC, hues: hues.size, same, normal: worst(), deutan: worst(CVD.deutan), protan: worst(CVD.protan), tritan: worst(CVD.tritan) };
}

// ---- page --------------------------------------------------------------------------------------

function withFallback(pal: Scheme["light"]): Scheme["light"] {
  const out = { ...pal } as Scheme["light"];
  for (const [role, chain] of Object.entries(FALLBACK) as Array<[Role, Role[]]>) {
    if (out[role]) continue;
    const from = chain.find((r) => out[r]);
    if (from) out[role] = out[from];
  }
  return out;
}

function schemeCss(s: Scheme, mode: "light" | "dark"): string {
  const pal = withFallback(s[mode]);
  const sel = `.mode-${mode} .s-${s.id}`;
  const rules = [`${sel} { background:${pal.bg}; color:${pal.text}; }`];
  for (const [role, st] of Object.entries(pal)) {
    if (role === "bg" || role === "text") continue;
    const v = st as Style;
    rules.push(`${sel} .r-${role} { color:${v.color};${v.weight ? ` font-weight:${v.weight};` : " font-weight:400;"}${v.italic ? " font-style:italic;" : ""} }`);
  }
  if (s.deco) {
    const step = (pal.step as Style).color;
    const tr = (pal.trans as Style).color;
    const br = (pal.branch as Style).color;
    const tint = (hexc: string, a: number) => {
      const [r, g, b] = hex(hexc).map((x) => Math.round(x * 255));
      return `rgba(${r},${g},${b},${a})`;
    };
    const L = mode === "light";
    const stepBand = `${sel} .l-step { background:${tint(step, L ? 0.08 : 0.12)}; box-shadow: inset 3px 0 0 ${step}; }`;
    switch (s.deco) {
      case "steps":
        rules.push(stepBand);
        break;
      case "tbar":
        rules.push(stepBand, `${sel} .l-trans { box-shadow: inset 3px 0 0 ${tint(tr, 0.6)}; }`);
        break;
      case "tband":
        rules.push(stepBand, `${sel} .l-trans { background:${tint(tr, L ? 0.07 : 0.11)}; box-shadow: inset 3px 0 0 ${tr}; }`);
        break;
      case "gutter":
        rules.push(
          `${sel} .gl { width:16px; flex:none; text-align:center; font:12px/1.55 system-ui,sans-serif; }`,
          `${sel} .g-step::before { content:"□"; color:${step}; font-weight:700; }`,
          `${sel} .g-init::before { content:"▣"; color:${step}; }`,
          `${sel} .g-trans::before { content:"━"; color:${tr}; font-weight:700; }`,
          `${sel} .g-sel::before, ${sel} .g-bar::before, ${sel} .g-end::before { content:"┆"; color:${br}; }`,
          `${sel} .g-par::before { content:"═"; color:${br}; }`,
        );
        break;
      case "letters":
      case "numbered":
        rules.push(
          stepBand.replace(/background:[^;]+;/, "").replace(/box-shadow:[^;]+;/, ""),
          `${sel} .gl { width:${s.deco === "numbered" ? 34 : 20}px; flex:none; text-align:center; font:700 11.5px/1.55 ui-monospace,Consolas,monospace; border-right:1px solid ${L ? "#e3e6ea" : "#2a2f36"}; margin-right:4px; }`,
          `${sel} .gl::before { content:attr(${s.deco === "numbered" ? "data-n" : "data-s"}); }`,
          `${sel} .g-step, ${sel} .g-init { color:${step}; }`,
          `${sel} .g-init::before { text-decoration: underline; text-underline-offset:2px; }`,
          `${sel} .g-trans { color:${tr}; }`,
          `${sel} .g-sel, ${sel} .g-bar, ${sel} .g-end, ${sel} .g-par { color:${br}; opacity:.8; }`,
        );
        break;
      case "blocks":
        rules.push(
          `${sel} .l-step, ${sel} .l-action { background:${tint(step, L ? 0.06 : 0.09)}; box-shadow: inset 3px 0 0 ${step}; }`,
          `${sel} .l-trans { box-shadow: inset 0 1px 0 ${tint(tr, 0.55)}, inset 0 -1px 0 ${tint(tr, 0.55)}; }`,
          `${sel} .l-step { margin-top:3px; }`,
        );
        break;
    }
  }
  if (s.lines) {
    const step = (pal.step as Style).color;
    const kw = (pal.kw as Style).color;
    rules.push(
      `${sel} .l-step { background:${mode === "light" ? "rgba(180,68,10,.07)" : "rgba(245,165,36,.09)"}; box-shadow: inset 3px 0 0 ${step}; }`,
      `${sel} .l-trans { box-shadow: inset 3px 0 0 ${kw}55; }`,
      `${sel} .l-branch .r-branch { opacity:.75; }`,
    );
  }
  return rules.join("\n");
}

const fmt = (n: number) => n.toFixed(1);
const scoreRows = SCHEMES.map((s) => {
  const L = score(s, "light");
  const D = score(s, "dark");
  const cell = (x: { p: string; d: number }) => `<span class="${x.d < 12 ? "bad" : x.d < 20 ? "meh" : "good"}">${fmt(x.d)}</span> <small>${x.p}</small>`;
  const con = (x: { r: string; c: number }) => `<span class="${x.c < 4.5 ? "bad" : "good"}">${fmt(x.c)}</span> <small>${x.r}</small>`;
  const same = L.same.length ? `<span class="bad">${L.same.join(", ")}</span>` : '<span class="good">none</span>';
  return `<tr><th>${s.name}</th><td>${L.hues} / ${D.hues}</td><td>${same}</td><td>${con(L.minC)}</td><td>${con(D.minC)}</td><td>${cell(L.normal)}</td><td>${cell(L.deutan)}</td><td>${cell(L.protan)}</td><td>${cell(L.tritan)}</td><td>${cell(D.deutan)}</td></tr>`;
}).join("");

const shown = SCHEMES.filter((x) => !x.hidden);
const LEGEND: Array<[string, Array<[Role, string]>]> = [
  ["Steps", [["stepkw", "init"], ["step", " idle   "], ["stepkw", "step"], ["step", " fill   "], ["step", "fill"], ["op", "."], ["stepmember", "X"], ["trans", "   ->"], ["step", " idle"]]],
  ["Transitions", [["trans", "--"], ["label", " go"], ["op", ":"], ["ident", " start_btn "], ["trans", "->"]]],
  ["Branches", [["branch", "select"], ["branch", "  |"], ["branch", "  parallel"], ["branch", "  end"]]],
  ["Actions", [["action", "on"], ["ident", " pump  "], ["action", "set"], ["action", "  S  L"], ["action", "  call"], ["ident", " x "], ["action", ":="], ["action", "  SFR"]]],
  ["Time", [["time", "5s"], ["time", "  after"], ["step", "  fill"], ["op", "."], ["time", "done"]]],
  ["Values", [["literal", "1500"], ["string", "  'text'"]]],
  ["Declarations", [["decl", "program"], ["decl", "  tag"], ["declname", " n "], ["op", ":"], ["type", " DINT"], ["decl", "  io"], ["address", "  Local:1:I.Data.0"]]],
  ["Logic, tags", [["logic", "AND OR NOT"], ["stctl", "  IF THEN"], ["ident", "  level"]]],
];
const legend = `<section class="legend"><h2>Roles</h2><div class="cols">${shown
  .map(
    (s) => `<div class="pane"><div class="pane-h">${s.name}</div><div class="code s-${s.id}">${LEGEND.map(
      ([name, parts]) => `<div class="ln"><span class="lg">${name}</span><span class="tx">${parts.map(([r, t]) => `<span class="r-${r}">${esc(t)}</span>`).join("")}</span></div>`,
    ).join("")}</div></div>`,
  )
  .join("")}</div></section>`;

const tests = TESTS.map(
  (t) => `<section class="test"><h2>${t.title}</h2><p class="check">${esc(t.check)}</p><div class="cols">${shown.map(
    (s) => `<div class="pane"><div class="pane-h">${s.name}</div><div class="code s-${s.id}">${renderTest(t)}</div></div>`,
  ).join("")}</div></section>`,
).join("");

const bar = `<div class="bar">
  <span><b>Theme</b> <label><input type="radio" name="mode" value="light" checked> Light</label><label><input type="radio" name="mode" value="dark"> Dark</label></span>
  <span><b>Vision</b> <label><input type="radio" name="cvd" value="none" checked> Normal</label><label><input type="radio" name="cvd" value="deutan"> Deuteranopia</label><label><input type="radio" name="cvd" value="protan"> Protanopia</label><label><input type="radio" name="cvd" value="tritan"> Tritanopia</label><label><input type="radio" name="cvd" value="gray"> Grayscale</label></span>
</div>`;
const page = (title: string, schemes: Scheme[], body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body { margin:0; padding:16px; font:14px/1.45 system-ui,sans-serif; background:#e9ecf0; color:#1d2228; }
body.mode-dark { background:#0d1013; color:#e3e7eb; }
h1 { font-size:18px; margin:0 0 4px; } .lead { color:#59626e; max-width:1100px; margin:0 0 10px; } .mode-dark .lead, .mode-dark .check { color:#a0aab5; }
.bar { position:sticky; top:0; z-index:5; display:flex; gap:16px; flex-wrap:wrap; align-items:center; padding:8px 10px; background:inherit; border-bottom:1px solid #b9c0c8; margin:0 -16px 12px; padding-left:16px; }
.bar label { margin-right:8px; }
.findings, .schemes { max-width:1100px; } .findings li { margin:3px 0; }
table.score { border-collapse:collapse; font-size:13px; margin:6px 0 12px; } .score th, .score td { border:1px solid #b9c0c8; padding:4px 8px; text-align:left; }
.score small { color:#6b7280; } .good { color:#1a7f37; font-weight:600; } .meh { color:#9a6700; font-weight:600; } .bad { color:#b42318; font-weight:700; }
.mode-dark .good { color:#56d364; } .mode-dark .meh { color:#e3b341; } .mode-dark .bad { color:#ff7b72; }
.test h2 { font-size:15px; margin:18px 0 0; } .check { margin:2px 0 6px; color:#59626e; font-size:13px; }
.cols { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:10px; }
.pane { border:1px solid #b9c0c8; border-radius:8px; overflow:hidden; } .mode-dark .pane { border-color:#30363d; }
.pane-h { font-size:12px; font-weight:600; padding:4px 8px; background:#f5f7f9; border-bottom:1px solid #d5dae0; } .mode-dark .pane-h { background:#161b22; border-color:#30363d; }
.code { font:13.5px/1.55 ui-monospace,Consolas,monospace; padding:6px 0; overflow-x:auto; }
.ln { display:flex; padding-right:8px; } .tx { white-space:pre-wrap; padding-left:2ch; text-indent:-2ch; min-width:0; } .lg { width:110px; flex:none; padding-left:10px; font:12px system-ui,sans-serif; color:#8b949e; align-self:center; }
.gl { width:0; }
.no { width:30px; flex:none; text-align:right; padding-right:10px; color:#8b949e; opacity:.7; user-select:none; }
.sq-error { text-decoration: underline wavy #d1242f; text-decoration-skip-ink:none; text-underline-offset:3px; }
.sq-warning { text-decoration: underline wavy #bf8700; text-decoration-skip-ink:none; text-underline-offset:3px; }
.cvd-deutan .cols { filter:url(#deutan); } .cvd-protan .cols { filter:url(#protan); } .cvd-tritan .cols { filter:url(#tritan); } .cvd-gray .cols { filter:grayscale(1); }
@media (max-width: 640px) { .cols { grid-template-columns:1fr; } }
${schemes.flatMap((s) => [schemeCss(s, "light"), schemeCss(s, "dark")]).join("\n")}
</style></head>
<body class="mode-light">
<svg width="0" height="0" style="position:absolute"><defs>
${Object.entries(CVD)
  .map(([id, m]) => `<filter id="${id}" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${m.map((r) => `${r.join(" ")} 0 0`).join(" ")} 0 0 0 1 0"/></filter>`)
  .join("\n")}
</defs></svg>
${body}
<script>
for (const r of document.querySelectorAll('input[name="mode"]')) r.addEventListener("change", () => { document.body.classList.toggle("mode-dark", r.value === "dark" && r.checked); document.body.classList.toggle("mode-light", !(r.value === "dark" && r.checked)); });
for (const r of document.querySelectorAll('input[name="cvd"]')) r.addEventListener("change", () => { document.body.className = document.body.className.replace(/\\bcvd-\\w+/g, "").trim(); if (r.value !== "none") document.body.classList.add("cvd-" + r.value); });
</script>
</body></html>
`;

const html = page("Editor colors mockup", SCHEMES, `<h1>Editor colors: readability stress tests</h1>
<p class="lead">Seven stress tests, written in the editor's own highlighting (app/highlight.ts), shown in the current scheme and three candidates. Switch light / dark and simulate color-vision deficiencies with the bar below. The scorecard is measured: WCAG contrast of every token against the background (4.5 is the minimum for text) and ΔE (CIE76) between roles a reader must tell apart (below 12 they look alike, above 20 they are clearly different).</p>
${bar}

<h2>What the stress tests show in the current scheme</h2>
<ul class="findings">
  <li><b>Structure is hard to scan (test 1).</b> Step lines, transitions and action lines have the same weight of color; the transition marker <code>--</code> is purple, but two thin dashes read as gray, so transitions don't stand out.</li>
  <li><b>Steps lose their color where they are used (tests 2, 7).</b> <code>cycle_run</code> is orange where it is defined but plain text in <code>cycle_run.DN</code>, while the member <code>.DN</code> gets mustard: the eye goes to the member, not to the step. A step and a tag (<code>fill</code> / <code>fill_valve</code>) look the same.</li>
  <li><b>Too many hues (12).</b> Purple, blue, orange, green, teal, navy, mustard, violet each mean something different; ST keywords (blue, bold) compete with qSFC keywords (purple, bold) in dense conditions.</li>
  <li><b>Close pairs.</b> Strings (navy) vs ST keywords (blue), and functions (violet) vs keywords (purple) are close; under deuteranopia, labels (green) and definitions (orange) get close too (scorecard).</li>
  <li><b>Squiggles (test 6)</b> stay visible, but a red error under an orange/brown definition is weak.</li>
</ul>

<h2>Scorecard</h2>
<table class="score">
<tr><th>Scheme</th><th>Colors (light / dark)</th><th>Can't tell apart</th><th>Min contrast, light</th><th>Min contrast, dark</th><th>Closest pair, normal</th><th>…deuteranopia</th><th>…protanopia</th><th>…tritanopia</th><th>Dark, deuteranopia</th></tr>
${scoreRows}
</table>
<ul class="schemes">${SCHEMES.map((s) => `<li><b>${s.name}:</b> ${esc(s.idea)}${s.hidden ? " <i>(scorecard only)</i>" : ""}</li>`).join("")}</ul>
${legend}
${tests}
`);

mkdirSync("docs/mockups/colors", { recursive: true });
writeFileSync("docs/mockups/colors/index.html", html);
for (const s of SCHEMES) {
  const L = score(s, "light");
  const D = score(s, "dark");
  console.log(s.name, "hues", L.hues, "same", L.same.join(","), "minC", fmt(L.minC.c), L.minC.r, fmt(D.minC.c), D.minC.r, "| ΔE n", fmt(L.normal.d), L.normal.p, "deu", fmt(L.deutan.d), L.deutan.p, "pro", fmt(L.protan.d), L.protan.p, "tri", fmt(L.tritan.d), L.tritan.p);
}

// ---- page 2: versions of "colored by role", and structure hints for transitions ----------------

interface RoleColors { decl: string; step: string; trans: string; branch: string; action: string; time: string; value: string; comment: string; ident: string; op: string }
const byRole = (c: RoleColors, o: { names?: boolean; italicValues?: boolean; italicTime?: boolean } = {}): Partial<Record<Role, Style>> => {
  const names = o.names ?? true; // color step names and references too, not only the keywords
  return {
    decl: { color: c.decl, weight: 800 }, declname: { color: c.ident, weight: 700 }, type: { color: c.op }, address: { color: c.op },
    routine: { color: c.ident, weight: 700 },
    stepkw: { color: c.step, weight: 700 }, step: names ? { color: c.step, weight: 600 } : { color: c.ident, weight: 700 }, stepmember: names ? { color: c.step } : { color: c.ident },
    trans: { color: c.trans, weight: 700 }, label: names ? { color: c.trans, weight: 600 } : { color: c.ident, weight: 600 },
    branch: { color: c.branch, weight: 700 }, action: { color: c.action, weight: 700 },
    time: { color: c.time, weight: 600, italic: !!o.italicTime },
    literal: { color: c.value, italic: !!o.italicValues }, string: { color: c.value, italic: !!o.italicValues },
    logic: { color: c.ident, weight: 700 }, stctl: { color: c.ident, weight: 700 }, stkw: { color: c.ident, weight: 700 },
    func: { color: c.ident, italic: true }, member: { color: c.ident }, ident: { color: c.ident },
    op: { color: c.op }, comment: { color: c.comment, italic: true }, kw: { color: c.decl, weight: 800 }, def: { color: c.ident, weight: 700 },
  };
};
const BASE_L = { decl: "#1f2328", comment: "#6b7280", ident: "#1f2328", op: "#6b7280" };
const BASE_D = { decl: "#e6e8eb", comment: "#9aa3ad", ident: "#e6e8eb", op: "#9aa3ad" };
const VIVID_L: RoleColors = { ...BASE_L, step: "#b4440a", trans: "#1d5fd1", branch: "#7c3aed", action: "#15803d", time: "#0e7490", value: "#be185d" };
const VIVID_D: RoleColors = { ...BASE_D, step: "#f5a524", trans: "#6ea8ff", branch: "#c4a7ff", action: "#4ade80", time: "#22d3ee", value: "#f472b6" };
const role = (id: string, name: string, idea: string, l: Partial<Record<Role, Style>>, d: Partial<Record<Role, Style>>, deco: Deco = "steps"): Scheme => ({
  id, name, idea, deco, light: { bg: "#ffffff", text: "#1f2328", ...l }, dark: { bg: "#1c1f24", text: "#e6e8eb", ...d },
});

const PALETTES: Scheme[] = [
  role("p-vivid", "1 · Vivid (D)", "Steps amber, transitions blue, branches violet, actions green, time teal, values rose.", byRole(VIVID_L), byRole(VIVID_D)),
  role("p-cool", "2 · Structure cool, behavior warm", "The chart's skeleton in cool colors (steps blue, transitions teal, branches indigo); what it does in warm ones (actions orange, time ochre, values rose).",
    byRole({ ...BASE_L, step: "#1e4fd0", trans: "#0b7068", branch: "#6d28d9", action: "#c2410c", time: "#8a6100", value: "#be185d" }),
    byRole({ ...BASE_D, step: "#7aa2ff", trans: "#2dd4bf", branch: "#b69cff", action: "#fb923c", time: "#facc15", value: "#f472b6" })),
  role("p-soft", "3 · Soft", "D's hues, less saturated: calmer for long sessions, still one color per role.",
    byRole({ ...BASE_L, step: "#985528", trans: "#3c66a8", branch: "#6a55ad", action: "#3a7650", time: "#2c6f79", value: "#9c4569" }),
    byRole({ ...BASE_D, step: "#dfa86e", trans: "#93b4e6", branch: "#b9a8e6", action: "#8fcca0", time: "#80c6cf", value: "#e2a0bd" })),
  role("p-kw", "4 · Keywords only", "D's hues on the keywords only (init, step, --, ->, select, on, S, :=, after, durations); step and transition names stay text-colored and bold. Less color on the page.",
    byRole(VIVID_L, { names: false }), byRole(VIVID_D, { names: false })),
  role("p-safe", "5 · Color-blind safe (E)", "Four Okabe-Ito hues; time takes its step's color in italic, values are italic text.",
    byRole({ ...BASE_L, step: "#b03a00", trans: "#005f9e", branch: "#9b3f7a", action: "#1b6e3a", time: "#b03a00", value: "#1f2328" }, { italicValues: true, italicTime: true }),
    byRole({ ...BASE_D, step: "#ff8a4c", trans: "#56b4e9", branch: "#e48bc0", action: "#3fcf7a", time: "#ff8a4c", value: "#e6e8eb" }, { italicValues: true, italicTime: true })),
];

const HINTS: Scheme[] = [
  role("h-none", "a · Steps only", "Step lines get a tinted band and a bar; transitions get nothing more than their blue --.", byRole(VIVID_L), byRole(VIVID_D), "steps"),
  role("h-bar", "b · Transition bar", "Transitions get a thin blue bar in the margin, under the step's thick amber one.", byRole(VIVID_L), byRole(VIVID_D), "tbar"),
  role("h-band", "c · Transition band", "Transitions get their own light blue band: the file alternates amber and blue lines like the chart alternates steps and transitions.", byRole(VIVID_L), byRole(VIVID_D), "tband"),
  role("h-gutter", "d · Chart symbols in the margin", "A small symbol before each structure line, like the diagram: □ step, ▣ initial step, ━ transition, ┆ select, ═ parallel. No bands.", byRole(VIVID_L), byRole(VIVID_D), "gutter"),
  role("h-letters", "e · S / T column (your idea)", "A narrow column left of the line numbers: S on each step (underlined for the initial step), T on each transition, ┆ ═ on branch lines. The code itself stays plain: the column alone shows the chart's rhythm.", byRole(VIVID_L), byRole(VIVID_D), "letters"),
  role("h-numbered", "f · Numbered S1… / T1…", "The same column, numbered in file order like the diagram's step numbers (View → Step numbers): S3 in the code is step 3 in the diagram.", byRole(VIVID_L), byRole(VIVID_D), "numbered"),
  role("h-blocks", "g · Step blocks", "A step and its action lines form one tinted block; each transition sits between two blocks on thin blue rules.", byRole(VIVID_L), byRole(VIVID_D), "blocks"),
];

const panes = (schemes: Scheme[], t: Test) =>
  `<section class="test"><h2>${t.title}</h2><p class="check">${esc(t.check)}</p><div class="cols">${schemes
    .map((s) => `<div class="pane"><div class="pane-h">${s.name}</div><div class="code s-${s.id}">${renderTest(t)}</div></div>`)
    .join("")}</div></section>`;
const legendFor = (schemes: Scheme[]) =>
  `<div class="cols">${schemes
    .map(
      (s) => `<div class="pane"><div class="pane-h">${s.name}</div><div class="code s-${s.id}">${LEGEND.map(
        ([name, parts]) => `<div class="ln"><span class="lg">${name}</span><span class="tx">${parts.map(([r, t]) => `<span class="r-${r}">${esc(t)}</span>`).join("")}</span></div>`,
      ).join("")}</div></div>`,
    )
    .join("")}</div>`;
const scoreTable = (schemes: Scheme[]) => {
  const rows = schemes
    .map((s) => {
      const L = score(s, "light");
      const D = score(s, "dark");
      const cell = (x: { p: string; d: number }) => `<span class="${x.d < 12 ? "bad" : x.d < 20 ? "meh" : "good"}">${fmt(x.d)}</span> <small>${x.p}</small>`;
      const con = (x: { r: string; c: number }) => `<span class="${x.c < 4.5 ? "bad" : "good"}">${fmt(x.c)}</span> <small>${x.r}</small>`;
      return `<tr><th>${s.name}</th><td>${L.hues} / ${D.hues}</td><td>${con(L.minC)}</td><td>${con(D.minC)}</td><td>${cell(L.normal)}</td><td>${cell(L.deutan)}</td><td>${cell(L.protan)}</td><td>${cell(L.tritan)}</td></tr>`;
    })
    .join("");
  return `<table class="score"><tr><th>Version</th><th>Colors (light / dark)</th><th>Min contrast, light</th><th>Min contrast, dark</th><th>Closest pair, normal</th><th>Deuteranopia</th><th>Protanopia</th><th>Tritanopia</th></tr>${rows}</table>`;
};
const byId = (id: string) => TESTS.find((t) => t.id === id)!;

const html2 = page(
  "Colored by role: versions",
  [...PALETTES, ...HINTS],
  `<h1>Colored by role: versions</h1>
<p class="lead">Part 1 compares five palettes for the same roles (every pane has the same step bands). Part 2 keeps palette 1 and compares five ways to show transitions as structure. Same controls and scorecard as the first page (<a href="index.html">index.html</a>).</p>
${bar}
<h2>Part 1 · Palettes</h2>
${scoreTable(PALETTES)}
<ul class="schemes">${PALETTES.map((s) => `<li><b>${s.name}:</b> ${esc(s.idea)}</li>`).join("")}</ul>
<section class="legend"><h2>Roles</h2>${legendFor(PALETTES)}</section>
${["scan", "dense", "actions"].map((id) => panes(PALETTES, byId(id))).join("")}
<h2 style="margin-top:28px">Part 2 · Should transitions get a structure hint too?</h2>
<ul class="schemes">${HINTS.map((s) => `<li><b>${s.name}:</b> ${esc(s.idea)}</li>`).join("")}</ul>
${["scan", "branches", "names"].map((id) => panes(HINTS, byId(id))).join("")}`,
);
writeFileSync("docs/mockups/colors/roles.html", html2);
console.log("wrote docs/mockups/colors/roles.html");
for (const s of PALETTES) {
  const L = score(s, "light");
  console.log(s.name, "minC", fmt(L.minC.c), L.minC.r, fmt(score(s, "dark").minC.c), "| n", fmt(L.normal.d), L.normal.p, "deu", fmt(L.deutan.d), L.deutan.p, "pro", fmt(L.protan.d), L.protan.p, "tri", fmt(L.tritan.d), L.tritan.p);
}
