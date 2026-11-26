import { describe, expect, it } from "vitest";
import {
  clamp,
  DEFAULT_LAYOUT,
  dragFraction,
  dragProblems,
  dragTags,
  gridColumns,
  keyDelta,
  LAYOUT_KEY,
  loadLayout,
  MAX_TAGS,
  MIN_PANE,
  MIN_PROBLEMS,
  MIN_TAGS,
  parseLayout,
  saveLayout,
  serializeLayout,
} from "../../app/splitter.js";

describe("splitter math", () => {
  it("clamp handles NaN and inverted bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(NaN, 2, 10)).toBe(2);
    expect(clamp(5, 10, 0)).toBe(10);
  });

  it("dragFraction moves by delta / available width and keeps both panes >= MIN_PANE", () => {
    expect(dragFraction(0.5, 100, 1000)).toBeCloseTo(0.6);
    expect(dragFraction(0.5, -100, 1000)).toBeCloseTo(0.4);
    expect(dragFraction(0.5, 10_000, 1000)).toBeCloseTo(1 - MIN_PANE / 1000);
    expect(dragFraction(0.5, -10_000, 1000)).toBeCloseTo(MIN_PANE / 1000);
    // Too narrow for two minimum panes: stays centered.
    expect(dragFraction(0.2, 0, 200)).toBe(0.5);
    expect(dragFraction(0.3, 50, 0)).toBe(0.3);
  });

  it("dragTags: dragging left widens the sidebar, within bounds", () => {
    expect(dragTags(300, -50)).toBe(350);
    expect(dragTags(300, 50)).toBe(250);
    expect(dragTags(300, 1000)).toBe(MIN_TAGS);
    expect(dragTags(300, -1000)).toBe(MAX_TAGS);
    expect(dragTags(300, -1000, 400)).toBe(400);
  });

  it("dragProblems: dragging up grows the panel", () => {
    expect(dragProblems(160, -40, 500)).toBe(200);
    expect(dragProblems(160, 500, 500)).toBe(MIN_PROBLEMS);
    expect(dragProblems(160, -1000, 500)).toBe(500);
  });

  it("keyboard steps", () => {
    expect(keyDelta("ArrowLeft", false, "vertical")).toBe(-16);
    expect(keyDelta("ArrowRight", true, "vertical")).toBe(64);
    expect(keyDelta("ArrowUp", false, "vertical")).toBe(0);
    expect(keyDelta("ArrowUp", false, "horizontal")).toBe(-16);
    expect(keyDelta("ArrowDown", false, "horizontal")).toBe(16);
    expect(keyDelta("Enter", false, "horizontal")).toBe(0);
  });

  it("grid columns with and without the Tags sidebar", () => {
    expect(gridColumns({ ...DEFAULT_LAYOUT, editorFrac: 0.4, tagsWidth: 300, tagsOpen: true })).toBe(
      "minmax(0, 0.4000fr) 6px minmax(0, 0.6000fr) 6px 300px",
    );
    expect(gridColumns({ ...DEFAULT_LAYOUT, editorFrac: 0.4, tagsOpen: false })).toBe(
      "minmax(0, 0.4000fr) 6px minmax(0, 0.6000fr) 0px 0px",
    );
  });
});

describe("remembered layout", () => {
  it("round-trips and falls back on bad data", () => {
    const l = { editorFrac: 0.33, tagsWidth: 280, problemsHeight: 200, tagsOpen: false };
    expect(parseLayout(serializeLayout(l))).toEqual(l);
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("{")).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('"x"')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{"editorFrac":5,"tagsWidth":"wide","tagsOpen":1}')).toEqual({ ...DEFAULT_LAYOUT, editorFrac: 0.9 });
  });

  it("load/save never throw", () => {
    const map = new Map<string, string>();
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    const l = { ...DEFAULT_LAYOUT, tagsOpen: false };
    expect(saveLayout(() => store, l)).toBe(true);
    expect(map.has(LAYOUT_KEY)).toBe(true);
    expect(loadLayout(() => store)).toEqual(l);
    const broken = () => {
      throw new Error("blocked");
    };
    expect(loadLayout(broken)).toEqual(DEFAULT_LAYOUT);
    expect(saveLayout(broken, l)).toBe(false);
    expect(saveLayout(() => undefined, l)).toBe(false);
  });
});
