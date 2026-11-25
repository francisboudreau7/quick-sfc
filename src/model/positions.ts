/**
 * Element coordinates in Studio 5000 SFC units, produced by the layout engine
 * (src/layout) and consumed by the L5X writer (src/l5x).
 */
import type { GraphId } from "./graph.js";

export interface L5XPositions {
  /** X/Y of every step and transition (the element's reference point, as in L5X). */
  nodes: Map<GraphId, { x: number; y: number }>;
  /** Y of every branch bar (L5X branches only have Y). */
  branches: Map<GraphId, { y: number }>;
}
