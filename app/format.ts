/**
 * Small formatting and sorting helpers for the window (no DOM). Unit-tested in test/app.
 */
import type { Graph, TagInfo } from "../src/model/graph.js";

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export interface ChartCounts {
  steps: number;
  transitions: number;
  branches: number;
}

export function chartCounts(graph: Graph | undefined): ChartCounts | undefined {
  if (!graph) return undefined;
  return { steps: graph.steps.length, transitions: graph.transitions.length, branches: graph.branches.length };
}

// ---------------------------------------------------------------------------------------------
// Tags table
// ---------------------------------------------------------------------------------------------

export type TagSortKey = "name" | "type" | "address" | "uses" | "description";
export type SortDir = "asc" | "desc";

export interface TagSort {
  key: TagSortKey;
  dir: SortDir;
}

export const DEFAULT_TAG_SORT: TagSort = { key: "name", dir: "asc" };

const byName = (a: TagInfo, b: TagInfo): number =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name);

/** Sorted copy. Ties fall back to the name (ascending), so the order is stable. */
export function sortTags(tags: readonly TagInfo[], sort: TagSort): TagInfo[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const primary = (a: TagInfo, b: TagInfo): number => {
    switch (sort.key) {
      case "name":
        return byName(a, b);
      case "type":
        return a.type.localeCompare(b.type);
      case "address": {
        // Tags without an I/O address go last in ascending order.
        const da = a.address ?? "";
        const db = b.address ?? "";
        if (!da !== !db) return da ? -1 : 1;
        return da.localeCompare(db, undefined, { numeric: true });
      }
      case "uses":
        return a.uses.length - b.uses.length;
      case "description": {
        // Tags without a description go last in ascending order.
        const da = a.description ?? "";
        const db = b.description ?? "";
        if (!da !== !db) return da ? -1 : 1;
        return da.toLowerCase().localeCompare(db.toLowerCase());
      }
    }
  };
  return [...tags].sort((a, b) => sign * primary(a, b) || byName(a, b));
}

/** Clicking a header: same column flips the direction, another column starts ascending (uses: descending). */
export function nextTagSort(current: TagSort, key: TagSortKey): TagSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "uses" ? "desc" : "asc" };
}

/** "Used on lines 4, 7, 12" (distinct, sorted). */
export function usesTitle(tag: TagInfo): string {
  const lines = [...new Set(tag.uses.map((u) => u.line))].sort((a, b) => a - b);
  if (lines.length === 0) return "Not used in the chart";
  return `Used on line${lines.length === 1 ? "" : "s"} ${lines.join(", ")}`;
}
