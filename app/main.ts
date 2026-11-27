/**
 * QuickSFC window (Phase 3: live coding). Editor | diagram | Tags, Problems at the bottom.
 * The chart is recompiled ~150 ms after typing stops; on errors the last valid diagram
 * stays, dimmed. Plain DOM plus CodeMirror (app/editor.ts). The markup lives in
 * app/index.html; the pure logic in app/{state,problems,format,highlight,complete,nav,
 * dirty,splitter,watch,tidy,taguse,overview,search,snippets,print}.ts.
 */
import { compile, exportL5X, routineName, type CompiledRoutine, type CompileResult } from "../src/compile.js";
import type { Layout } from "../src/layout/index.js";
import { allSteps, key, sfcCharts } from "../src/model/ast.js";
import type { Diagnostic } from "../src/model/diagnostics.js";
import type { Graph } from "../src/model/graph.js";
import { renderStudioSketch } from "../src/render/sketch.js";
import { renderSvg } from "../src/render/svg.js";
import { tidyL5X, type TidyReport } from "../src/tidy/index.js";
import type { TagInfo } from "../src/model/graph.js";
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
import { clampScroll, dragScroll, overviewGeometry, overviewMax, scrollToPoint } from "./overview.js";
import { buildPrintModel, DEFAULT_PRINT, printHtml, type PrintOptions } from "./print.js";
import { cycleIndex, matchLabel, searchDiagram, type DiagramMatch } from "./search.js";
import { findSnippet, SNIPPETS, snippetContext, snippetTemplate, usedNames } from "./snippets.js";
import { nextUse, routinesUsing, splitOnName, tagElements, useIndex } from "./taguse.js";
import { canTick, decodeL5X, defaultTicked, looksLikeL5X, programsLabel, statusLine, tidiedText, tidyFileName, tidyProblem } from "./tidy.js";
import { importFileName, importProblem, noteItems, notesTitle, previewHtml, routineStatus } from "./importl5x.js";
import { importL5X, type ImportResult } from "../src/import/index.js";
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
  tidyInput: el<HTMLInputElement>("tidy-input"),
  tidy: el<HTMLDialogElement>("tidy"),
  tidyFile: el("tidy-file"),
  tidyBody: el("tidy-body"),
  tidyBefore: el("tidy-before"),
  tidyAfter: el("tidy-after"),
  tidyBeforeSub: el("tidy-before-sub"),
  tidyAfterSub: el("tidy-after-sub"),
  tidyNote: el("tidy-note"),
  tidySave: el<HTMLButtonElement>("tidy-save"),
  importInput: el<HTMLInputElement>("import-input"),
  imp: el<HTMLDialogElement>("imp"),
  impFile: el("imp-file"),
  impProgramWrap: el("imp-program-wrap"),
  impProgram: el<HTMLSelectElement>("imp-program"),
  impBody: el("imp-body"),
  impStudio: el("imp-studio"),
  impStudioSub: el("imp-studio-sub"),
  impCode: el("imp-code"),
  impCodeSub: el("imp-code-sub"),
  impNotesTitle: el("imp-notes-title"),
  impNotes: el("imp-notes"),
  impNote: el("imp-note"),
  impOpen: el<HTMLButtonElement>("imp-open"),
  diagramArea: el("diagram-area"),
  canvasWrap: el("diagram-area").parentElement!,
  overview: el("overview"),
  overviewMap: el("overview-map"),
  overviewFrame: el("overview-frame"),
  search: el("diagram-search"),
  searchInput: el<HTMLInputElement>("search-input"),
  searchCount: el("search-count"),
  printDlg: el<HTMLDialogElement>("print-dlg"),
  printView: el("print-view"),
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
const L5X_TYPES = [{ description: "Studio 5000 L5X", accept: { "application/xml": [".L5X"] } }];

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
/** The tag picked in the Tags sidebar (lower case): its uses light up in the diagram. */
let selectedTag: string | undefined;
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
  /** Tidy dialog: open(file) as a drop would; output() is the text Save would write. */
  tidy: {
    open: (file: File) => openTidy(file),
    get state() {
      return tidyState && { fileName: tidyState.fileName, routines: tidyState.routines, ticked: [...tidyState.ticked], shown: tidyState.shown };
    },
    output: () => tidyState && tidiedText(tidyState.original, [...tidyState.ticked]),
  },
  /** Phase 4d. Import dialog: open(file) as a drop would; accept() as "Open in the editor". */
  importL5X: {
    open: (file: File) => openImport(file),
    get state() {
      return impState && { fileName: impState.fileName, program: impState.result.program, programs: impState.result.programs, shown: impState.shown, source: impState.result.source, notes: impState.result.notes };
    },
    accept: () => acceptImport(),
    program: (name: string) => chooseImportProgram(name),
  },
  /** Phase 4c. The tag picked in the Tags sidebar; selectTag(name) as a click on its row. */
  get selectedTag() {
    return selectedTag;
  },
  selectTag: (name: string | undefined) => setSelectedTag(name),
  /** The print layout as File → Print builds it, without opening the print dialog; clear() removes it. */
  print: {
    build: (o: Partial<PrintOptions> = {}) => buildPrintView({ ...DEFAULT_PRINT, ...o }),
    clear: () => clearPrintView(),
  },
  get search() {
    return { open: !ui.search.hidden, query: ui.searchInput.value, count: search.matches.length, index: search.index };
  },
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
    else if (cmd === "overview") on = view.overview;
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
  // An L5X opens the import dialog (Phase 4d), which can hand it to Tidy instead.
  if (looksLikeL5X(file.name)) {
    void openImport(file);
    return;
  }
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

// ---------------------------------------------------------------------------------------------
// Tidy an L5X (Phase 4a): a Studio export in, the same file with a clean SFC layout out.
// Works with or without a chart open; never touches the editor.
// ---------------------------------------------------------------------------------------------

interface TidyState {
  fileName: string;
  /** The file's text as read, BOM and CRLF included. */
  original: string;
  /** tidyL5X(original).text: every tidiable routine tidied (for the After pane). */
  tidied: string;
  routines: TidyReport[];
  ticked: Set<string>;
  /** Index of the routine shown in the panes. */
  shown: number;
  /** Where the focus goes back when the dialog closes. */
  returnFocus: HTMLElement | null;
}

let tidyState: TidyState | undefined;

async function tidyCmd(): Promise<void> {
  const back = el("file-btn");
  if (canPickOpen) {
    try {
      const [handle] = await fsWindow.showOpenFilePicker!({ types: L5X_TYPES, excludeAcceptAllOption: false, multiple: false });
      if (handle) await openTidy(await handle.getFile(), back);
      return;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return;
      // SecurityError and friends: plain input
    }
  }
  ui.tidyInput.value = "";
  ui.tidyInput.click();
}

ui.tidyInput.addEventListener("change", () => {
  const file = ui.tidyInput.files?.[0];
  if (file) void openTidy(file, el("file-btn"));
});

async function openTidy(file: File, returnFocus: HTMLElement | null = document.activeElement as HTMLElement | null): Promise<void> {
  let original: string;
  try {
    original = decodeL5X(await file.arrayBuffer());
  } catch (e) {
    toast(`Could not read ${file.name}: ${(e as Error).message}`, "error");
    return;
  }
  const result = tidyL5X(original);
  const problem = tidyProblem(file.name, result);
  if (problem) {
    toast(problem, "error");
    return;
  }
  const routines = result.routines;
  const first = routines.findIndex(canTick);
  tidyState = {
    fileName: file.name,
    original,
    tidied: result.text,
    routines,
    ticked: new Set(defaultTicked(routines)),
    shown: first >= 0 ? first : 0,
    returnFocus: tidyState?.returnFocus ?? returnFocus,
  };
  const programs = programsLabel(original);
  ui.tidyFile.textContent = programs ? `${file.name} · ${programs}` : file.name;
  ui.tidyNote.textContent = routines.some(canTick)
    ? "Only positions change. Import the saved file into Studio: right-click the program's task → Import Program, or replace the routine."
    : "Nothing to tidy: every SFC routine is already tidy or is left as it is.";
  renderTidyTable();
  renderTidyPanes();
  if (!ui.tidy.open) ui.tidy.showModal();
  (ui.tidySave.disabled ? el("tidy-cancel") : ui.tidySave).focus();
}

function renderTidyTable(): void {
  const t = tidyState;
  if (!t) return;
  const rows = t.routines.map((r, i) => {
    const tr = document.createElement("tr");
    tr.dataset["i"] = String(i);
    if (i === t.shown) {
      tr.className = "sel";
      tr.setAttribute("aria-current", "true");
    }
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = t.ticked.has(r.name);
    box.disabled = !canTick(r);
    box.setAttribute("aria-label", `Tidy ${r.name}`);
    const show = document.createElement("button");
    show.type = "button";
    show.className = "tidy-show";
    show.title = "Show it before and after";
    const kind = document.createElement("span");
    kind.className = "tidy-kind";
    kind.textContent = "(SFC)";
    show.append(`${r.name} `, kind);
    const st = statusLine(r);
    const tdTick = cell("td", "", "tick");
    tdTick.append(box);
    const tdName = cell("td", "");
    tdName.append(show);
    const extra = r.status === "tidied" ? "links, actions, conditions and tags unchanged" : "";
    tr.append(tdTick, tdName, cell("td", st.text, `st-${st.kind}`), cell("td", extra, "tidy-extra"));
    return tr;
  });
  ui.tidyBody.replaceChildren(...rows);
  const n = t.ticked.size;
  ui.tidySave.disabled = n === 0;
  ui.tidySave.title = n ? `Save ${tidyFileName(t.fileName)} with ${plural(n, "routine")} tidied` : "Tick a routine to tidy first";
}

function renderTidyPanes(): void {
  const t = tidyState;
  const r = t?.routines[t.shown];
  if (!t || !r) return;
  const ticked = t.ticked.has(r.name);
  ui.tidyBefore.innerHTML = renderStudioSketch(t.original, r.name);
  ui.tidyAfter.innerHTML = renderStudioSketch(ticked ? t.tidied : t.original, r.name);
  ui.tidyBeforeSub.textContent = `· ${r.name}`;
  ui.tidyAfterSub.textContent =
    r.status !== "tidied" ? `· ${r.name}, ${statusLine(r).text}` : ticked ? `· ${r.name}` : `· ${r.name}, not ticked: kept as it is`;
  for (const pane of [ui.tidyBefore, ui.tidyAfter]) pane.scrollTo(0, 0);
}

function showTidyRoutine(i: number, focus: "name" | "box"): void {
  const t = tidyState;
  if (!t) return;
  t.shown = i;
  renderTidyTable();
  renderTidyPanes();
  ui.tidyBody.querySelector<HTMLElement>(`tr[data-i="${i}"] ${focus === "box" ? "input" : ".tidy-show"}`)?.focus();
}

ui.tidyBody.addEventListener("click", (e) => {
  const tr = (e.target as Element).closest<HTMLElement>("tr[data-i]");
  if (!tidyState || !tr || (e.target as Element).closest("input")) return; // a checkbox: the change handler
  const i = Number(tr.dataset["i"]);
  if (i !== tidyState.shown) showTidyRoutine(i, "name");
});

ui.tidyBody.addEventListener("change", (e) => {
  const t = tidyState;
  const box = e.target as HTMLInputElement;
  const tr = box.closest<HTMLElement>("tr[data-i]");
  if (!t || !tr) return;
  const i = Number(tr.dataset["i"]);
  const r = t.routines[i]!;
  if (box.checked) t.ticked.add(r.name);
  else t.ticked.delete(r.name);
  showTidyRoutine(i, "box");
});

ui.tidySave.addEventListener("click", () => void saveTidy());

ui.tidy.addEventListener("close", () => {
  if (ui.tidy.open) return; // the close event is queued: reopened (another file) meanwhile
  const back = tidyState?.returnFocus;
  tidyState = undefined;
  ui.tidyBefore.replaceChildren();
  ui.tidyAfter.replaceChildren();
  if (back?.isConnected && back.offsetParent !== null) back.focus();
});

/** Writes the original text with only the ticked routines tidied, as is (BOM, CRLF kept). */
async function saveTidy(): Promise<void> {
  const t = tidyState;
  if (!t || !t.ticked.size) return;
  const text = tidiedText(t.original, [...t.ticked]);
  const name = tidyFileName(t.fileName);
  if (canPickSave()) {
    try {
      const handle = await fsWindow.showSaveFilePicker!({ suggestedName: name, types: L5X_TYPES });
      await writeHandle(handle, text);
      ui.tidy.close();
      toast(`Saved ${handle.name}`);
      return;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return;
      // writing refused or not available: download instead
    }
  }
  download(name, text, "application/xml");
  ui.tidy.close();
  toast(`Downloaded ${name}`);
}

// ---------------------------------------------------------------------------------------------
// Open an L5X (Phase 4d): a Studio program export back to qSFC, opened as a new unsaved file.
// ---------------------------------------------------------------------------------------------

interface ImportState {
  file: File;
  fileName: string;
  /** The file's text as read. */
  original: string;
  result: ImportResult;
  /** Index of the routine shown in the Studio pane. */
  shown: number;
  returnFocus: HTMLElement | null;
}

let impState: ImportState | undefined;

async function importCmd(): Promise<void> {
  const back = el("file-btn");
  if (canPickOpen) {
    try {
      const [handle] = await fsWindow.showOpenFilePicker!({ types: L5X_TYPES, excludeAcceptAllOption: false, multiple: false });
      if (handle) await openImport(await handle.getFile(), back);
      return;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return;
      // SecurityError and friends: plain input
    }
  }
  ui.importInput.value = "";
  ui.importInput.click();
}

ui.importInput.addEventListener("change", () => {
  const file = ui.importInput.files?.[0];
  if (file) void openImport(file, el("file-btn"));
});

async function openImport(file: File, returnFocus: HTMLElement | null = document.activeElement as HTMLElement | null): Promise<void> {
  let original: string;
  try {
    original = decodeL5X(await file.arrayBuffer());
  } catch (e) {
    toast(`Could not read ${file.name}: ${(e as Error).message}`, "error");
    return;
  }
  const result = importL5X(original);
  const problem = importProblem(file.name, result);
  if (problem) {
    toast(problem, "error");
    return;
  }
  impState = { file, fileName: file.name, original, result, shown: firstSfc(result), returnFocus: impState?.returnFocus ?? returnFocus };
  ui.impFile.textContent = file.name;
  ui.impProgram.replaceChildren(...result.programs.map((p) => new Option(p, p, false, p === result.program)));
  ui.impProgramWrap.hidden = result.programs.length < 2;
  renderImport();
  if (!ui.imp.open) ui.imp.showModal();
  ui.impOpen.focus();
}

function firstSfc(result: ImportResult): number {
  const i = result.routines.findIndex((r) => r.imported && r.type === "SFC");
  return i >= 0 ? i : 0;
}

function chooseImportProgram(name: string): void {
  const s = impState;
  if (!s) return;
  const result = importL5X(s.original, { program: name });
  if (result.error) {
    toast(`${s.fileName}: ${result.error}`, "error");
    return;
  }
  s.result = result;
  s.shown = firstSfc(result);
  renderImport();
}

ui.impProgram.addEventListener("change", () => chooseImportProgram(ui.impProgram.value));

function renderImport(): void {
  const s = impState;
  if (!s) return;
  const r = s.result;
  ui.impBody.replaceChildren(
    ...r.routines.map((x, i) => {
      const tr = document.createElement("tr");
      tr.dataset["i"] = String(i);
      if (i === s.shown) {
        tr.className = "sel";
        tr.setAttribute("aria-current", "true");
      }
      const show = document.createElement("button");
      show.type = "button";
      show.className = "tidy-show";
      show.title = "Show it as Studio draws it";
      const kind = document.createElement("span");
      kind.className = "tidy-kind";
      kind.textContent = `(${x.type})`;
      show.append(`${x.name} `, kind);
      const tdName = cell("td", "");
      tdName.append(show);
      const st = routineStatus(x);
      tr.append(tdName, cell("td", st.text, `st-${st.kind}`));
      return tr;
    }),
  );
  const shown = r.routines[s.shown];
  if (shown?.type === "SFC") {
    ui.impStudio.innerHTML = renderStudioSketch(s.original, shown.name);
    ui.impStudioSub.textContent = `· ${shown.name}`;
  } else {
    const p = document.createElement("p");
    p.className = "imp-sketch-none";
    p.textContent = shown ? `${shown.name} is ${shown.type === "ST" ? "an ST routine" : `a ${shown.type} routine`}: no chart to draw.` : "";
    ui.impStudio.replaceChildren(p);
    ui.impStudioSub.textContent = shown ? `· ${shown.name}` : "";
  }
  const pre = document.createElement("pre");
  pre.innerHTML = previewHtml(r.source);
  ui.impCode.replaceChildren(pre);
  ui.impCodeSub.textContent = r.errors ? `· ${plural(r.errors, "error")} to fix in the editor` : "· no errors";
  ui.impNotesTitle.textContent = notesTitle(r.notes);
  ui.impNotes.replaceChildren(
    ...noteItems(r.notes).map((n) => {
      const li = document.createElement("li");
      li.className = n.level === "warning" ? "w" : "i";
      li.textContent = n.text;
      return li;
    }),
  );
  ui.impNote.textContent = `Opens as a new file, ${importFileName(r.program)} (not saved yet). Export it again with File → Export L5X.`;
  for (const pane of [ui.impStudio, ui.impCode]) pane.scrollTo(0, 0);
}

ui.impBody.addEventListener("click", (e) => {
  const tr = (e.target as Element).closest<HTMLElement>("tr[data-i]");
  if (!impState || !tr) return;
  const i = Number(tr.dataset["i"]);
  if (i === impState.shown) return;
  impState.shown = i;
  renderImport();
  ui.impBody.querySelector<HTMLElement>(`tr[data-i="${i}"] .tidy-show`)?.focus();
});

/** "Open in the editor": the imported text as a new, unsaved file (asks first about unsaved changes). */
async function acceptImport(): Promise<boolean> {
  const s = impState;
  if (!s) return false;
  const { source, program } = s.result;
  ui.imp.close();
  if (!(await confirmDiscard(`open the program imported from ${s.fileName}`))) return false;
  stopWatch(false);
  setDoc(newFileState(importFileName(program)), source, undefined, "");
  editor.goTo(1, 1, true);
  toast(`Imported ${program} from ${s.fileName}`);
  return true;
}

ui.impOpen.addEventListener("click", () => void acceptImport());

el("imp-tidy").addEventListener("click", () => {
  const s = impState;
  if (!s) return;
  const file = s.file;
  const back = s.returnFocus;
  ui.imp.close();
  void openTidy(file, back);
});

ui.imp.addEventListener("close", () => {
  if (ui.imp.open) return; // reopened (another file) meanwhile
  const back = impState?.returnFocus;
  impState = undefined;
  ui.impStudio.replaceChildren();
  ui.impCode.replaceChildren();
  if (back?.isConnected && back.offsetParent !== null && !ui.tidy.open) back.focus();
});

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
  if (!shown && !ui.search.hidden) closeSearch(false);
  ui.canvas.classList.toggle("stale", stale);
  for (const id of ["zoom-out", "zoom-reset", "zoom-in", "zoom-fit"]) el<HTMLButtonElement>(id).disabled = !shown;
  if (!doc) return;
  if (st) renderStCard(v.active!, v.index);
  else ui.stView.replaceChildren();
  if (!shown) {
    ui.stage.replaceChildren();
    drawn = undefined;
    drawnSvg = "";
    setOverviewSvg("");
    applyTagHighlight();
    refreshSearch();
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
      afterDraw();
      return;
    }
    drawnSvg = svgText;
    ui.stage.innerHTML = svgText;
    const svg = ui.stage.querySelector("svg")!;
    svg.setAttribute("aria-label", `SFC diagram of ${shown.name}`);
    svgSize = { width: Number(svg.getAttribute("width")) || 1, height: Number(svg.getAttribute("height")) || 1 };
    setOverviewSvg(svgText);
    if (fit || first) requestAnimationFrame(() => fitToWindow());
    else setZoom(zoom);
  }
  afterDraw();
}

/** Highlights that live in the drawn SVG, put back after each drawing. */
function afterDraw(): void {
  applySelectionHighlight(false);
  applyTagHighlight();
  refreshSearch();
  highlightCursorElement(false);
  scheduleOverview();
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
  // The I/O address column only when the file has an `io` block (SPEC §7.6).
  const hasAddr = tags.some((t) => t.address);
  ui.tagTable.classList.toggle("has-addr", hasAddr);
  if (selectedTag && !tags.some((t) => t.name.toLowerCase() === selectedTag)) selectedTag = undefined;
  const rows = sortTags(tags, tagSort).map((t) => {
    const tr = document.createElement("tr");
    const k = t.name.toLowerCase();
    tr.dataset["tag"] = k;
    tr.tabIndex = 0;
    tr.classList.add("link");
    if (k === selectedTag) tr.classList.add("sel");
    tr.setAttribute("aria-label", `${t.name}, ${t.type}${t.address ? `, ${t.address}` : ""}, ${plural(t.uses.length, "use")}`);
    tr.title = `${usesTitle(t)}. Click to show where it is used in the diagram; Enter goes to the next use.`;
    const name = cell("td", t.name, "mono name");
    if (!t.declared) name.title = "Not declared: type inferred from its uses";
    if (hasAddr && t.address) name.append(cell("span", t.address, "addr-sub"));
    const type = document.createElement("td");
    type.append(cell("span", t.type, `type type-${t.type.toLowerCase()}`));
    const addr = cell("td", t.address ?? "—", `mono addr${t.address ? "" : " none"}`);
    const uses = document.createElement("td");
    uses.className = "num";
    const usesBtn = cell("button", String(t.uses.length), "uses-btn") as HTMLButtonElement;
    usesBtn.type = "button";
    usesBtn.tabIndex = -1;
    usesBtn.disabled = t.uses.length === 0;
    usesBtn.title = t.uses.length ? `${usesTitle(t)}. Click to go to the next use.` : usesTitle(t);
    uses.append(usesBtn);
    const desc = cell("td", t.description ?? "", "desc");
    tr.append(name, type, ...(hasAddr ? [addr] : []), uses, desc);
    return tr;
  });
  ui.tagBody.replaceChildren(...rows);
}

// ---------------------------------------------------------------------------------------------
// Where a tag is used (Phase 4c): click a tag row to light up its uses in the diagram
// ---------------------------------------------------------------------------------------------

function tagNamed(k: string | undefined): TagInfo | undefined {
  return k ? result?.tags.find((t) => t.name.toLowerCase() === k) : undefined;
}

function setSelectedTag(name: string | undefined): void {
  selectedTag = name?.toLowerCase();
  if (!tagNamed(selectedTag)) selectedTag = undefined;
  for (const tr of ui.tagBody.querySelectorAll<HTMLElement>("tr[data-tag]")) tr.classList.toggle("sel", tr.dataset["tag"] === selectedTag);
  applyTagHighlight();
  // Scroll the first element using it into view.
  const first = ui.stage.querySelector(".qsfc-tag");
  if (first) scrollIntoCanvas(first);
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Outlines the steps and transitions using the picked tag, its name in their text, and the tabs of other routines using it. */
function applyTagHighlight(): void {
  for (const e of ui.stage.querySelectorAll(".qsfc-tag")) e.classList.remove("qsfc-tag");
  for (const span of ui.stage.querySelectorAll("tspan.qsfc-tag-name")) {
    const parent = span.parentNode;
    span.replaceWith(document.createTextNode(span.textContent ?? ""));
    parent?.normalize();
  }
  for (const b of ui.routineTabs.querySelectorAll(".uses-tag")) b.classList.remove("uses-tag");
  const tag = tagNamed(selectedTag);
  if (!tag || !doc) return;
  for (const id of tagElements(drawn?.diagram.graph, tag.uses)) {
    const g = stageElement(id);
    if (!g) continue;
    g.classList.add("qsfc-tag");
    for (const text of g.querySelectorAll("text.qsfc-code")) emphasizeName(text, tag.name);
  }
  const routines = result?.routines ?? [];
  if (routines.length > 1) {
    for (const i of routinesUsing(routines, tag.uses)) {
      if (i === shownIndex) continue;
      const b = ui.routineTabs.querySelector(`[data-index="${i}"]`);
      if (b) {
        b.classList.add("uses-tag");
        b.setAttribute("title", `${b.getAttribute("title")?.replace(/ · uses .*$/, "") ?? ""} · uses ${tag.name}`);
      }
    }
  }
}

/** Wraps each whole-word `name` in the text nodes of an SVG <text> in a <tspan class="qsfc-tag-name">. */
function emphasizeName(text: Element, name: string): void {
  for (const node of [...text.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE) continue; // the <title> holding the full text
    const parts = splitOnName(node.textContent ?? "", name);
    if (!parts.some((p) => p.hit)) continue;
    const frag = document.createDocumentFragment();
    for (const p of parts) {
      if (!p.hit) frag.append(p.text);
      else {
        const t = document.createElementNS(SVG_NS, "tspan");
        t.setAttribute("class", "qsfc-tag-name");
        t.textContent = p.text;
        frag.append(t);
      }
    }
    node.replaceWith(frag);
  }
}

/** Moves the editor to the next use of the tag after the cursor (cycling), selecting it. */
function goToNextUse(tag: TagInfo, focusEditor: boolean): void {
  const u = nextUse(tag.uses, cursor);
  if (!u) return;
  editor.select(u.line, u.col, u.endLine === u.line && u.endCol !== undefined ? u.endCol : u.col + tag.name.length, focusEditor);
  toast(`${tag.name}: use ${useIndex(tag.uses, u)} of ${tag.uses.length}, line ${u.line}`);
}

ui.tagBody.addEventListener("click", (e) => {
  const tr = (e.target as Element).closest<HTMLElement>("tr[data-tag]");
  if (!tr) return;
  const k = tr.dataset["tag"];
  if ((e.target as Element).closest(".uses-btn")) {
    if (selectedTag !== k) setSelectedTag(k);
    const tag = tagNamed(k);
    if (tag) goToNextUse(tag, false);
    tr.focus();
    return;
  }
  setSelectedTag(selectedTag === k ? undefined : k);
});

ui.tagBody.addEventListener("keydown", (e) => {
  const tr = (e.target as Element).closest<HTMLElement>("tr[data-tag]");
  if (!tr || e.target !== tr || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = tr.dataset["tag"];
  if (e.key === "Enter") {
    if (selectedTag !== k) setSelectedTag(k);
    const tag = tagNamed(k);
    if (tag) goToNextUse(tag, false);
  } else if (e.key === " ") {
    setSelectedTag(selectedTag === k ? undefined : k);
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const next = (e.key === "ArrowDown" ? tr.nextElementSibling : tr.previousElementSibling) as HTMLElement | null;
    next?.focus();
  } else return;
  e.preventDefault();
});

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
  scheduleOverview();
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
// Overview map (Phase 4c): the whole chart in a corner when it doesn't fit
// ---------------------------------------------------------------------------------------------

/** Thumbnail pixels per canvas pixel, from the last update. */
let overviewScale = 1;
let overviewFrame: number | undefined;

function setOverviewSvg(svgText: string): void {
  if (!svgText) {
    ui.overviewMap.replaceChildren();
    ui.overview.hidden = true;
    return;
  }
  ui.overviewMap.innerHTML = svgText;
  const mini = ui.overviewMap.querySelector("svg");
  mini?.removeAttribute("role");
  mini?.setAttribute("aria-hidden", "true");
  mini?.setAttribute("focusable", "false");
}

function scheduleOverview(): void {
  if (overviewFrame !== undefined) return;
  overviewFrame = requestAnimationFrame(() => {
    overviewFrame = undefined;
    updateOverview();
  });
}

function updateOverview(): void {
  const c = ui.canvas;
  const svg = ui.stage.querySelector("svg");
  const mini = ui.overviewMap.querySelector("svg");
  if (!view.overview || !doc || !svg || !mini || c.hidden || c.clientWidth === 0) {
    ui.overview.hidden = true;
    return;
  }
  const content = { width: c.scrollWidth, height: c.scrollHeight };
  const box = { width: c.clientWidth, height: c.clientHeight };
  const g = overviewGeometry(content, box, { x: c.scrollLeft, y: c.scrollTop }, overviewMax(box));
  ui.overview.hidden = !g.needed;
  if (!g.needed) return;
  overviewScale = g.scale;
  // Keep clear of the canvas scroll bars.
  ui.overview.style.right = `${12 + (c.offsetWidth - c.clientWidth)}px`;
  ui.overview.style.bottom = `${12 + (c.offsetHeight - c.clientHeight)}px`;
  ui.overview.style.width = `${g.width}px`;
  ui.overview.style.height = `${g.height}px`;
  const cr = c.getBoundingClientRect();
  const sr = svg.getBoundingClientRect();
  mini.style.left = `${(sr.left - cr.left + c.scrollLeft) * g.scale}px`;
  mini.style.top = `${(sr.top - cr.top + c.scrollTop) * g.scale}px`;
  mini.setAttribute("width", String(Math.max(1, sr.width * g.scale)));
  mini.setAttribute("height", String(Math.max(1, sr.height * g.scale)));
  const f = ui.overviewFrame.style;
  f.left = `${g.frame.x}px`;
  f.top = `${g.frame.y}px`;
  f.width = `${g.frame.width}px`;
  f.height = `${g.frame.height}px`;
}

ui.canvas.addEventListener("scroll", scheduleOverview, { passive: true });
new ResizeObserver(scheduleOverview).observe(ui.canvas);

let overviewDrag: { x: number; y: number; scroll: { x: number; y: number }; id: number } | undefined;
const canvasBoxes = (): { content: { width: number; height: number }; box: { width: number; height: number } } => ({
  content: { width: ui.canvas.scrollWidth, height: ui.canvas.scrollHeight },
  box: { width: ui.canvas.clientWidth, height: ui.canvas.clientHeight },
});

ui.overview.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  const r = ui.overview.getBoundingClientRect();
  const p = { x: e.clientX - r.left, y: e.clientY - r.top };
  const f = ui.overviewFrame.getBoundingClientRect();
  const inFrame = e.clientX >= f.left && e.clientX <= f.right && e.clientY >= f.top && e.clientY <= f.bottom;
  const { content, box } = canvasBoxes();
  if (!inFrame) {
    // A click outside the frame: go there, and keep dragging from there.
    const to = scrollToPoint(p, overviewScale, content, box);
    ui.canvas.scrollTo({ left: to.x, top: to.y });
  }
  overviewDrag = { x: e.clientX, y: e.clientY, scroll: { x: ui.canvas.scrollLeft, y: ui.canvas.scrollTop }, id: e.pointerId };
  ui.overview.setPointerCapture(e.pointerId);
  ui.overview.classList.add("dragging");
});
ui.overview.addEventListener("pointermove", (e) => {
  if (!overviewDrag || e.pointerId !== overviewDrag.id) return;
  const { content, box } = canvasBoxes();
  const to = dragScroll(overviewDrag.scroll, { x: e.clientX - overviewDrag.x, y: e.clientY - overviewDrag.y }, overviewScale, content, box);
  ui.canvas.scrollTo({ left: to.x, top: to.y });
});
const endOverviewDrag = (): void => {
  overviewDrag = undefined;
  ui.overview.classList.remove("dragging");
};
ui.overview.addEventListener("pointerup", endOverviewDrag);
ui.overview.addEventListener("pointercancel", endOverviewDrag);
ui.overview.addEventListener(
  "wheel",
  (e) => {
    // The wheel over the map scrolls the diagram, as over the canvas.
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const { content, box } = canvasBoxes();
    const to = clampScroll({ x: ui.canvas.scrollLeft + e.deltaX, y: ui.canvas.scrollTop + e.deltaY }, content, box);
    ui.canvas.scrollTo({ left: to.x, top: to.y });
  },
  { passive: false },
);

// ---------------------------------------------------------------------------------------------
// Find in the diagram (Ctrl+F on the canvas, Phase 4c); the editor keeps CodeMirror's search
// ---------------------------------------------------------------------------------------------

const search: { matches: DiagramMatch[]; index: number } = { matches: [], index: -1 };

function openSearch(): void {
  if (!drawn) {
    toast("There is no diagram to search", "error");
    return;
  }
  ui.search.hidden = false;
  ui.searchInput.focus();
  ui.searchInput.select();
  refreshSearch();
}

function closeSearch(focusCanvas: boolean): void {
  ui.search.hidden = true;
  search.matches = [];
  search.index = -1;
  paintSearch();
  if (focusCanvas && !ui.canvas.hidden) ui.canvas.focus();
}

/** Recomputes the matches (new query or new diagram), keeping the current one when it still matches. */
function refreshSearch(): void {
  if (ui.search.hidden) return;
  const old = search.matches[search.index]?.id;
  search.matches = searchDiagram(drawn?.diagram.graph, ui.searchInput.value);
  const keep = search.matches.findIndex((m) => m.id === old);
  search.index = keep >= 0 ? keep : search.matches.length ? 0 : -1;
  paintSearch();
}

function paintSearch(): void {
  for (const e of ui.stage.querySelectorAll(".qsfc-find, .qsfc-find-cur")) e.classList.remove("qsfc-find", "qsfc-find-cur");
  ui.searchCount.textContent = matchLabel(search.index, search.matches.length, ui.searchInput.value);
  ui.search.classList.toggle("none", !!ui.searchInput.value.trim() && search.matches.length === 0);
  search.matches.forEach((m, i) => stageElement(m.id)?.classList.add(i === search.index ? "qsfc-find-cur" : "qsfc-find"));
}

/** Shows match `i`: scrolled into view, its text selected in the editor (the search box keeps the focus). */
function showMatch(i: number): void {
  search.index = i;
  paintSearch();
  const m = search.matches[i];
  if (!m) return;
  const target = stageElement(m.id);
  if (target) scrollIntoCanvas(target);
  editor.select(m.line, m.col, m.col + m.length, false);
}

function stepSearch(dir: 1 | -1): void {
  if (!search.matches.length) return;
  showMatch(cycleIndex(search.index, search.matches.length, dir));
}

ui.searchInput.addEventListener("input", () => {
  search.index = -1;
  refreshSearch();
  if (search.matches.length) showMatch(0);
});
ui.searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") stepSearch(e.shiftKey ? -1 : 1);
  else if (e.key === "Escape") closeSearch(true);
  else return;
  e.preventDefault();
  e.stopPropagation();
});
el("search-next").addEventListener("click", () => stepSearch(1));
el("search-prev").addEventListener("click", () => stepSearch(-1));
el("search-close").addEventListener("click", () => closeSearch(true));

// ---------------------------------------------------------------------------------------------
// Snippets (Phase 4c): Insert → Snippet; autocomplete offers them too (app/editor.ts)
// ---------------------------------------------------------------------------------------------

const SNIPPET_PLACE =
  "A snippet goes where a step can start: put the cursor on an empty line after a transition, after the last step, or in an empty chart";

function fillSnippetMenu(): void {
  const items = SNIPPETS.map((def) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.tabIndex = -1;
    b.dataset["cmd"] = "snippet";
    b.dataset["value"] = def.id;
    b.title = def.detail;
    b.append(cell("span", def.label), cell("kbd", ""));
    return b;
  });
  el("snippet-items").replaceChildren(...items);
}

async function insertSnippetCmd(id: string): Promise<void> {
  const def = findSnippet(id);
  if (!def) return;
  if (watching) {
    toast("The editor is read-only while watching a file", "error");
    return;
  }
  if (!doc) await newChart("");
  if (!doc) return;
  const lines = editor.lines();
  let line = Math.min(cursor.line, lines.length);
  let at = line - 1;
  const blank = (lines[at] ?? "").trim() === "";
  if (!blank) {
    // A line with text: the snippet goes on a new line below it.
    lines.splice(line, 0, "");
    at = line;
  }
  const ctx = snippetContext(lines, at);
  if (!ctx) {
    toast(SNIPPET_PLACE, "error");
    editor.focus();
    return;
  }
  const template = snippetTemplate(def, ctx, usedNames(lines, at));
  if (!blank) {
    const l = editor.view.state.doc.line(line);
    editor.view.dispatch({ changes: { from: l.to, insert: "\n" } });
    line++;
  }
  editor.insertSnippet(template, line);
}

// ---------------------------------------------------------------------------------------------
// Print / PDF view (Phase 4c): File → Print… builds a print-only layout, then window.print()
// ---------------------------------------------------------------------------------------------

/** window.print() was called by File → Print (the layout is already built). */
let printing = false;

function printCmd(): void {
  flushCompile();
  if (!doc || !result) {
    toast("Open a chart first: there is nothing to print", "error");
    return;
  }
  ui.printDlg.returnValue = "";
  syncPrintGo();
  ui.printDlg.showModal();
  el("print-go").focus();
}

const printBox = (id: string): HTMLInputElement => el<HTMLInputElement>(id);
function printChoice(): PrintOptions {
  return { diagram: printBox("print-diagram").checked, tags: printBox("print-tags").checked, code: printBox("print-code").checked };
}
function syncPrintGo(): void {
  const c = printChoice();
  const go = el<HTMLButtonElement>("print-go");
  go.disabled = !c.diagram && !c.tags && !c.code;
  go.title = go.disabled ? "Tick at least one part" : "";
}
for (const id of ["print-diagram", "print-tags", "print-code"]) printBox(id).addEventListener("change", syncPrintGo);

ui.printDlg.addEventListener("close", () => {
  if (ui.printDlg.returnValue !== "print") return;
  const choice = printChoice();
  // After the dialog has left the screen.
  window.setTimeout(() => {
    if (!buildPrintView(choice)) return;
    printing = true;
    window.print();
  }, 0);
});

/** Builds the print-only layout (light colors, whatever the theme). Returns the number of routines. */
function buildPrintView(include: PrintOptions): number {
  flushCompile();
  const r = result;
  if (!doc || !r) return 0;
  const model = buildPrintModel({
    program: r.program,
    routines: r.routines,
    tags: r.tags,
    source: editor.getText(),
    date: new Date(),
    include,
    diagram: (i) => {
      const routine = r.routines[i];
      const d = routine && diagramOf(routine);
      return d && svgOf(d);
    },
  });
  ui.printView.innerHTML = printHtml(model);
  for (const svg of ui.printView.querySelectorAll("svg")) {
    svg.removeAttribute("role");
    svg.setAttribute("aria-hidden", "true");
  }
  // Light colors when printing: the diagrams' dark palette follows the root's classes.
  const root = document.documentElement;
  root.classList.remove("qsfc-dark");
  root.classList.add("qsfc-light", "qsfc-printing");
  return model.routines.length;
}

function clearPrintView(): void {
  ui.printView.replaceChildren();
  document.documentElement.classList.remove("qsfc-printing");
  applyTheme(view.theme);
}

// The browser's own Print command (its menu) prints the same layout, everything ticked.
window.addEventListener("beforeprint", () => {
  if (!printing && doc && result) buildPrintView(DEFAULT_PRINT);
});
window.addEventListener("afterprint", () => {
  printing = false;
  clearPrintView();
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

fillSnippetMenu();
const menus: Menu[] = [
  { button: el<HTMLButtonElement>("file-btn"), list: el("file-menu") },
  { button: el<HTMLButtonElement>("view-btn"), list: el("view-menu") },
  { button: el<HTMLButtonElement>("insert-btn"), list: el("insert-menu") },
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
    case "tidy":
      void tidyCmd();
      break;
    case "import-l5x":
      void importCmd();
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
    case "overview":
      setView({ overview: !view.overview });
      break;
    case "print":
      printCmd();
      break;
    case "snippet":
      void insertSnippetCmd(item.dataset["value"] ?? "");
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
    if (!mod || ui.tidy.open) return;
    const k = e.key.toLowerCase();
    if (ui.printDlg.open) {
      if (k === "p") e.preventDefault(); // already asking what to print
      return;
    }
    let run: (() => void) | undefined;
    // Ctrl+F in the diagram (canvas, tabs, map or the search box) searches the diagram; in the editor, CodeMirror's search.
    const inDiagram = ui.canvasWrap.contains(document.activeElement);
    if (!e.altKey && !e.shiftKey && k === "f" && inDiagram && !ui.canvas.hidden) run = () => openSearch();
    if (e.altKey && !e.shiftKey && (k === "n" || e.code === "KeyN")) run = () => void newChart("");
    else if (!e.altKey && !e.shiftKey && k === "o") run = () => void openFile();
    else if (!e.altKey && k === "s") run = () => void save(e.shiftKey);
    else if (!e.altKey && !e.shiftKey && k === "e") run = () => runCommand(ui.exportBtn);
    else if (!e.altKey && !e.shiftKey && k === "p") run = () => printCmd();
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
  const inEditor = ui.editorHost.contains(e.target as Node);
  if (openMenu) hideMenu(true);
  else if (!ui.search.hidden && ui.canvasWrap.contains(e.target as Node)) closeSearch(true);
  else if (selectedTag && !inEditor) setSelectedTag(undefined);
  else if (selectedProblem && !inEditor) selectProblem(undefined);
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
