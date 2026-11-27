/**
 * Reads one Studio 5000 SFC routine (an `<SFCContent>`) into a small model for Tidy:
 * steps (and Stop / SbrRet elements, treated as steps with nothing after them), transitions,
 * branches with their legs, directed links, text boxes and attachments.
 *
 * UNVERIFIED formats (no Studio export in the repo has them; read tolerantly):
 *   <Stop ID X Y Operand HideDesc DescX DescY DescWidth .../>, <SbrRet ...> (same as Stop),
 *   <TextBox ID X Y Width ...>text</TextBox>, <Attachment FromID ToID/> (either end may be the
 *   text box; any two *ID attributes are accepted).
 */
import { attr, scanDescendants, type ScanElement } from "./scan.js";

export type NodeKind = "step" | "stop" | "transition";

export interface SfcNode {
  id: string;
  kind: NodeKind;
  el: ScanElement;
  operand: string;
  initial: boolean;
  /** Steps: lines of the action boxes as Studio shows them (0 without actions). */
  actionLines: number;
  /** Steps: every action line (for the diagram text widths). Transitions: the condition. */
  text: string[];
}

export interface SfcBranch {
  id: string;
  type: "selection" | "simultaneous";
  flow: "diverge" | "converge";
  legs: string[];
  el: ScanElement;
}

export interface SfcLink {
  from: string;
  to: string;
  el: ScanElement;
}

export interface SfcChart {
  nodes: Map<string, SfcNode>;
  /** Steps and stops, then transitions, in document order. */
  stepOrder: string[];
  transOrder: string[];
  branches: Map<string, SfcBranch>;
  legOf: Map<string, string>;
  links: SfcLink[];
  textBoxes: ScanElement[];
  /** Text box id -> id of the element it is attached to. */
  attached: Map<string, string>;
}

const KNOWN = new Set(["Step", "Transition", "Branch", "DirectedLink", "Stop", "SbrRet", "TextBox", "Attachment"]);

/** The chart, or a plain sentence saying why it can't be read. */
export function readSfc(content: ScanElement): SfcChart | string {
  const chart: SfcChart = {
    nodes: new Map(),
    stepOrder: [],
    transOrder: [],
    branches: new Map(),
    legOf: new Map(),
    links: [],
    textBoxes: [],
    attached: new Map(),
  };
  const ids = new Set<string>();
  const claim = (id: string | undefined, what: string): string | undefined => {
    if (id === undefined) return `a ${what} element has no ID`;
    if (ids.has(id)) return `two elements share the ID ${id}`;
    ids.add(id);
    return undefined;
  };
  const attachments: ScanElement[] = [];
  for (const el of content.children) {
    if (!KNOWN.has(el.name)) return `the chart has a <${el.name}> element that Tidy does not know`;
    const id = attr(el, "ID");
    if (el.name === "Step" || el.name === "Stop" || el.name === "SbrRet") {
      const bad = claim(id, el.name);
      if (bad) return bad;
      const actions = el.children.filter((c) => c.name === "Action");
      for (const a of actions) {
        const aid = attr(a, "ID");
        if (aid !== undefined) {
          const bad2 = claim(aid, "Action");
          if (bad2) return bad2;
        }
      }
      const lines = actions.map((a) => scanDescendants(a, "Line").map((l) => l.text.replace(/^\r?\n|\r?\n$/g, "")));
      // every action box shows its lines (at least one), plus a header for each action after the
      // first: the rule of the export (actionBoxLines, src/compile.ts), where the first action
      // holds the name comment
      const shown = attr(el, "ShowActions") !== "false";
      const actionLines = shown && lines.length ? lines.reduce((n, l) => n + Math.max(1, l.length), 0) + lines.length - 1 : 0;
      chart.nodes.set(id!, {
        id: id!,
        kind: el.name === "Step" ? "step" : "stop",
        el,
        operand: attr(el, "Operand") ?? `${el.name}_${id}`,
        initial: attr(el, "InitialStep") === "true",
        actionLines,
        text: lines.flat(),
      });
      chart.stepOrder.push(id!);
    } else if (el.name === "Transition") {
      const bad = claim(id, el.name);
      if (bad) return bad;
      const cond = scanDescendants(el, "Line").map((l) => l.text.replace(/^\r?\n|\r?\n$/g, ""));
      chart.nodes.set(id!, {
        id: id!,
        kind: "transition",
        el,
        operand: attr(el, "Operand") ?? `Transition_${id}`,
        initial: false,
        actionLines: 0,
        text: [cond.join(" ")],
      });
      chart.transOrder.push(id!);
    } else if (el.name === "Branch") {
      const bad = claim(id, el.name);
      if (bad) return bad;
      const type = attr(el, "BranchType");
      const flow = attr(el, "BranchFlow");
      if ((type !== "Selection" && type !== "Simultaneous") || (flow !== "Diverge" && flow !== "Converge")) {
        return `branch ${id} has an unknown type (${type ?? "?"} ${flow ?? "?"})`;
      }
      const legs: string[] = [];
      for (const leg of el.children) {
        if (leg.name !== "Leg") return `branch ${id} has a <${leg.name}> element that Tidy does not know`;
        const lid = attr(leg, "ID");
        const bad2 = claim(lid, "Leg");
        if (bad2) return bad2;
        legs.push(lid!);
        chart.legOf.set(lid!, id!);
      }
      chart.branches.set(id!, {
        id: id!,
        type: type === "Selection" ? "selection" : "simultaneous",
        flow: flow === "Diverge" ? "diverge" : "converge",
        legs,
        el,
      });
    } else if (el.name === "DirectedLink") {
      const from = attr(el, "FromID");
      const to = attr(el, "ToID");
      if (from === undefined || to === undefined) return "a wire has no FromID or ToID";
      chart.links.push({ from, to, el });
    } else if (el.name === "TextBox") {
      const bad = claim(id, el.name);
      if (bad) return bad;
      chart.textBoxes.push(el);
      attachments.push(...scanDescendants(el, "Attachment"));
    } else {
      attachments.push(el);
    }
  }
  const boxIds = new Set(chart.textBoxes.map((t) => attr(t, "ID")!));
  for (const a of attachments) {
    const ends = a.attrs.filter((x) => /ID$/.test(x.name)).map((x) => x.value);
    const box = ends.find((e) => boxIds.has(e));
    const other = ends.find((e) => e !== box);
    if (box !== undefined && other !== undefined && !chart.attached.has(box)) chart.attached.set(box, other);
  }
  return chart;
}
