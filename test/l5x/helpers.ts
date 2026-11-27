import type { Graph, GAction, GBranch, GStep, GTransition, TagInfo } from "../../src/model/graph.js";
import type { L5XPositions } from "../../src/model/positions.js";
import type { Qualifier, TagType } from "../../src/model/ast.js";

export interface StepSpec {
  id: string;
  index: number;
  name?: string;
  x: number;
  y: number;
  initial?: boolean;
  preset?: number;
  /** Lines of a single N action (shortcut for `actions`). */
  action?: string[];
  actions?: Array<{ qualifier: Qualifier; timeMs?: number; lines: string[] }>;
  description?: string;
}

export interface TranSpec {
  id: string;
  index: number;
  name?: string;
  x: number;
  y: number;
  condition: string;
}

export interface BranchSpec {
  id: string;
  type: "selection" | "simultaneous";
  flow: "diverge" | "converge";
  legs: number;
  y: number;
}

/** Builds a Graph and its positions by hand; node references are minimal casts. */
export function build(
  steps: StepSpec[],
  trans: TranSpec[],
  branches: BranchSpec[],
  links: Array<[string, string]>,
): { graph: Graph; positions: L5XPositions } {
  const positions: L5XPositions = { nodes: new Map(), branches: new Map() };
  const gsteps: GStep[] = steps.map((s) => {
    positions.nodes.set(s.id, { x: s.x, y: s.y });
    return {
      id: s.id,
      index: s.index,
      name: s.name ?? `step${s.index}`,
      initial: s.initial ?? false,
      presetMs: s.preset ?? 0,
      ...(s.description !== undefined ? { description: s.description } : {}),
      actions: (s.actions ?? (s.action?.length ? [{ qualifier: "N" as const, lines: s.action }] : [])).map(
        (a, k): GAction => ({ ...a, index: s.index + k, node: {} as never }),
      ),
      node: {} as never,
    };
  });
  const gtrans: GTransition[] = trans.map((t) => {
    positions.nodes.set(t.id, { x: t.x, y: t.y });
    return { id: t.id, index: t.index, name: t.name ?? `T${t.index}`, auto: false, condition: t.condition, node: {} as never };
  });
  const gbranches: GBranch[] = branches.map((b) => {
    positions.branches.set(b.id, { y: b.y });
    return {
      id: b.id,
      type: b.type,
      flow: b.flow,
      legs: Array.from({ length: b.legs }, (_, i) => ({ id: `${b.id}.${i}` })),
    };
  });
  return {
    graph: { steps: gsteps, transitions: gtrans, branches: gbranches, links: links.map(([from, to]) => ({ from, to })) },
    positions,
  };
}

export function tag(name: string, type: TagType = "BOOL", description?: string): TagInfo {
  return { name, type, declared: false, ...(description !== undefined ? { description } : {}), uses: [] };
}

export const DATE = new Date(2026, 10, 2, 10, 52, 7); // Mon Nov 02 10:52:07 2026 (local)

export const parallel = () =>
  build(
    [
      { id: "s0", index: 0, x: 200, y: 100, initial: true },
      { id: "s1", index: 1, x: 100, y: 340, action: ["Out_A[:=]1;"] },
      { id: "s2", index: 2, x: 400, y: 340, action: ["Out_B[:=]1;"], preset: 1000 },
    ],
    [
      { id: "t0", index: 0, x: 200, y: 220, condition: "Go" },
      { id: "t1", index: 1, x: 200, y: 540, condition: "Done_A and Done_B and Step_002.DN" },
    ],
    [
      { id: "b0", type: "simultaneous", flow: "diverge", legs: 2, y: 280 },
      { id: "b1", type: "simultaneous", flow: "converge", legs: 2, y: 480 },
    ],
    [
      ["s0", "t0"],
      ["t0", "b0"],
      ["b0.0", "s1"],
      ["b0.1", "s2"],
      ["s1", "b1.0"],
      ["s2", "b1.1"],
      ["b1", "t1"],
      ["t1", "s0"],
    ],
  );
