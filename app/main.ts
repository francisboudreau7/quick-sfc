/**
 * QuickSFC window (Phase 3: live coding). Editor | diagram | Tags, Problems at the bottom.
 * The chart is recompiled ~150 ms after typing stops; on errors the last valid diagram
 * stays, dimmed. Plain DOM plus CodeMirror (app/editor.ts). The markup lives in
 * app/index.html; the pure logic in app/{state,problems,format,highlight,complete,nav,
 * dirty,splitter,watch}.ts.
 */
import { compile, exportL5X, routineName, type CompiledRoutine, type CompileResult } from "../src/compile.js";
import type { Layout } from "../src/layout/index.js";
import { allSteps, key, sfcCharts } from "../src/model/ast.js";
import type { Diagnostic } from "../src/model/diagnostics.js";
import type { Graph } from "../src/model/graph.js";
import { renderSvg } from "../src/render/svg.js";
import type { CompletionInfo } from "./complete.js";
import {
  isDirty,
  markSaved,
  needsDiscardConfirm,
  newFileState,
  openedFileState,
  qsfcFileName,
  saveRoute,
  STARTER,
  windowTitle,
  type FileState,
} from "./dirty.js";
import { createEditor } from "./editor.js";
import { chartCounts, DEFAULT_TAG_SORT, nextTagSort, plural, sortTags, usesTitle, type TagSort, type TagSortKey } from "./format.js";
import { definitionAt, elementAtLine, pickElement, sourceOfElement } from "./nav.js";
import {
  callTree,
  findRoutine,
  notCalledText,
  programName,
  routineAtLine,
  routineSummary,
  stLinesText,
  treeLines,
} from "./routines.js";
import { countProblems, orderProblems, problemKey, problemLocation, problemTag, problemTarget } from "./problems.js";
import {
  dragFraction,
  dragProblems,
  dragTags,
  gridColumns,
  keyDelta,
  loadLayout,
  MIN_PANE,
  NARROW,
  saveLayout,
} from "./splitter.js";
import {
  clampZoom,
  fitZoom,
  formatZoom,
  l5xFileName,
  loadViewOptions,
  looksLikeChart,
  saveViewOptions,
  stripBom,
  svgFileName,
  wheelZoom,
  zoomIn,
  zoomOut,
  type Theme,
  type ViewOptions,
} from "./state.js";
import { shouldApplyText, Watcher } from "./watch.js";

/** Inlined at build time (scripts/build-app.ts): docs/cheatsheet.html and the package version. */
declare const QSFC_CHEATSHEET: string;
declare const QSFC_VERSION: string;

// ---------------------------------------------------------------------------------------------
// DOM handles
// ---------------------------------------------------------------------------------------------

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
}

const ui = {
  fileInput: el<HTMLInputElement>("file-input"),
  body: el("body"),
  editorPane: el("editor-pane"),
  editorHost: el("editor"),
  canvas: el("canvas"),
  stage: el("stage"),
  routineTabs: el("routine-tabs"),
  stView: el("st-view"),
  staleBadge: el("stale-badge"),
  welcome: el("welcome"),
  broken: el("broken"),
  brokenTitle: el("broken-title"),
  brokenDetail: el("broken-detail"),
  zoomReset: el<HTMLButtonElement>("zoom-reset"),
  tagsToggle: el<HTMLButtonElement>("tags-toggle"),
  tagsPane: el("tags-pane"),
  splitEditor: el("split-editor"),
  splitTags: el("split-tags"),
  splitProblems: el("split-problems"),
  fileInfo: el("file-info"),
  fileDot: el("file-dot"),
  fileDirty: el("file-dirty"),
  fileName: el("file-name"),
  fileRoutine: el("file-routine"),
  exportBtn: el<HTMLButtonElement>("export-btn"),
  tagCount: el("tag-count"),
  tagsEmpty: el("tags-empty"),
  tagTable: el<HTMLTableElement>("tag-table"),
  tagBody: el("tag-body"),
  problems: el("problems"),
  problemsToggle: el<HTMLButtonElement>("problems-toggle"),
  problemList: el("problem-list"),
  problemCount: el("problem-count"),
  statusFile: el("status-file"),
  statusCounts: el("status-counts"),
  statusRoutines: el("status-routines"),
  statusRoutine: el("status-routine"),
  statusProblems: el("status-problems"),
  statusCursor: el("status-cursor"),
  watchBanner: el("watch-banner"),
  watchName: el("watch-name"),
  watchItem: el("watch-item"),
  reloadItem: el("reload-item"),
  confirm: el<HTMLDialogElement>("confirm"),
  confirmText: el("confirm-text"),
  dropOverlay: el("drop-overlay"),
  toast: el("toast"),
};

// ---------------------------------------------------------------------------------------------
// File System Access API (Edge/Chrome); minimal types, not in every lib.dom.
// ---------------------------------------------------------------------------------------------

interface Writable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable?: () => Promise<Writable>;
}
type OpenFilePicker = (options?: unknown) => Promise<FileHandle[]>;
type SaveFilePicker = (options?: unknown) => Promise<FileHandle>;

const fsWindow = window as unknown as { showOpenFilePicker?: OpenFilePicker; showSaveFilePicker?: SaveFilePicker };
const canPickOpen = typeof fsWindow.showOpenFilePicker === "function";
/** Checked at each save (the API can be missing or removed, e.g. by a test). */
const canPickSave = (): boolean => typeof fsWindow.showSaveFilePicker === "function";
const PICKER_TYPES = [{ description: "qSFC chart", accept: { "text/plain": [".qsfc"] } }];

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

interface Doc {
  file: FileState;
  /** Text the chart started from (to know when a new chart becomes dirty). */
  initial: string;
  handle: FileHandle | undefined;
}

const storage = (): Storage | undefined => window.localStorage;
const view: ViewOptions = loadViewOptions(storage);
const layout = loadLayout(storage);
let doc: Doc | undefined;
/** Result of the latest compile of the editor text. */
let result: CompileResult | undefined;
let diagnostics: Diagnostic[] = [];
let exportable = false;
/** A diagram of one SFC routine. */
interface Diagram {
  graph: Graph;
  layout: Layout;
  name: string;
}
/**
 * Last valid diagram of each SFC routine (by routine name, case-insensitive), and of each
 * routine position (used when a routine was renamed since): they stay when the text gets errors.
 */
const lastGood = new Map<string, Diagram>();
let lastGoodByIndex: Array<Diagram | undefined> = [];
/** The diagram in the stage now, the routine position it belongs to, and the view options it was drawn with. */
let drawn: { diagram: Diagram; index: number; key: string } | undefined;
/** SVG text in the stage now: an edit that does not change the drawing skips the DOM update. */
let drawnSvg = "";
let zoom = 1;
let svgSize = { width: 0, height: 0 };
let selectedProblem: string | undefined;
let tagSort: TagSort = DEFAULT_TAG_SORT;
let cursor = { line: 1, col: 1 };
let watching: { watcher: Watcher; name: string; first: boolean } | undefined;
let dirty = false;
/** Timings of the last compile (ms), for the status bar tooltip and measurements. */
const perf = { compile: 0, render: 0, total: 0, count: 0 };

// ---------------------------------------------------------------------------------------------
// Editor and the live compile loop
// ---------------------------------------------------------------------------------------------

const COMPILE_DELAY = 150;
let compileTimer: number | undefined;
let cursorFrame: number | undefined;

const editor = createEditor(ui.editorHost, {
  onChange() {
    updateDirty();
    window.clearTimeout(compileTimer);
    compileTimer = window.setTimeout(runCompile, COMPILE_DELAY);
  },
  onCursor(line, col) {
    cursor = { line, col };
    if (cursorFrame === undefined) {
      cursorFrame = requestAnimationFrame(() => {
        cursorFrame = undefined;
        ui.statusCursor.textContent = doc ? `Ln ${cursor.line}, Col ${cursor.col}` : "";
        // The diagram follows the cursor: another routine's line switches the tab.
        if (doc && activeIndex() !== shownIndex) {
          renderDiagram(false);
          renderHeader();
          renderStatus();
        }
        highlightCursorElement(true);
      });
    }
  },
  completionInfo,
  definition(lineText, pos) {
    const r = result;
    if (!r) return undefined;
    const steps = sfcCharts(r.program).flatMap(allSteps).map((s) => ({ name: s.name.text, line: s.name.span.line, col: s.name.span.col }));
    return definitionAt(lineText, pos, { routines: r.routines.map((x) => ({ name: x.name, line: x.lines.from })), steps });
  },
});

function completionInfo(): CompletionInfo {
  const r = result;
  if (!r) return { steps: [], tags: [] };
  // Step names are shared by the whole file (SPEC §4.5): offer the steps of every SFC routine.
  const steps = sfcCharts(r.program).flatMap(allSteps).map((s) => {
    const o: { name: string; presetMs?: number; description?: string; initial: boolean } = { name: s.name.text, initial: s.initial };
    if (s.presetMs !== undefined) o.presetMs = s.presetMs;
    if (s.description !== undefined) o.description = s.description;
    return o;
  });
  const routines = r.routines.map((x, i) => ({ name: x.name, kind: x.kind, main: i === 0 }));
  return { steps, tags: r.tags, routines };
}

/** Compiles the editor text now and updates every view. */
function runCompile(fit = false): void {
  window.clearTimeout(compileTimer);
  compileTimer = undefined;
  if (!doc) return;
  const t0 = performance.now();
  const source = editor.getText();
  try {
    result = compile(source, { fileName: doc.file.name });
  } catch (e) {
    toast(`Internal error while compiling: ${(e as Error).message}`, "error");
    return;
  }
  diagnostics = result.diagnostics;
  exportable = false;
  // Without errors every SFC routine has a graph (src/compile.ts).
  const valid = result.routines.length > 0 && countProblems(result.diagnostics).errors === 0;
  if (valid) {
    // Export-only checks (routine and program names) show up as problems too.
    const check = exportL5X(source, { fileName: doc.file.name });
    exportable = check.text !== undefined;
    diagnostics = check.diagnostics;
    lastGoodByIndex = result.routines.map((r) => diagramOf(r));
    for (const d of lastGoodByIndex) if (d) lastGood.set(key(d.name), d);
  }
  const t1 = performance.now();
  editor.setDiagnostics(diagnostics);
  if (selectedProblem && !diagnostics.some((d) => problemKey(d) === selectedProblem)) selectedProblem = undefined;
  renderAll();
  renderDiagram(fit);
  const t2 = performance.now();
  perf.compile = t1 - t0;
  perf.render = t2 - t1;
  perf.total = t2 - t0;
  perf.count++;
}

// Exposed for debugging and measurements.
(window as unknown as { qsfc: unknown }).qsfc = {
  get zoom() {
    return zoom;
  },
  get perf() {
    return { ...perf };
  },
  get dirty() {
    return dirty;
  },
  get watching() {
    return watching?.name;
  },
  editor,
};

// ---------------------------------------------------------------------------------------------
// Theme and view options
// ---------------------------------------------------------------------------------------------

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("qsfc-dark", theme === "dark");
  root.classList.toggle("qsfc-light", theme === "light");
}

function syncViewMenu(): void {
  for (const item of document.querySelectorAll<HTMLElement>("#view-menu [data-cmd]")) {
    const cmd = item.dataset["cmd"];
    let on = false;
    if (cmd === "numbers") on = view.numbers;
    else if (cmd === "actions") on = view.showActions;
    else if (cmd === "theme") on = item.dataset["value"] === view.theme;
    item.setAttribute("aria-checked", String(on));
  }
}

function setView(patch: Partial<ViewOptions>): void {
  Object.assign(view, patch);
  saveViewOptions(storage, view);
  applyTheme(view.theme);
  syncViewMenu();
  setProblemsOpen(view.problemsOpen);
  renderDiagram(false);
}

// ---------------------------------------------------------------------------------------------
// Toast and confirm dialog
// ---------------------------------------------------------------------------------------------

let toastTimer: number | undefined;
function toast(message: string, kind: "info" | "error" = "info"): void {
  ui.toast.textContent = message;
  ui.toast.className = `toast show ${kind}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (ui.toast.className = "toast"), 3200);
}

/** Asks before discarding unsaved changes. Resolves true when it is OK to go on. */
async function confirmDiscard(action: string): Promise<boolean> {
  if (!doc || !needsDiscardConfirm(dirty, !!watching)) return true;
  ui.confirmText.textContent = `${doc.file.name} has unsaved changes. Save them before you ${action}?`;
  ui.confirm.returnValue = "";
  const answer = await new Promise<string>((resolve) => {
    ui.confirm.addEventListener("close", () => resolve(ui.confirm.returnValue || "cancel"), { once: true });
    ui.confirm.showModal();
    el("confirm-save").focus();
  });
  if (answer === "discard") return true;
  if (answer === "save") return save(false);
  return false;
}

// ---------------------------------------------------------------------------------------------
// Documents: new, open, save
// ---------------------------------------------------------------------------------------------

function setDoc(file: FileState, text: string, handle: FileHandle | undefined, initial: string): void {
  doc = { file, initial, handle };
  result = undefined;
  lastGood.clear();
  lastGoodByIndex = [];
  drawn = undefined;
  shownIndex = -1;
  selectedProblem = undefined;
  editor.setText(text, true);
  updateDirty();
  runCompile(true);
}

async function newChart(text: string): Promise<void> {
  if (!(await confirmDiscard("start a new chart"))) return;
  stopWatch(false);
  setDoc(newFileState(), text, undefined, text);
  editor.goTo(text ? Math.min(4, editor.view.state.doc.lines) : 1, 1, true);
}

function load(name: string, rawText: string, handle?: FileHandle): void {
  const text = stripBom(rawText);
  setDoc(openedFileState(name, text, !!handle), text, handle, text);
}

async function readFile(file: File, handle?: FileHandle): Promise<void> {
  if (!looksLikeChart(file.name)) {
    toast(`${file.name} is not a .qsfc file`, "error");
    return;
  }
  try {
    load(file.name, await file.text(), handle);
  } catch (e) {
    toast(`Could not read ${file.name}: ${(e as Error).message}`, "error");
  }
}

async function pickOpen(): Promise<FileHandle | undefined | "fallback"> {
  if (!canPickOpen) return "fallback";
  try {
    const [handle] = await fsWindow.showOpenFilePicker!({ types: PICKER_TYPES, excludeAcceptAllOption: false, multiple: false });
    return handle;
  } catch (e) {
    if ((e as DOMException).name === "AbortError") return undefined;
    return "fallback"; // SecurityError and friends: plain input
  }
}

async function openFile(): Promise<void> {
  if (!(await confirmDiscard("open another chart"))) return;
  const picked = await pickOpen();
  if (picked === undefined) return;
  if (picked !== "fallback") {
    stopWatch(false);
    await readFile(await picked.getFile(), picked);
    return;
  }
  ui.fileInput.value = "";
  ui.fileInput.click();
}

ui.fileInput.addEventListener("change", () => {
  const file = ui.fileInput.files?.[0];
  if (!file) return;
  stopWatch(false);
  void readFile(file).then(() => {
    if (reloading) toast(`Reloaded ${file.name} from disk`);
    reloading = false;
  });
});

let reloading = false;
async function reloadFromDisk(): Promise<void> {
  if (!(await confirmDiscard("reload the chart from disk"))) return;
  reloading = true;
  ui.fileInput.value = "";
  ui.fileInput.click();
}

async function writeHandle(handle: FileHandle, text: string): Promise<void> {
  if (!handle.createWritable) throw new Error("this file can't be written");
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

/** Save or Save As. Resolves true when the text was saved (or downloaded). */
async function save(saveAs: boolean): Promise<boolean> {
  if (!doc) {
    toast("Nothing to save: start a new chart or open one", "error");
    return false;
  }
  const text = editor.getText();
  const name = qsfcFileName(doc.file.name);
  let route = saveRoute(doc.file, canPickSave(), saveAs);
  if (route === "handle" && doc.handle) {
    try {
      await writeHandle(doc.handle, text);
      doc.file = markSaved(doc.file, text);
      updateDirty();
      toast(`Saved ${doc.file.name}`);
      return true;
    } catch (e) {
      if ((e as DOMException).name === "AbortError" || (e as DOMException).name === "NotAllowedError") {
        toast("Not saved: permission to write the file was refused", "error");
        return false;
      }
      route = canPickSave() ? "picker" : "download";
    }
  }
  if (route === "picker") {
    try {
      const handle = await fsWindow.showSaveFilePicker!({ suggestedName: name, types: PICKER_TYPES });
      await writeHandle(handle, text);
      doc.handle = handle;
      doc.file = markSaved(doc.file, text, handle.name, true);
      updateDirty();
      renderAll();
      toast(`Saved ${handle.name}`);
      return true;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return false;
      route = "download";
    }
  }
  download(name, text, "text/plain");
  doc.file = markSaved(doc.file, text, name, doc.file.hasHandle);
  updateDirty();
  renderAll();
  toast(`Downloaded ${name}`);
  return true;
}

function updateDirty(): void {
  dirty = !!doc && !watching && isDirty(doc.file, editor.getText(), doc.initial);
  document.title = windowTitle(doc?.file.name, dirty);
  ui.fileDirty.hidden = !dirty;
  ui.fileName.textContent = doc?.file.name ?? "";
}

window.addEventListener("beforeunload", (e) => {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = "";
});

// Drag and drop anywhere on the window.
let dragDepth = 0;
const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  ui.dropOverlay.hidden = false;
});
window.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) ui.dropOverlay.hidden = true;
});
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  ui.dropOverlay.hidden = true;
  const item = e.dataTransfer?.items?.[0] as (DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileHandle | null> }) | undefined;
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  const handlePromise = item?.getAsFileSystemHandle?.().catch(() => null) ?? Promise.resolve(null);
  void handlePromise.then(async (h) => {
    if (!(await confirmDiscard(`open ${file.name}`))) return;
    stopWatch(false);
    await readFile(file, h && h.kind === "file" ? h : undefined);
  });
});

// ---------------------------------------------------------------------------------------------
// Watch mode (Edge/Chrome)
// ---------------------------------------------------------------------------------------------

async function watchFile(): Promise<void> {
  if (!canPickOpen) return;
  if (!(await confirmDiscard("watch another file"))) return;
  const picked = await pickOpen();
  if (!picked || picked === "fallback") {
    if (picked === "fallback") toast("Watching files is not available in this browser", "error");
    return;
  }
  stopWatch(false);
  const handle = picked;
  const watcher = new Watcher({
    getFile: () => handle.getFile(),
    onChange(text) {
      const clean = stripBom(text);
      if (!watching) return;
      if (watching.first) {
        watching.first = false;
        setDoc(openedFileState(handle.name, clean, true), clean, handle, clean);
        editor.setReadOnly(true);
        return;
      }
      if (!doc || !shouldApplyText(editor.getText(), clean)) return;
      doc.file = markSaved(doc.file, clean);
      editor.setText(clean, false);
      runCompile(false);
    },
    onStop(reason) {
      stopWatch(true);
      toast(`Stopped watching ${handle.name}: ${reason}`, "error");
    },
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id as number),
  });
  watching = { watcher, name: handle.name, first: true };
  ui.watchName.textContent = handle.name;
  ui.watchBanner.hidden = false;
  ui.body.classList.add("watching");
  await watcher.start();
}

function stopWatch(keepDoc: boolean): void {
  if (!watching) return;
  watching.watcher.stop();
  watching = undefined;
  ui.watchBanner.hidden = true;
  ui.body.classList.remove("watching");
  editor.setReadOnly(false);
  if (keepDoc) updateDirty();
}

el("watch-stop").addEventListener("click", () => {
  const name = watching?.name;
  stopWatch(true);
  if (name) toast(`Stopped watching ${name}: the editor is editable again`);
  editor.focus();
});

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

function download(fileName: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function exportReason(): string | undefined {
  if (!doc) return "Start a new chart or open a .qsfc file first";
  if (!exportable) {
    const { errors } = countProblems(diagnostics);
    return errors ? `Fix the ${plural(errors, "error")} in the Problems panel before exporting` : "The chart can't be exported yet";
  }
  return undefined;
}

function flushCompile(): void {
  if (compileTimer !== undefined) runCompile(false);
}

function exportL5XCmd(): void {
  flushCompile();
  const reason = exportReason();
  if (reason || !doc) {
    toast(reason ?? "Nothing to export", "error");
    return;
  }
  const { text } = exportL5X(editor.getText(), { fileName: doc.file.name });
  if (text === undefined) {
    toast("The chart could not be exported", "error");
    return;
  }
  const out = l5xFileName(doc.file.name);
  download(out, text, "application/xml");
  toast(`Exported ${out}`);
}

/** Why the active routine's diagram can't be exported as SVG, or undefined. */
function svgReason(): string | undefined {
  if (!doc) return "Open a .qsfc file first";
  const active = activeRoutine();
  if (active?.kind === "st") return `${active.name} is an ST routine: it has no diagram. Open an SFC routine's tab to export its diagram`;
  if (!active?.graph) return "Fix the errors first: there is no diagram to export";
  return undefined;
}

function exportSvgCmd(): void {
  flushCompile();
  const reason = svgReason();
  const active = activeRoutine();
  const d = active && diagramOf(active);
  if (reason || !doc || !d) {
    toast(reason ?? "Nothing to export", "error");
    return;
  }
  // Several routines: one SVG per routine, named after it.
  const out = (result?.routines.length ?? 0) > 1 ? `${d.name}.svg` : svgFileName(doc.file.name);
  download(out, svgOf(d), "image/svg+xml");
  toast(`Exported ${out}`);
}

function diagramOf(r: CompiledRoutine): Diagram | undefined {
  return r.graph && r.layout ? { graph: r.graph, layout: r.layout, name: r.name } : undefined;
}

function svgOf(d: Diagram): string {
  return renderSvg(d.graph, d.layout, {
    look: "textbook",
    numbering: view.numbers ? "numbers" : "names",
    showActions: view.showActions,
  });
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

function renderAll(): void {
  ui.welcome.hidden = !!doc;
  ui.body.classList.toggle("no-doc", !doc);
  renderHeader();
  renderTags();
  renderProblems();
  renderStatus();
}

function renderHeader(): void {
  ui.fileInfo.hidden = !doc;
  const reason = exportReason();
  for (const b of document.querySelectorAll<HTMLElement>('[data-cmd="export-l5x"]')) {
    b.setAttribute("aria-disabled", String(!!reason));
    b.title = reason ?? (doc ? `Download ${l5xFileName(doc.file.name)} for Studio 5000` : "");
  }
  const svgItem = document.querySelector<HTMLElement>('[data-cmd="export-svg"]')!;
  const noSvg = svgReason();
  svgItem.setAttribute("aria-disabled", String(!!noSvg));
  svgItem.title = noSvg ?? "";
  for (const cmd of ["save", "save-as"]) {
    document.querySelector<HTMLElement>(`[data-cmd="${cmd}"]`)!.setAttribute("aria-disabled", String(!doc));
  }
  if (!doc || !result) return;
  const { errors, warnings } = countProblems(diagnostics);
  ui.fileName.textContent = doc.file.name;
  ui.fileRoutine.textContent =
    result.routines.length > 1
      ? `program ${programName(result.program, result.routines)}`
      : `routine ${result.routines[0]?.name ?? routineName(result.chart, doc.file.name)}`;
  ui.fileDot.className = `dot ${errors ? "err" : warnings ? "warn" : "ok"}`;
  ui.fileInfo.title = errors ? plural(errors, "error") : warnings ? plural(warnings, "warning") : "No problems";
}

function viewKey(): string {
  return `${view.numbers}|${view.showActions}`;
}

/** Index of the routine the cursor is in (-1: none). */
function activeIndex(): number {
  return doc && result ? routineAtLine(result.routines, cursor.line) : -1;
}

function activeRoutine(): CompiledRoutine | undefined {
  const i = activeIndex();
  return i >= 0 ? result?.routines[i] : undefined;
}

/** What the diagram pane shows for the active routine. */
function activeView(): { index: number; active?: CompiledRoutine; shown?: Diagram; stale: boolean } {
  const index = activeIndex();
  const active = index >= 0 ? result?.routines[index] : undefined;
  if (!doc) return { index, stale: false };
  if (active?.kind === "st") return { index, active, stale: false };
  const now = active && diagramOf(active);
  if (now) return { index, active, shown: now, stale: false };
  // Errors (or an empty text): the routine's last valid diagram, dimmed.
  const old = active ? (lastGood.get(key(active.name)) ?? lastGoodByIndex[index]) : lastGoodByIndex[0];
  const out: { index: number; active?: CompiledRoutine; shown?: Diagram; stale: boolean } = { index, stale: !!old };
  if (active) out.active = active;
  if (old) out.shown = old;
  return out;
}

/** Routine position shown in the diagram pane now (to notice when the cursor leaves it). */
let shownIndex = -1;
/** Signature of the routine tabs in the DOM (rebuilt only when routines change). */
let tabsKey = "";

function renderTabs(routines: readonly CompiledRoutine[], index: number): void {
  const show = !!doc && routines.length > 1;
  ui.routineTabs.hidden = !show;
  if (!show) {
    if (tabsKey) ui.routineTabs.replaceChildren();
    tabsKey = "";
    return;
  }
  const sig = routines.map((r) => `${r.kind}:${r.name}`).join("|");
  if (sig !== tabsKey) {
    tabsKey = sig;
    const tabs = routines.map((r, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "routine-tab";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-controls", "diagram-area");
      b.id = `routine-tab-${i}`;
      b.dataset["index"] = String(i);
      b.append(kindBadge(r.kind), cell("span", r.name, "tab-name"));
      if (i === 0) {
        const main = cell("span", "main", "main-pill");
        main.title = "Main routine: Studio runs it every scan";
        b.append(main);
      }
      b.title = `${r.kind.toUpperCase()} routine ${r.name}${i === 0 ? " (main routine)" : ""}: lines ${r.lines.from}-${r.lines.to}`;
      b.addEventListener("click", () => openRoutine(i, true));
      return b;
    });
    ui.routineTabs.replaceChildren(...tabs);
  }
  for (const b of ui.routineTabs.querySelectorAll<HTMLElement>('[role="tab"]')) {
    const on = Number(b.dataset["index"]) === index;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
    b.classList.toggle("on", on);
    if (on && index !== shownIndex) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function kindBadge(kind: "sfc" | "st"): HTMLElement {
  const k = cell("span", kind.toUpperCase(), `kind kind-${kind}`);
  k.setAttribute("aria-label", kind === "sfc" ? "SFC" : "ST");
  return k;
}

/** Shows routine `i`: moves the editor cursor to its first line (the diagram follows). */
function openRoutine(i: number, focusEditor: boolean): void {
  const r = result?.routines[i];
  if (!r) return;
  editor.goTo(r.lines.from, 1, focusEditor);
}

function openRoutineNamed(name: string): void {
  const r = result && findRoutine(result.routines, name);
  if (r) openRoutine(result!.routines.indexOf(r), true);
}

ui.routineTabs.addEventListener("keydown", (e) => {
  const tabs = [...ui.routineTabs.querySelectorAll<HTMLElement>('[role="tab"]')];
  const i = tabs.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  let to: number;
  if (e.key === "ArrowRight") to = (i + 1) % tabs.length;
  else if (e.key === "ArrowLeft") to = (i - 1 + tabs.length) % tabs.length;
  else if (e.key === "Home") to = 0;
  else if (e.key === "End") to = tabs.length - 1;
  else return;
  e.preventDefault();
  openRoutine(to, false);
  tabs[to]!.focus();
});

/** The ST of an ST routine is shown on its card; clicking the code (or its title) hides it. */
let stCodeOpen = true;

function stCodeSection(r: CompiledRoutine): HTMLElement[] {
  const body = r.node.kind === "st" ? r.node.body : [];
  const head = document.createElement("button");
  head.type = "button";
  head.className = "st-code-toggle";
  head.setAttribute("aria-expanded", String(stCodeOpen));
  head.append(cell("span", "ST code"), cell("span", "", "chev"));
  head.title = stCodeOpen ? "Hide the ST" : "Show the ST";
  const toggle = (): void => {
    stCodeOpen = !stCodeOpen;
    renderDiagram(false);
  };
  head.addEventListener("click", toggle);
  if (!stCodeOpen) {
    const more = cell("button", `${body.length} line${body.length === 1 ? "" : "s"} hidden: click to show`, "st-code-more") as HTMLButtonElement;
    more.type = "button";
    more.addEventListener("click", toggle);
    return [head, more];
  }
  const pre = document.createElement("pre");
  pre.className = "st-code";
  pre.title = "Click to hide the ST";
  if (body.length === 0) pre.append(cell("span", "(empty)", "st-comment"));
  body.forEach((l, i) => {
    if (i > 0) pre.append("\n");
    pre.append(cell("span", String(l.span.line), "st-ln"));
    const text = l.text;
    const c = text.indexOf("//");
    if (c >= 0 && !/'[^']*\/\/[^']*'/.test(text)) {
      pre.append(text.slice(0, c), cell("span", text.slice(c), "st-comment"));
    } else pre.append(text);
  });
  pre.addEventListener("click", toggle);
  return [head, pre];
}

/** The card shown instead of a diagram for an ST routine. */
function renderStCard(r: CompiledRoutine, index: number): void {
  const routines = result?.routines ?? [];
  const isMain = index === 0;
  const card = document.createElement("div");
  card.className = "st-card";
  const title = document.createElement("h2");
  title.className = "st-title";
  title.append(kindBadge("st"), cell("b", r.name));
  if (isMain) title.append(cell("span", "main routine", "badge"));
  card.append(title, cell("p", stLinesText(r, isMain), "muted"));

  const chips = (names: readonly string[]): HTMLElement => {
    const box = document.createElement("div");
    box.className = "chips";
    for (const n of names) {
      const target = findRoutine(routines, n);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      if (target) b.append(kindBadge(target.kind));
      b.append(cell("span", target?.name ?? n));
      b.title = target ? `Open ${target.name} (line ${target.lines.from})` : `There is no routine ${n}`;
      b.disabled = !target;
      b.addEventListener("click", () => openRoutineNamed(n));
      box.append(b);
    }
    return box;
  };
  card.append(...stCodeSection(r));
  card.append(cell("h3", "Calls"));
  card.append(r.calls.length ? chips(r.calls) : cell("p", "nothing", "muted"));
  card.append(cell("h3", "Called by"));
  card.append(r.calledBy.length ? chips(r.calledBy) : cell("p", notCalledText(isMain), "muted"));

  card.append(cell("h3", "Call tree"));
  const tree = document.createElement("pre");
  tree.className = "tree";
  treeLines(callTree(routines, result?.calls ?? [])).forEach((l, i) => {
    if (i > 0) tree.append("\n");
    tree.append(l.lead);
    const target = findRoutine(routines, l.name);
    if (target) {
      const b = cell("button", l.name, `tree-name${key(target.name) === key(r.name) ? " current" : ""}`) as HTMLButtonElement;
      b.type = "button";
      b.title = `Open ${target.name}`;
      b.addEventListener("click", () => openRoutineNamed(l.name));
      tree.append(b);
    } else tree.append(l.name);
    tree.append(l.tail);
  });
  card.append(tree);
  ui.stView.replaceChildren(card);
}

function renderDiagram(fit: boolean): void {
  const v = activeView();
  const { shown, stale } = v;
  const st = v.active?.kind === "st";
  renderTabs(result?.routines ?? [], v.index);
  shownIndex = v.index;
  // Position of the routine in the pane (an empty text keeps the first routine's last diagram).
  const pos = Math.max(0, v.index);
  ui.stView.hidden = !doc || !st;
  ui.canvas.hidden = !doc || !shown;
  ui.broken.hidden = !doc || !!shown || st;
  ui.staleBadge.hidden = !stale;
  ui.canvas.classList.toggle("stale", stale);
  for (const id of ["zoom-out", "zoom-reset", "zoom-in", "zoom-fit"]) el<HTMLButtonElement>(id).disabled = !shown;
  if (!doc) return;
  if (st) renderStCard(v.active!, v.index);
  else ui.stView.replaceChildren();
  if (!shown) {
    ui.stage.replaceChildren();
    drawn = undefined;
    drawnSvg = "";
    const empty = editor.view.state.doc.length === 0 || editor.getText().trim() === "";
    const { errors } = countProblems(diagnostics);
    ui.brokenTitle.textContent = empty ? "Type a chart in the editor" : "Fix the errors below to see the diagram";
    ui.brokenDetail.textContent = empty
      ? "For example: init idle, then -- start_btn, then step run. The diagram appears as soon as the chart is valid."
      : `${doc.file.name} has ${plural(errors, "error")}. The diagram is drawn as soon as the chart is valid.`;
    ui.broken.classList.toggle("is-empty", empty);
    return;
  }
  const vk = viewKey();
  if (!drawn || drawn.diagram.graph !== shown.graph || drawn.key !== vk || drawn.index !== pos) {
    // A new routine in the pane (tab switch) is fitted like a newly opened chart.
    const first = !drawn || drawn.index !== pos;
    const svgText = svgOf(shown);
    const same = !first && svgText === drawnSvg;
    drawn = { diagram: shown, index: pos, key: vk };
    if (same) {
      applySelectionHighlight(false);
      highlightCursorElement(false);
      return;
    }
    drawnSvg = svgText;
    ui.stage.innerHTML = svgText;
    const svg = ui.stage.querySelector("svg")!;
    svg.setAttribute("aria-label", `SFC diagram of ${shown.name}`);
    svgSize = { width: Number(svg.getAttribute("width")) || 1, height: Number(svg.getAttribute("height")) || 1 };
    if (fit || first) requestAnimationFrame(() => fitToWindow());
    else setZoom(zoom);
  }
  applySelectionHighlight(false);
  highlightCursorElement(false);
}

function renderTags(): void {
  const tags = result?.tags ?? [];
  ui.tagCount.textContent = String(tags.length);
  ui.tagTable.hidden = tags.length === 0;
  ui.tagsEmpty.hidden = tags.length > 0;
  ui.tagsEmpty.textContent = doc ? "This chart uses no tags yet." : "Open a chart to see its tags.";
  for (const th of ui.tagTable.querySelectorAll("th")) {
    const key = th.querySelector<HTMLElement>("button")?.dataset["sort"];
    if (key === tagSort.key) th.setAttribute("aria-sort", tagSort.dir === "asc" ? "ascending" : "descending");
    else th.removeAttribute("aria-sort");
  }
  const rows = sortTags(tags, tagSort).map((t) => {
    const tr = document.createElement("tr");
    tr.dataset["tag"] = t.name.toLowerCase();
    const name = cell("td", t.name, "mono name");
    if (!t.declared) name.title = "Not declared: type inferred from its uses";
    const type = document.createElement("td");
    type.append(cell("span", t.type, `type type-${t.type.toLowerCase()}`));
    const uses = cell("td", String(t.uses.length), "num");
    uses.title = usesTitle(t);
    const desc = cell("td", t.description ?? "", "desc");
    tr.append(name, type, uses, desc);
    const first = t.uses[0];
    if (first) {
      tr.classList.add("link");
      tr.title = `${usesTitle(t)}. Click to go to the first use.`;
      tr.addEventListener("click", () => editor.goTo(first.line, first.col, true));
    }
    return tr;
  });
  ui.tagBody.replaceChildren(...rows);
}

function cell(tag: string, text: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  return e;
}

function renderProblems(): void {
  const diags = orderProblems(diagnostics);
  ui.problemCount.textContent = String(diags.length);
  const { errors } = countProblems(diags);
  ui.problemCount.className = `count${errors ? " err" : diags.length ? " warn" : ""}`;
  if (diags.length === 0) {
    const li = cell("li", doc ? "No problems in this chart." : "No chart open.", "problem-empty");
    ui.problemList.replaceChildren(li);
    return;
  }
  const items = diags.map((d) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = `problem ${d.severity}`;
    const k = problemKey(d);
    b.dataset["key"] = k;
    b.setAttribute("aria-pressed", String(k === selectedProblem));
    const sev = cell("span", d.severity === "error" ? "✕" : "!", "sev");
    sev.setAttribute("aria-hidden", "true");
    const label = cell("span", d.severity === "error" ? "Error" : "Warning", "sr-only");
    const code = cell("span", d.code, "code");
    const body = document.createElement("span");
    body.className = "text";
    body.append(cell("span", d.message, "msg"));
    if (d.hint) body.append(cell("span", `hint: ${d.hint}`, "hint"));
    const loc = cell("span", problemLocation(d), "loc");
    loc.title = `Line ${d.span.line}, column ${d.span.col}`;
    b.append(sev, label, code, body, loc);
    b.addEventListener("click", () => {
      selectProblem(k);
      editor.goTo(d.span.line, d.span.col, true);
    });
    li.append(b);
    return li;
  });
  ui.problemList.replaceChildren(...items);
}

function renderStatus(): void {
  if (!doc) {
    ui.statusFile.textContent = "No chart open";
    ui.statusCounts.textContent = "";
    ui.statusProblems.replaceChildren();
    ui.statusCursor.textContent = "";
    return;
  }
  ui.statusFile.textContent = doc.file.name;
  const routines = result?.routines ?? [];
  const multi = routines.length > 1;
  const v = activeView();
  ui.statusRoutines.hidden = !multi;
  ui.statusRoutines.textContent = multi ? routineSummary(routines) : "";
  ui.statusRoutine.hidden = !multi || !v.active;
  ui.statusRoutine.replaceChildren(...(multi && v.active ? [cell("b", v.active.name)] : []));
  ui.statusRoutine.title = v.active ? `Active routine (${v.active.kind.toUpperCase()})` : "";
  const c = chartCounts(v.active?.graph);
  ui.statusCounts.textContent =
    v.active?.kind === "st"
      ? `ST routine · ${plural(v.active.node.kind === "st" ? v.active.node.body.length : 0, "line")}`
      : c
        ? `${plural(c.steps, "step")} · ${plural(c.transitions, "transition")} · ${plural(c.branches, "branch", "branches")}`
        : v.stale
          ? "Showing last valid diagram"
          : "No diagram";
  const { errors, warnings } = countProblems(diagnostics);
  ui.statusProblems.replaceChildren(
    cell("span", plural(errors, "error"), errors ? "err" : "ok"),
    cell("span", plural(warnings, "warning"), warnings ? "warn" : ""),
  );
  ui.statusCursor.textContent = `Ln ${cursor.line}, Col ${cursor.col}`;
}

// ---------------------------------------------------------------------------------------------
// Problems selection, cursor highlight and diagram clicks
// ---------------------------------------------------------------------------------------------

function setProblemsOpen(open: boolean): void {
  ui.problems.classList.toggle("collapsed", !open);
  ui.problemsToggle.setAttribute("aria-expanded", String(open));
  ui.problemList.hidden = !open;
  ui.splitProblems.hidden = !open;
}

ui.problemsToggle.addEventListener("click", () => setView({ problemsOpen: !view.problemsOpen }));

function selectProblem(k: string | undefined): void {
  selectedProblem = k;
  for (const b of ui.problemList.querySelectorAll<HTMLElement>("button.problem")) {
    b.setAttribute("aria-pressed", String(b.dataset["key"] === k));
  }
  applySelectionHighlight(true);
}

function stageElement(id: string): Element | null {
  return ui.stage.querySelector(`[data-id="${CSS.escape(id)}"]`);
}

function applySelectionHighlight(scroll: boolean): void {
  for (const e of ui.stage.querySelectorAll(".qsfc-hl")) e.classList.remove("qsfc-hl");
  for (const e of ui.tagBody.querySelectorAll(".hl")) e.classList.remove("hl");
  if (!doc || !selectedProblem || !result) return;
  const d = diagnostics.find((x) => problemKey(x) === selectedProblem);
  if (!d) return;
  const id = problemTarget(d, drawn?.diagram.graph);
  if (id) {
    const target = stageElement(id);
    if (target) {
      target.classList.add("qsfc-hl");
      if (scroll) scrollIntoCanvas(target);
    }
  }
  const decls = new Map(result.chart.tagDecls.map((t) => [t.name.text, t.span.line] as const));
  const tag = problemTag(d, result.tags, decls);
  if (tag) {
    const row = ui.tagBody.querySelector(`tr[data-tag="${CSS.escape(tag.toLowerCase())}"]`);
    if (row) {
      row.classList.add("hl");
      if (scroll) row.scrollIntoView({ block: "nearest" });
    }
  }
}

let cursorElement: string | undefined;
/** Highlights the diagram element written on the cursor line. */
function highlightCursorElement(scroll: boolean): void {
  const id = doc ? elementAtLine(drawn?.diagram.graph, cursor.line) : undefined;
  const changed = id !== cursorElement;
  cursorElement = id;
  for (const e of ui.stage.querySelectorAll(".qsfc-cur")) {
    if (e.getAttribute("data-id") !== id) e.classList.remove("qsfc-cur");
  }
  if (!id) return;
  const target = stageElement(id);
  if (!target) return;
  target.classList.add("qsfc-cur");
  if (scroll && changed) scrollIntoCanvas(target);
}

/** Centers an SVG element in the canvas when it is not fully visible. */
function scrollIntoCanvas(target: Element): void {
  if (ui.canvas.hidden) return;
  const r = target.getBoundingClientRect();
  const c = ui.canvas.getBoundingClientRect();
  const visible = r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom;
  if (visible) return;
  ui.canvas.scrollBy({
    left: r.left + r.width / 2 - (c.left + c.width / 2),
    top: r.top + r.height / 2 - (c.top + c.height / 2),
    behavior: "smooth",
  });
}

/** A click (not a drag) on the diagram: put the cursor on the element's line. */
function diagramClick(target: EventTarget | null): void {
  const graph = drawn?.diagram.graph;
  if (!graph) return;
  const ids: string[] = [];
  for (let n = target as Element | null; n && n !== ui.stage; n = n.parentElement) {
    const id = n.getAttribute?.("data-id");
    if (id) ids.push(id);
  }
  const id = pickElement(ids, graph);
  if (!id) return;
  const at = sourceOfElement(graph, id);
  if (at) editor.goTo(at.line, at.col, true);
}

// ---------------------------------------------------------------------------------------------
// Zoom and pan
// ---------------------------------------------------------------------------------------------

/** Sets the zoom, keeping the diagram point under (clientX, clientY) in place. */
function setZoom(z: number, anchor?: { x: number; y: number }): void {
  const next = clampZoom(z);
  const svg = ui.stage.querySelector("svg");
  ui.zoomReset.textContent = formatZoom(next);
  ui.zoomReset.setAttribute("aria-label", `Zoom ${formatZoom(next)}, reset to 100 %`);
  if (!svg) {
    zoom = next;
    return;
  }
  const c = ui.canvas.getBoundingClientRect();
  const a = anchor ?? { x: c.left + c.width / 2, y: c.top + c.height / 2 };
  const before = svg.getBoundingClientRect();
  const px = (a.x - before.left) / zoom;
  const py = (a.y - before.top) / zoom;
  zoom = next;
  svg.setAttribute("width", String(Math.round(svgSize.width * zoom)));
  svg.setAttribute("height", String(Math.round(svgSize.height * zoom)));
  const after = svg.getBoundingClientRect();
  ui.canvas.scrollLeft += after.left + px * zoom - a.x;
  ui.canvas.scrollTop += after.top + py * zoom - a.y;
}

function fitToWindow(): void {
  if (!ui.stage.querySelector("svg")) return;
  const c = ui.canvas.getBoundingClientRect();
  if (c.width === 0 || c.height === 0) return;
  setZoom(fitZoom(svgSize, { width: c.width, height: c.height }, 24));
  ui.canvas.scrollTo({ left: 0, top: 0 });
}

el("zoom-in").addEventListener("click", () => setZoom(zoomIn(zoom)));
el("zoom-out").addEventListener("click", () => setZoom(zoomOut(zoom)));
ui.zoomReset.addEventListener("click", () => setZoom(1));
el("zoom-fit").addEventListener("click", fitToWindow);

ui.canvas.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls (native)
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    setZoom(wheelZoom(zoom, delta), { x: e.clientX, y: e.clientY });
  },
  { passive: false },
);

let drag: { x: number; y: number; left: number; top: number; id: number; target: EventTarget | null; moved: boolean } | undefined;
ui.canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, left: ui.canvas.scrollLeft, top: ui.canvas.scrollTop, id: e.pointerId, target: e.target, moved: false };
  if (e.pointerType !== "touch") ui.canvas.setPointerCapture(e.pointerId); // touch pans natively
});
ui.canvas.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
  drag.moved = true;
  if (e.pointerType === "touch") return;
  ui.canvas.classList.add("dragging");
  ui.canvas.scrollLeft = drag.left - (e.clientX - drag.x);
  ui.canvas.scrollTop = drag.top - (e.clientY - drag.y);
});
ui.canvas.addEventListener("pointerup", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = undefined;
  ui.canvas.classList.remove("dragging");
  if (!d.moved) diagramClick(d.target);
});
ui.canvas.addEventListener("pointercancel", () => {
  drag = undefined;
  ui.canvas.classList.remove("dragging");
});

ui.canvas.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "+" || e.key === "=") setZoom(zoomIn(zoom));
  else if (e.key === "-" || e.key === "_") setZoom(zoomOut(zoom));
  else if (e.key === "0") fitToWindow();
  else return;
  e.preventDefault();
});

// ---------------------------------------------------------------------------------------------
// Pane layout: splitters and the Tags toggle
// ---------------------------------------------------------------------------------------------

const SPLITTER = 6;
const narrow = (): boolean => window.innerWidth < NARROW;

function applyLayout(save = true): void {
  ui.body.style.setProperty("--cols", gridColumns(layout, SPLITTER));
  ui.problemList.style.setProperty("--problems-h", `${Math.round(layout.problemsHeight)}px`);
  ui.tagsPane.hidden = !layout.tagsOpen;
  ui.splitTags.hidden = !layout.tagsOpen;
  ui.tagsToggle.setAttribute("aria-pressed", String(layout.tagsOpen));
  ui.splitEditor.setAttribute("aria-valuenow", String(Math.round(layout.editorFrac * 100)));
  if (save) saveLayout(storage, layout);
}

/** Width shared by the editor and the diagram. */
function sharedWidth(): number {
  const tags = layout.tagsOpen ? layout.tagsWidth + SPLITTER : 0;
  return ui.body.clientWidth - SPLITTER - tags;
}

function moveSplitter(which: HTMLElement, startValue: number, delta: number): void {
  if (which === ui.splitEditor) {
    layout.editorFrac = dragFraction(startValue, delta, sharedWidth());
  } else if (which === ui.splitTags) {
    layout.tagsWidth = dragTags(startValue, delta, ui.body.clientWidth - 2 * MIN_PANE - 2 * SPLITTER);
  } else {
    layout.problemsHeight = dragProblems(startValue, delta, Math.max(120, window.innerHeight * 0.6));
  }
  applyLayout(false);
}

function splitterValue(which: HTMLElement): number {
  if (which === ui.splitEditor) return layout.editorFrac;
  if (which === ui.splitTags) return layout.tagsWidth;
  return layout.problemsHeight;
}

for (const sp of [ui.splitEditor, ui.splitTags, ui.splitProblems]) {
  const vertical = sp !== ui.splitProblems;
  sp.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, value: splitterValue(sp) };
    sp.setPointerCapture(e.pointerId);
    sp.classList.add("active");
    document.body.classList.add(vertical ? "resizing-x" : "resizing-y");
    const move = (ev: PointerEvent): void => moveSplitter(sp, start.value, vertical ? ev.clientX - start.x : ev.clientY - start.y);
    const up = (): void => {
      sp.removeEventListener("pointermove", move);
      sp.removeEventListener("pointerup", up);
      sp.removeEventListener("pointercancel", up);
      sp.classList.remove("active");
      document.body.classList.remove("resizing-x", "resizing-y");
      saveLayout(storage, layout);
    };
    sp.addEventListener("pointermove", move);
    sp.addEventListener("pointerup", up);
    sp.addEventListener("pointercancel", up);
  });
  sp.addEventListener("keydown", (e) => {
    const d = keyDelta(e.key, e.shiftKey, vertical ? "vertical" : "horizontal");
    if (!d) return;
    e.preventDefault();
    moveSplitter(sp, splitterValue(sp), d);
    saveLayout(storage, layout);
  });
  sp.addEventListener("dblclick", () => {
    if (sp === ui.splitEditor) layout.editorFrac = 0.42;
    else if (sp === ui.splitTags) layout.tagsWidth = 320;
    else layout.problemsHeight = 160;
    applyLayout();
  });
}

ui.tagsToggle.addEventListener("click", () => {
  layout.tagsOpen = !layout.tagsOpen;
  applyLayout();
});

let resizeFrame: number | undefined;
window.addEventListener("resize", () => {
  if (resizeFrame !== undefined) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined;
    document.documentElement.classList.toggle("narrow", narrow());
  });
});

// ---------------------------------------------------------------------------------------------
// Tags sorting
// ---------------------------------------------------------------------------------------------

for (const b of ui.tagTable.querySelectorAll<HTMLButtonElement>("button.sort")) {
  b.addEventListener("click", () => {
    tagSort = nextTagSort(tagSort, b.dataset["sort"] as TagSortKey);
    renderTags();
    applySelectionHighlight(false);
  });
}

// ---------------------------------------------------------------------------------------------
// Menus (menu button pattern: mouse and keyboard, Escape closes)
// ---------------------------------------------------------------------------------------------

interface Menu {
  button: HTMLButtonElement;
  list: HTMLElement;
}

const menus: Menu[] = [
  { button: el<HTMLButtonElement>("file-btn"), list: el("file-menu") },
  { button: el<HTMLButtonElement>("view-btn"), list: el("view-menu") },
  { button: el<HTMLButtonElement>("help-btn"), list: el("help-menu") },
];
let openMenu: Menu | undefined;

const itemsOf = (m: Menu): HTMLElement[] => [...m.list.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter((i) => !i.hidden);

function showMenu(m: Menu, focus: "first" | "last" | "none" = "first"): void {
  if (openMenu && openMenu !== m) hideMenu(false);
  openMenu = m;
  m.list.hidden = false;
  m.button.setAttribute("aria-expanded", "true");
  m.button.classList.add("open");
  const items = itemsOf(m);
  if (focus !== "none") (focus === "first" ? items[0] : items[items.length - 1])?.focus();
}

function hideMenu(restoreFocus: boolean): void {
  const m = openMenu;
  if (!m) return;
  openMenu = undefined;
  m.list.hidden = true;
  m.button.setAttribute("aria-expanded", "false");
  m.button.classList.remove("open");
  if (restoreFocus) m.button.focus();
}

for (const m of menus) {
  m.button.addEventListener("click", () => {
    if (openMenu === m) hideMenu(false);
    else showMenu(m, "first");
  });
  m.button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      showMenu(m, "first");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      showMenu(m, "last");
    }
  });
  m.button.addEventListener("pointerenter", () => {
    // Menu bar behavior: once one menu is open, hovering another switches to it.
    if (openMenu && openMenu !== m) showMenu(m, "none");
  });
  m.list.addEventListener("keydown", (e) => {
    const items = itemsOf(m);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number): void => items[(to + items.length) % items.length]?.focus();
    switch (e.key) {
      case "ArrowDown":
        move(i + 1);
        break;
      case "ArrowUp":
        move(i - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(items.length - 1);
        break;
      case "ArrowRight":
      case "ArrowLeft": {
        const j = menus.indexOf(m) + (e.key === "ArrowRight" ? 1 : -1);
        const next = menus[(j + menus.length) % menus.length]!;
        showMenu(next, "first");
        break;
      }
      case "Escape":
        hideMenu(true);
        break;
      case "Tab":
        hideMenu(false);
        return; // let focus move on
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  });
  // Every item, including those hidden for now (Watch / Reload depend on the browser).
  for (const item of m.list.querySelectorAll<HTMLElement>('[role^="menuitem"]')) {
    item.addEventListener("pointerenter", () => item.focus({ preventScroll: true }));
    item.addEventListener("click", () => {
      hideMenu(false);
      runCommand(item);
    });
  }
}

document.addEventListener("pointerdown", (e) => {
  if (!openMenu) return;
  const t = e.target as Node;
  if (!openMenu.list.contains(t) && !openMenu.button.contains(t)) hideMenu(false);
});

function runCommand(item: HTMLElement): void {
  const cmd = item.dataset["cmd"];
  if (item.getAttribute("aria-disabled") === "true") {
    toast(item.title || "Not available now", "error");
    return;
  }
  switch (cmd) {
    case "new":
      void newChart("");
      break;
    case "open":
      void openFile();
      break;
    case "save":
      void save(false);
      break;
    case "save-as":
      void save(true);
      break;
    case "watch":
      void watchFile();
      break;
    case "reload":
      void reloadFromDisk();
      break;
    case "export-l5x":
      exportL5XCmd();
      break;
    case "export-svg":
      exportSvgCmd();
      break;
    case "cheatsheet":
      openCheatSheet();
      break;
    case "about":
      showAbout();
      break;
    case "numbers":
      setView({ numbers: !view.numbers });
      break;
    case "actions":
      setView({ showActions: !view.showActions });
      break;
    case "theme":
      setView({ theme: (item.dataset["value"] as Theme | undefined) ?? "system" });
      break;
  }
}

ui.exportBtn.addEventListener("click", () => runCommand(ui.exportBtn));
el("welcome-open").addEventListener("click", () => void openFile());
el("welcome-new").addEventListener("click", () => void newChart(STARTER));

// ---------------------------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------------------------

const CHEATSHEET_NAME = "qsfc-cheatsheet.html";
let cheatsheetUrl: string | undefined;

/**
 * Opens the cheat sheet in a new tab (to put beside the app in split screen). It is a
 * Blob URL of the inlined page, so it works offline; kept alive so the tab can be reloaded.
 * If a popup blocker stops the tab, the page is downloaded instead.
 */
function openCheatSheet(): void {
  cheatsheetUrl ??= URL.createObjectURL(new Blob([QSFC_CHEATSHEET], { type: "text/html" }));
  let tab: Window | null = null;
  try {
    tab = window.open(cheatsheetUrl, "_blank");
  } catch {
    tab = null;
  }
  if (!tab) {
    download(CHEATSHEET_NAME, QSFC_CHEATSHEET, "text/html");
    toast(`The new tab was blocked: downloaded ${CHEATSHEET_NAME} instead`);
  }
}

function showAbout(): void {
  const about = el<HTMLDialogElement>("about");
  el("about-version").textContent = QSFC_VERSION;
  about.showModal();
}

// Global shortcuts (capture phase, so they also work while the editor has focus).
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "F1" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      hideMenu(false);
      openCheatSheet();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    let run: (() => void) | undefined;
    if (e.altKey && !e.shiftKey && (k === "n" || e.code === "KeyN")) run = () => void newChart("");
    else if (!e.altKey && !e.shiftKey && k === "o") run = () => void openFile();
    else if (!e.altKey && k === "s") run = () => void save(e.shiftKey);
    else if (!e.altKey && !e.shiftKey && k === "e") run = () => runCommand(ui.exportBtn);
    if (!run) return;
    if (!run) return;
    e.preventDefault();
    e.stopPropagation();
    hideMenu(false);
    run();
  },
  true,
);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (openMenu) hideMenu(true);
  else if (selectedProblem && !ui.editorHost.contains(e.target as Node)) selectProblem(undefined);
});

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------

ui.watchItem.hidden = !canPickOpen;
ui.reloadItem.hidden = canPickOpen;
document.documentElement.classList.toggle("narrow", narrow());
applyTheme(view.theme);
syncViewMenu();
setProblemsOpen(view.problemsOpen);
applyLayout(false);
renderAll();
renderDiagram(false);
