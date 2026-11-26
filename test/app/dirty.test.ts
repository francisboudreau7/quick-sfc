import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile.js";
import {
  isDirty,
  markSaved,
  needsDiscardConfirm,
  newFileState,
  openedFileState,
  qsfcFileName,
  saveRoute,
  STARTER,
  UNTITLED,
  windowTitle,
} from "../../app/dirty.js";

describe("dirty state", () => {
  it("a new chart is dirty once it differs from what it started with", () => {
    const f = newFileState();
    expect(f.name).toBe(UNTITLED);
    expect(isDirty(f, "")).toBe(false);
    expect(isDirty(f, "x")).toBe(true);
    expect(isDirty(f, STARTER, STARTER)).toBe(false);
    expect(isDirty(f, STARTER + "x", STARTER)).toBe(true);
  });

  it("an opened file is dirty when the text differs from the saved text", () => {
    const f = openedFileState("a.qsfc", "init a", true);
    expect(isDirty(f, "init a")).toBe(false);
    expect(isDirty(f, "init b")).toBe(true);
    // Typing and undoing back to the saved text is clean again.
    expect(isDirty(f, "init a")).toBe(false);
  });

  it("markSaved records the text, and optionally a new name and handle", () => {
    const f = markSaved(newFileState(), "init x", "x.qsfc", true);
    expect(f).toEqual({ name: "x.qsfc", savedText: "init x", hasHandle: true });
    expect(isDirty(f, "init x")).toBe(false);
    expect(markSaved(f, "y").name).toBe("x.qsfc");
  });

  it("window title shows a dot when dirty", () => {
    expect(windowTitle(undefined, false)).toBe("QuickSFC");
    expect(windowTitle("a.qsfc", false)).toBe("a.qsfc · QuickSFC");
    expect(windowTitle("a.qsfc", true)).toBe("• a.qsfc · QuickSFC");
  });

  it("confirm before discarding only with unsaved changes and not while watching", () => {
    expect(needsDiscardConfirm(true, false)).toBe(true);
    expect(needsDiscardConfirm(false, false)).toBe(false);
    expect(needsDiscardConfirm(true, true)).toBe(false);
  });
});

describe("save route", () => {
  const withHandle = openedFileState("a.qsfc", "", true);
  const noHandle = openedFileState("a.qsfc", "", false);
  it("Save writes through the handle when there is one", () => {
    expect(saveRoute(withHandle, true, false)).toBe("handle");
    expect(saveRoute(withHandle, false, false)).toBe("handle");
  });
  it("otherwise picks a file (Edge/Chrome) or downloads (Firefox)", () => {
    expect(saveRoute(noHandle, true, false)).toBe("picker");
    expect(saveRoute(noHandle, false, false)).toBe("download");
    expect(saveRoute(newFileState(), false, false)).toBe("download");
  });
  it("Save As never reuses the handle", () => {
    expect(saveRoute(withHandle, true, true)).toBe("picker");
    expect(saveRoute(withHandle, false, true)).toBe("download");
  });
});

describe("file names and starter", () => {
  it("keeps or adds the .qsfc extension", () => {
    expect(qsfcFileName("tank.qsfc")).toBe("tank.qsfc");
    expect(qsfcFileName("C:\\x\\tank.QSFC")).toBe("tank.QSFC");
    expect(qsfcFileName("tank.txt")).toBe("tank.qsfc");
    expect(qsfcFileName("tank")).toBe("tank.qsfc");
  });
  it("the starter template compiles without errors", () => {
    const r = compile(STARTER);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.graph?.steps.length).toBe(2);
  });
});
