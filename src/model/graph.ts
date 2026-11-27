/**
 * The chart as a graph, produced by lowering (src/lower) from a *valid* Chart.
 * It is shaped like Studio 5000's SFCContent: steps, transitions, branches with legs,
 * and directed links between them, so the L5X writer only has to serialize it.
 *
 * Link patterns (verified, L5X_GUIDE §6.3):
 *   plain:               Step -> Transition, Transition -> Step
 *   selection diverge:   Step -> Branch, Leg -> first Transition of the leg
 *   selection converge:  last Transition of each leg -> Leg, Branch -> next Step
 *   parallel diverge:    Transition -> Branch, Leg -> first Step of the leg
 *   parallel converge:   last Step of each leg -> Leg, Branch -> next Transition
 */
import type { ActionNode, BranchNode, Qualifier, StepNode, TransitionNode, TagType } from "./ast.js";
import type { Span } from "./diagnostics.js";

/** Graph ids: "s0".."sN" steps, "t0".. transitions, "b0".. branches, "b3.0" legs. */
export type GraphId = string;

export interface GStep {
  id: GraphId;
  /** 0-based index in file order -> operand Step_000 (SPEC §13.7). */
  index: number;
  name: string;
  initial: boolean;
  presetMs: number;
  description?: string;
  /** The step's actions in source order (SPEC §4.3); empty = no action. */
  actions: GAction[];
  node: StepNode;
}

/** One action of a step. */
export interface GAction {
  qualifier: Qualifier;
  /** L and D: the action time in milliseconds (the PRE of the action tag). */
  timeMs?: number;
  /** Dedented ST lines, sugar expanded (SPEC §4.3). Raw otherwise (not rewritten). */
  lines: string[];
  /**
   * Operand number (Action_000...) as the L5X writer gives it with its default name comments:
   * numbered across the program in step order, and a step without actions still takes one.
   */
  index: number;
  node: ActionNode;
}

export interface GTransition {
  id: GraphId;
  /** 0-based index in file order -> operand Tran_000. */
  index: number;
  name: string;
  auto: boolean;
  /** Raw condition (not rewritten; `after 5s` kept as written). */
  condition: string;
  /** The step an `after` term of the condition refers to (SPEC §4.4); set when the condition has one. */
  afterStep?: string;
  node: TransitionNode;
}

export interface GLeg {
  id: GraphId;
}

export interface GBranch {
  id: GraphId;
  type: "selection" | "simultaneous";
  flow: "diverge" | "converge";
  legs: GLeg[];
  /**
   * The select/parallel block this branch comes from. Absent for an automatic
   * selection convergence (SPEC §6.4), which has `target` instead.
   */
  node?: BranchNode;
  /** For automatic convergences: the step it feeds. */
  target?: GraphId;
  /**
   * For converge branches: the transition feeding each leg, same order as `legs`
   * (selection), or the step feeding each leg (simultaneous). Used by the layout to
   * know which legs are jumps.
   */
  sources?: GraphId[];
}

export interface GLink {
  from: GraphId;
  to: GraphId;
}

export interface Graph {
  /** File order. */
  steps: GStep[];
  /** File order. */
  transitions: GTransition[];
  /** Diverge before its converge; otherwise in order of first appearance in the file. */
  branches: GBranch[];
  links: GLink[];
}

/** A program tag found or declared in the chart (src/tags). */
export interface TagInfo {
  /** First spelling seen (declaration first, else first use). */
  name: string;
  type: TagType;
  /** true when the type comes from a `tag` line. */
  declared: boolean;
  description?: string;
  /** `io` block (SPEC §7.6): the I/O address; the tag is exported as an alias tag. */
  address?: string;
  /** Every place the tag is used in ST (not the declaration). */
  uses: Span[];
}
