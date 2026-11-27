import { describe, expect, it } from "vitest";
import {
  baseName,
  clampZoom,
  DEFAULT_VIEW,
  fitZoom,
  formatZoom,
  l5xFileName,
  loadViewOptions,
  looksLikeChart,
  MAX_FIT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  parseViewOptions,
  saveViewOptions,
  serializeViewOptions,
  STORAGE_KEY,
  stripBom,
  svgFileName,
  wheelZoom,
  zoomIn,
  zoomOut,
  type KeyValueStore,
} from "../../app/state.js";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("view options", () => {
  it("defaults: names, actions shown, system theme, problems open", () => {
    expect(parseViewOptions(null)).toEqual({ numbers: false, showActions: true, theme: "system", problemsOpen: true, overview: true });
    expect(DEFAULT_VIEW.theme).toBe("system");
  });

  it("round-trips through JSON", () => {
    const v = { numbers: true, showActions: false, theme: "dark" as const, problemsOpen: false, overview: false };
    expect(parseViewOptions(serializeViewOptions(v))).toEqual(v);
  });

  it("ignores malformed or partial data field by field", () => {
    expect(parseViewOptions("not json")).toEqual(DEFAULT_VIEW);
    expect(parseViewOptions("42")).toEqual(DEFAULT_VIEW);
    expect(parseViewOptions('{"theme":"purple","numbers":"yes","showActions":false}')).toEqual({
      ...DEFAULT_VIEW,
      showActions: false,
    });
  });

  it("load/save never throw, even when storage does", () => {
    const throwing = (): KeyValueStore => {
      throw new Error("SecurityError");
    };
    expect(loadViewOptions(throwing)).toEqual(DEFAULT_VIEW);
    expect(saveViewOptions(throwing, DEFAULT_VIEW)).toBe(false);
    const quota: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(saveViewOptions(() => quota, DEFAULT_VIEW)).toBe(false);
    expect(saveViewOptions(() => undefined, DEFAULT_VIEW)).toBe(false);
  });

  it("saves under its key and loads back", () => {
    const s = memoryStore();
    expect(saveViewOptions(() => s, { ...DEFAULT_VIEW, numbers: true })).toBe(true);
    expect(s.data.has(STORAGE_KEY)).toBe(true);
    expect(loadViewOptions(() => s).numbers).toBe(true);
  });
});

describe("zoom", () => {
  it("steps up and down through the zoom steps", () => {
    expect(zoomIn(1)).toBe(1.1);
    expect(zoomOut(1)).toBe(0.9);
    expect(zoomIn(1.05)).toBe(1.1);
    expect(zoomOut(1.05)).toBe(1);
    expect(zoomIn(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(zoomOut(MIN_ZOOM)).toBe(MIN_ZOOM);
  });

  it("clamps", () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("wheel: up zooms in, down zooms out, bounded per event", () => {
    expect(wheelZoom(1, -100)).toBeCloseTo(1.1);
    expect(wheelZoom(1, 100)).toBeCloseTo(1 / 1.1);
    expect(wheelZoom(1, -100000)).toBeCloseTo(Math.pow(1.1, 5));
  });

  it("fit: limited by the tighter side, never above MAX_FIT_ZOOM", () => {
    expect(fitZoom({ width: 1000, height: 500 }, { width: 548, height: 2000 }, 24)).toBeCloseTo(0.5);
    expect(fitZoom({ width: 500, height: 1000 }, { width: 2000, height: 548 }, 24)).toBeCloseTo(0.5);
    expect(fitZoom({ width: 100, height: 100 }, { width: 2000, height: 2000 })).toBe(MAX_FIT_ZOOM);
    expect(fitZoom({ width: 0, height: 0 }, { width: 100, height: 100 })).toBe(1);
    expect(fitZoom({ width: 100000, height: 100 }, { width: 10, height: 10 })).toBe(MIN_ZOOM);
  });

  it("formats as a percentage", () => {
    expect(formatZoom(1)).toBe("100 %");
    expect(formatZoom(0.333)).toBe("33 %");
  });
});

describe("files", () => {
  it("strips a UTF-8 BOM only at the start", () => {
    expect(stripBom("\uFEFFinit a")).toBe("init a");
    expect(stripBom("init a")).toBe("init a");
    expect(stripBom("a\uFEFF")).toBe("a\uFEFF");
  });

  it("derives download names", () => {
    expect(baseName("C:\\charts\\tank.qsfc")).toBe("tank");
    expect(baseName("dir/Tank.QSFC")).toBe("Tank");
    expect(l5xFileName("tp01_linear.qsfc")).toBe("tp01_linear.L5X");
    expect(svgFileName("tp01_linear.qsfc")).toBe("tp01_linear.svg");
    expect(l5xFileName(".qsfc")).toBe("chart.L5X");
  });

  it("accepts .qsfc and .txt", () => {
    expect(looksLikeChart("a.qsfc")).toBe(true);
    expect(looksLikeChart("a.QSFC")).toBe(true);
    expect(looksLikeChart("a.txt")).toBe(true);
    expect(looksLikeChart("a.L5X")).toBe(false);
  });
});
