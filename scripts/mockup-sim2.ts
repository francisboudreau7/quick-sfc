/**
 * Builds docs/mockups/sim/diagram.html: Phase 4e, the diagram while simulating. Transitions you
 * click to fire, inputs in conditions you click to toggle, every part of a condition green or red.
 *   npx tsx scripts/mockup-sim2.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { compile } from "../src/compile.js";
import { renderSvg, escapeXml } from "../src/render/svg.js";
import { tokenizeLine } from "../app/highlight.js";

const SRC = [
  "init idle",
  "-- start_btn AND NOT e_stop",
  "step fill 5s",
  "  on valve",
  "-- fill.done OR level_high",
  "step check",
  "select",
  "  -- level_ok AND count < 10",
  "  step mix 3s",
  "    on mixer",
  "  -- mix.done -> idle",
  "|",
  "  -- NOT (level_ok AND count < 10)",
  "  step alarm",
  "    set alarm_lamp",
  "  -- ack_btn -> idle",
  "end",
  "",
].join("\n");

const r = compile(SRC, { fileName: "tank.qsfc" });
const baseSvg = renderSvg(r.graph!, r.layout!, { look: "textbook" });

// the simulated state: fill active for 3.1 s; level_high came on
const ACTIVE = new Set(["fill"]);
const BOOLS: Record<string, boolean> = { start_btn: false, e_stop: false, level_high: true, level_ok: true, ack_btn: false };
const NUMS: Record<string, number> = { count: 7 };
const STEP_MEMBERS: Record<string, boolean> = { "fill.done": false, "mix.done": false };
const INPUTS = new Set(["start_btn", "e_stop", "level_high", "level_ok", "ack_btn", "count"]);

const CHAR = 11 * 0.61;
type Variant = "parts" | "buttons" | "values";

interface Part {
  from: number;
  to: number;
  kind: "bool" | "input" | "cmp" | "member" | "op" | "logic" | "paren" | "lit";
  value?: boolean;
  name?: string;
  num?: number;
}

/** Splits a condition into colored parts: tags, step members, comparisons, the rest. */
function parts(cond: string): Part[] {
  const line = `-- ${cond}`;
  const toks = tokenizeLine(line)
    .filter((t) => t.from >= 3)
    .map((t) => ({ ...t, from: t.from - 3, to: t.to - 3, text: line.slice(t.from, t.to) }));
  const out: Part[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const next = toks[i + 1];
    const after = toks[i + 2];
    if (t.kind === "ident" && next?.text === "." && after?.kind === "member") {
      const key = `${t.text}.${after.text}`;
      out.push({ from: t.from, to: after.to, kind: "member", value: STEP_MEMBERS[key] ?? false, name: key });
      i += 2;
      continue;
    }
    if (t.kind === "ident" && next?.kind === "op" && /^(<|>|<=|>=|=|<>)$/.test(next.text) && after) {
      const a = NUMS[t.text] ?? 0;
      const b = Number(after.text);
      const v = next.text === "<" ? a < b : next.text === ">" ? a > b : next.text === "<=" ? a <= b : next.text === ">=" ? a >= b : next.text === "=" ? a === b : a !== b;
      out.push({ from: t.from, to: after.to, kind: "cmp", value: v, name: t.text, num: a });
      i += 2;
      continue;
    }
    if (t.kind === "ident") out.push({ from: t.from, to: t.to, kind: INPUTS.has(t.text) ? "input" : "bool", value: BOOLS[t.text] ?? false, name: t.text });
    else if (t.kind === "stkw") out.push({ from: t.from, to: t.to, kind: "logic" });
    else if (t.kind === "punct") out.push({ from: t.from, to: t.to, kind: "paren" });
    else out.push({ from: t.from, to: t.to, kind: "lit" });
  }
  return out;
}

/** The value of a whole condition (enough for the mockup's conditions). */
function evaluate(cond: string): boolean {
  let expr = cond;
  for (const [k, v] of Object.entries(STEP_MEMBERS)) expr = expr.split(k).join(v ? "true" : "false");
  for (const [k, v] of Object.entries(NUMS)) expr = expr.replace(new RegExp(`\\b${k}\\b`, "g"), String(v));
  for (const [k, v] of Object.entries(BOOLS)) expr = expr.replace(new RegExp(`\\b${k}\\b`, "g"), v ? "true" : "false");
  expr = expr.replace(/\bAND\b/g, "&&").replace(/\bOR\b/g, "||").replace(/\bNOT\b/g, "!").replace(/(?<![<>!])=(?!=)/g, "==").replace(/<>/g, "!=");
  return Boolean(Function(`return (${expr});`)());
}

function decorate(variant: Variant): string {
  let svg = baseSvg;
  const enabled = new Set<string>();
  for (const t of r.graph!.transitions) {
    const before = r.graph!.links.filter((l) => l.to === t.id).map((l) => l.from);
    const steps = before.flatMap((id) => (id.startsWith("s") ? [id] : r.graph!.links.filter((l) => l.to === id).map((l) => l.from)));
    if (steps.some((s) => ACTIVE.has(r.graph!.steps.find((x) => x.id === s)?.name ?? ""))) enabled.add(t.id);
  }
  for (const t of r.graph!.transitions) {
    const re = new RegExp(`(<g class="qsfc-transition[^"]*" data-id="${t.id}">[\\s\\S]*?)<text class="qsfc-code qsfc-cond" x="([\\d.-]+)" y="([\\d.-]+)">([^<]*)</text>`);
    svg = svg.replace(re, (_m, head: string, xs: string, ys: string) => {
      const x0 = Number(xs);
      const y = Number(ys);
      const ps = parts(t.condition);
      const value = evaluate(t.condition);
      let back = "";
      let shift = 0;
      const spans = ps
        .map((p) => {
          const text = escapeXml(t.condition.slice(p.from, p.to));
          const x = x0 + p.from * CHAR + shift;
          const w = (p.to - p.from) * CHAR;
          if (p.kind === "logic" || p.kind === "paren" || p.kind === "lit") return `<tspan x="${x.toFixed(1)}" class="c-op">${text}</tspan>`;
          const cls = p.value ? "c-true" : "c-false";
          if (variant !== "parts" && p.kind === "input") {
            back += `<rect class="pill ${p.value ? "pill-on" : "pill-off"}" x="${(x - 3).toFixed(1)}" y="${(y - 10.5).toFixed(1)}" width="${(w + 6).toFixed(1)}" height="14.5" rx="7"><title>${p.name} = ${p.value ? 1 : 0} · click to toggle</title></rect>`;
            return `<tspan x="${x.toFixed(1)}" class="${p.value ? "pill-t-on" : "pill-t-off"}">${text}</tspan>`;
          }
          if (variant === "values" && p.kind === "cmp") {
            const label = `${p.name}=${p.num}`;
            const cw = label.length * 9 * 0.61 + 6;
            back += `<rect class="chip" x="${(x - 1).toFixed(1)}" y="${(y + 4).toFixed(1)}" width="${cw.toFixed(1)}" height="11" rx="3"/><text class="chip-t" x="${(x + 2).toFixed(1)}" y="${(y + 12.2).toFixed(1)}">${label}</text>`;
            back += `<line class="${cls}-u" x1="${x.toFixed(1)}" x2="${(x + w).toFixed(1)}" y1="${(y + 2.5).toFixed(1)}" y2="${(y + 2.5).toFixed(1)}"/>`;
          }
          return `<tspan x="${x.toFixed(1)}" class="${cls}">${text}</tspan>`;
        })
        .join("");
      void shift;
      const endX = x0 + t.condition.length * CHAR + 8;
      const badge = enabled.has(t.id)
        ? `<text class="${value ? "c-true" : "c-false"} res" x="${endX.toFixed(1)}" y="${y}">${value ? "✓" : "✗"}</text>`
        : "";
      return `${head}${back}<text class="qsfc-code qsfc-cond" x="${xs}" y="${ys}">${spans}</text>${badge}`;
    });
    // the bar: green / red when the transition can fire (a step before it is active), gray otherwise
    const state = enabled.has(t.id) ? (evaluate(t.condition) ? "t-true" : "t-false") : "t-idle";
    svg = svg.replace(`<g class="qsfc-transition${t.auto ? " qsfc-auto" : ""}" data-id="${t.id}">`, `<g class="qsfc-transition${t.auto ? " qsfc-auto" : ""} ${state}${variant !== "parts" && enabled.has(t.id) ? " fireable" : ""}" data-id="${t.id}">`);
  }
  for (const s of r.graph!.steps) if (ACTIVE.has(s.name)) svg = svg.replace(`data-id="${s.id}">`, `data-id="${s.id}" class-active="1">`);
  return svg.replace(/(<g class="qsfc-step[^"]*") data-id="([^"]+)" class-active="1">/g, '$1 data-id="$2" data-active="1">');
}

const VARIANTS: Array<[Variant, string, string]> = [
  ["parts", "A · Colored parts", "Every part of a condition is green (true) or red (false): tags, step members (fill.done) and comparisons (count < 10) as one unit; AND / OR / NOT and brackets stay gray. ✓ / ✗ after a condition that can fire now. Clicks work as in B and C, without a visual cue."],
  ["buttons", "B · Input buttons", "A's colors, and every input in a condition is a button: filled green when 1, outlined red when 0; click it to toggle. A transition that can fire has a ring on hover: click its bar to fire it."],
  ["values", "C · Buttons and values", "B, and a comparison shows its tag's value under it (count=7) with a green or red underline, so you see why it is true or false."],
];

const css = `
.qsfc .c-true { fill:#15803d; font-weight:700; } .qsfc .c-false { fill:#b42318; font-weight:700; } .qsfc .c-op { fill:#6b7280; }
.qsfc .res { font:700 12px system-ui; }
.qsfc .pill-on { fill:#15803d; } .qsfc .pill-off { fill:#fff; stroke:#b42318; stroke-width:1.2; }
.qsfc .pill-t-on { fill:#fff; font-weight:700; } .qsfc .pill-t-off { fill:#b42318; font-weight:700; }
.qsfc .pill { cursor:pointer; }
.qsfc .chip { fill:#eef0f3; } .qsfc .chip-t { font:600 9px ui-monospace,Consolas,monospace; fill:#374151; }
.qsfc .c-true-u { stroke:#15803d; stroke-width:1.5; } .qsfc .c-false-u { stroke:#b42318; stroke-width:1.5; }
.qsfc .t-true > rect, .qsfc .t-true > line { fill:#15803d !important; stroke:#15803d !important; }
.qsfc .t-false > rect, .qsfc .t-false > line { fill:#b42318 !important; stroke:#b42318 !important; }
.qsfc .t-idle > rect, .qsfc .t-idle > line { opacity:.55; }
.qsfc .fireable { cursor:pointer; } .qsfc .fireable.ring > rect:first-of-type { stroke:#1d5fd1 !important; stroke-width:6px !important; stroke-opacity:.35; paint-order:stroke; }
.qsfc [data-active="1"] > rect { fill:#dcfce7 !important; stroke:#15803d !important; stroke-width:2.5px !important; }
`;

const pane = ([v, name, idea]: [Variant, string, string]) =>
  `<div class="pane"><div class="pane-h">${name}</div><p class="idea">${idea}</p><div class="svgbox" data-v="${v}">${decorate(v)}</div></div>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simulation diagram mockup</title>
<style>
body { margin:0; padding:16px; font:14px/1.45 system-ui,sans-serif; background:#e9ecf0; color:#1d2228; }
h1 { font-size:18px; margin:0 0 4px; } .lead { color:#59626e; max-width:1150px; margin:0 0 10px; }
.choices { background:#fff8e6; border:1px solid #e3c770; border-radius:8px; padding:10px 14px 10px 30px; max-width:1150px; } .choices li { margin:3px 0; }
.state { font-size:13px; background:#fff; border:1px solid #d5dae0; border-radius:8px; padding:6px 10px; max-width:1150px; margin:10px 0; }
.cols { display:grid; grid-template-columns:repeat(auto-fit, minmax(560px,1fr)); gap:12px; margin-top:12px; }
.pane { background:#fff; border:1px solid #b9c0c8; border-radius:8px; overflow:hidden; }
.pane-h { font-size:13px; font-weight:700; padding:6px 10px; background:#f8f9fb; border-bottom:1px solid #d5dae0; }
.idea { font-size:12.5px; color:#59626e; margin:6px 10px; min-height:5.5em; }
.svgbox { padding:8px; overflow:auto; } .svgbox svg { display:block; margin:0 auto; }
.tip { position:absolute; background:#1d2228; color:#fff; font-size:12px; padding:3px 8px; border-radius:5px; pointer-events:none; }
${css}
@media (max-width: 640px) { .cols { grid-template-columns:1fr; } }
</style></head><body class="qsfc-light">
<h1>Phase 4e · The diagram while simulating</h1>
<p class="lead">The same chart in three versions. State: <b>fill</b> is active (3.1 s of 5 s), so its transition <code>fill.done OR level_high</code> can fire; <code>level_high</code> just came on, so it is true (✓). Hover a transition or an input in B and C.</p>
<ol class="choices">
  <li><b>Click a transition's bar</b>: it fires on the next scan, whatever its condition, if a step before it is active (otherwise a tip says which step must be active). The Trace notes "fired by hand".</li>
  <li><b>Click an input in a condition</b> (a tag the chart only reads): it toggles, like in Live tags. A number opens a small field. Shift+click: a pulse (1 for one scan), for push buttons.</li>
  <li><b>Colors:</b> every part of every condition is green or red, all the time, not only for the transitions that can fire; a part is a tag, a step member (<code>fill.done</code>) or a comparison (<code>count &lt; 10</code>). The bar shows the transition: green / red when it can fire, gray when its step isn't active.</li>
</ol>
<div class="state">Inputs: start_btn 0 · e_stop 0 · level_high <b>1</b> · level_ok <b>1</b> · ack_btn 0 · count 7 &nbsp;·&nbsp; Steps: idle · <b>fill (3.1 s)</b> · check · mix · alarm</div>
<div class="cols">${VARIANTS.map(pane).join("")}</div>
<script>
// hover cues for the mockup: ring on a fireable transition, a tip on inputs
const tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; document.body.append(tip);
for (const g of document.querySelectorAll(".fireable")) {
  g.addEventListener("mouseenter", (e) => { g.classList.add("ring"); tip.textContent = "Click: fire this transition"; tip.hidden = false; });
  g.addEventListener("mousemove", (e) => { tip.style.left = e.pageX + 12 + "px"; tip.style.top = e.pageY + 12 + "px"; });
  g.addEventListener("mouseleave", () => { g.classList.remove("ring"); tip.hidden = true; });
}
</script>
</body></html>
`;
mkdirSync("docs/mockups/sim", { recursive: true });
writeFileSync("docs/mockups/sim/diagram.html", html);
console.log("wrote docs/mockups/sim/diagram.html");
