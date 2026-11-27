/**
 * SFC logic checks (Phase 4e, SPEC §9.2 W700-W704), on the parsed program. Warnings only; a
 * condition the checker can't read (function calls, arithmetic on tags) is left alone. Pure.
 */
import { actionLineText, walk, type ActionNode, type Chart, type ProgramNode, type Sequence, type StepNode, type TransitionNode } from "../model/ast.js";
import { warning, type Diagnostic } from "../model/diagnostics.js";
import { describeWitness, parseExpr, satisfiable, type Expr } from "../st/expr.js";

const condOf = (t: TransitionNode): Expr | undefined => {
  if (t.else) return undefined;
  const e = parseExpr(t.condition.text);
  return e.k === "unknown" ? undefined : e;
};

/** Tags written by an action (`x := …`, `x [:=] …`, `on / set / reset x`), lower case. */
function written(a: ActionNode): Set<string> {
  const out = new Set<string>();
  for (const line of a.lines) {
    if (line.sugar) {
      for (const n of line.sugar.names) out.add(n.text.toLowerCase());
      continue;
    }
    for (const m of actionLineText(line).matchAll(/(?:^|;|\bTHEN\b|\bELSE\b|\bDO\b)\s*([A-Za-z_]\w*)\s*(?:\[:=\]|:=)/gi)) out.add(m[1]!.toLowerCase());
  }
  return out;
}

function stepsOf(seq: Sequence): StepNode[] {
  const out: StepNode[] = [];
  for (const el of walk(seq)) if (el.kind === "step") out.push(el);
  return out;
}

export function checkLogic(program: ProgramNode): Diagnostic[] {
  const out: Diagnostic[] = [];
  const charts = program.routines.flatMap((r) => (r.kind === "sfc" ? [r.chart] : []));
  for (const chart of charts) {
    selects(chart, out);
    parallels(chart, out);
    stuckSteps(chart, out);
  }
  storedNeverReset(charts, out);
  return out;
}

// W700 / W704: legs of a select that can be true together; an else that can never run
function selects(chart: Chart, out: Diagnostic[]): void {
  for (const el of walk(chart.body)) {
    if (el.kind !== "select") continue;
    const firsts = el.legs.map((leg) => (leg[0]?.kind === "transition" ? leg[0] : undefined));
    const conds = firsts.map((t) => (t ? condOf(t) : undefined));
    for (let j = 1; j < firsts.length; j++) {
      const tj = firsts[j];
      const cj = conds[j];
      if (!tj || !cj) continue;
      for (let i = 0; i < j; i++) {
        const ci = conds[i];
        if (!ci) continue;
        const w = satisfiable([ci, cj]);
        if (!w) continue;
        out.push(
          warning("W700", tj.condition.span, `legs ${i + 1} and ${j + 1} of this select can both be true (when ${describeWitness(w, [ci, cj])}): the first one wins`,
            "make the legs exclusive, e.g. write the last one `-- else`"),
        );
        break;
      }
    }
    const elseT = firsts.find((t) => t?.else);
    const others = conds.filter((c, k) => c && !firsts[k]?.else) as Expr[];
    if (elseT && others.length === firsts.length - 1 && others.length) {
      const any: Expr = others.reduce((a, b) => ({ k: "bin", op: "OR", a, b }));
      if (satisfiable([{ k: "not", a: any }]) === null) {
        out.push(warning("W704", elseT.condition.span, "the `else` leg can never run: the other legs cover every case", "remove one of the legs"));
      }
    }
  }
}

// W701: a tag written in two legs of a parallel
function parallels(chart: Chart, out: Diagnostic[]): void {
  for (const el of walk(chart.body)) {
    if (el.kind !== "parallel") continue;
    const seen = new Map<string, { leg: number; line: number }>();
    el.legs.forEach((leg, li) => {
      for (const s of stepsOf(leg)) {
        for (const a of s.actions) {
          for (const tag of written(a)) {
            const first = seen.get(tag);
            if (first && first.leg !== li) {
              const line = a.lines[0]?.span ?? s.name.span;
              out.push(
                warning("W701", line, `\`${tag}\` is written in two parallel legs (lines ${first.line} and ${line.line}): each scan, the last one written wins`,
                  "write it in one leg only"),
              );
              seen.set(tag, { leg: li, line: line.line });
            } else if (!first) seen.set(tag, { leg: li, line: (a.lines[0]?.span ?? s.name.span).line });
          }
        }
      }
    });
  }
}

// W702: a stored (S) action that no R action resets
function storedNeverReset(charts: Chart[], out: Diagnostic[]): void {
  const resetTags = new Set<string>();
  const stored: Array<{ step: StepNode; a: ActionNode; tags: Set<string> }> = [];
  for (const chart of charts) {
    for (const s of walk(chart.body)) {
      if (s.kind !== "step") continue;
      for (const a of s.actions) {
        if (a.qualifier === "R") for (const t of written(a)) resetTags.add(t);
        if (a.qualifier === "S") stored.push({ step: s, a, tags: written(a) });
      }
    }
  }
  for (const { step, a, tags } of stored) {
    if (!tags.size || [...tags].some((t) => resetTags.has(t))) continue;
    const span = a.header ?? a.span;
    out.push(
      warning("W702", span, `the S action of \`${step.name.text}\` (on ${[...tags].map((t) => `\`${t}\``).join(", ")}) is never reset: it keeps running after the step`,
        "add an R action writing the same tag in a later step"),
    );
  }
}

// W703: a step none of whose transitions can ever be true
function stuckSteps(chart: Chart, out: Diagnostic[]): void {
  const visit = (seq: Sequence): void => {
    seq.forEach((el, i) => {
      if (el.kind === "select" || el.kind === "parallel") el.legs.forEach(visit);
      if (el.kind !== "step") return;
      const next = seq[i + 1];
      const outs: TransitionNode[] =
        next?.kind === "transition" ? [next] : next?.kind === "select" ? next.legs.flatMap((l) => (l[0]?.kind === "transition" ? [l[0]] : [])) : [];
      if (!outs.length || outs.some((t) => t.else)) return;
      const conds = outs.map(condOf);
      if (conds.some((c) => !c)) return;
      if (conds.every((c) => satisfiable([c!]) === null)) {
        out.push(
          warning("W703", el.name.span, `step \`${el.name.text}\` can never be left: ${outs.length > 1 ? "none of its transitions can" : "its transition can't"} ever be true`,
            "check the condition"),
        );
      }
    });
  };
  visit(chart.body);
}
