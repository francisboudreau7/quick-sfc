/**
 * QuickSFC window (Phase 3: live coding). Editor | diagram | Tags, Problems at the bottom.
 * The chart is recompiled ~150 ms after typing stops; on errors the last valid diagram
 * stays, dimmed. Plain DOM plus CodeMirror (app/editor.ts). The markup lives in
 * app/index.html; the pure logic in app/{state,problems,format,highlight,complete,nav,
 * dirty,splitter,watch}.ts.
 */
import { compile, exportL5X, routineName, type CompileResult } from "../src/compile.js";
import { allSteps } from "../src/model/ast.js";
import type { Diagnostic } from "../src/model/diagnostics.js";
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
import { elementAtLine, pickElement, sourceOfElement } from "./nav.js";
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
/** Latest result with a diagram (graph); stays when the text gets errors. */
let lastGood: CompileResult | undefined;
/** The result whose diagram is in the stage now, and the view options it was drawn with. */
let drawn: { result: CompileResult; key: string } | undefined;
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
        highlightCursorElement(true);
      });
    }
  },
  completionInfo,
});

function completionInfo(): CompletionInfo {
  const r = result;
  if (!r) return { steps: [], tags: [] };
  const steps = allSteps(r.chart).map((s) => {
    const o: { name: string; presetMs?: number; description?: string; initial: boolean } = { name: s.name.text, initial: s.initial };
    if (s.presetMs !== undefined) o.presetMs = s.presetMs;
    if (s.description !== undefined) o.description = s.description;
    return o;
  });
  return { steps, tags: r.tags };
}

/** Compiles the editor text now and updates every view. */
function runCompile(fit = false): void {
  window.clearTimeout(compileTimer);
  compileTimer = undefined;
  if (!doc) return;
  const t0 = performance.now();
  const source = editor.getText();
  try {
    result = compile(source);
  } catch (e) {
    toast(`Internal error while compiling: ${(e as Error).message}`, "error");
    return;
  }
  diagnostics = result.diagnostics;
  exportable = false;
  if (result.graph) {
    // Export-only checks (routine and program names) show up as problems too.
    const check = exportL5X(source, { fileName: doc.file.name });
    exportable = check.text !== undefined;
    diagnostics = check.diagnostics;
    lastGood = result;
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
  lastGood = undefined;
  drawn = undefined;
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

function exportSvgCmd(): void {
  flushCompile();
  if (!doc || !result?.graph) {
    toast(doc ? "Fix the errors first: there is no diagram to export" : "Open a .qsfc file first", "error");
    return;
  }
  const out = svgFileName(doc.file.name);
  download(out, svgOf(result), "image/svg+xml");
  toast(`Exported ${out}`);
}

function svgOf(r: CompileResult): string {
  return renderSvg(r.graph!, r.layout!, {
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
  const noSvg = !result?.graph;
  svgItem.setAttribute("aria-disabled", String(noSvg));
  svgItem.title = noSvg ? (doc ? "Fix the errors first: there is no diagram" : "Open a .qsfc file first") : "";
  for (const cmd of ["save", "save-as"]) {
    document.querySelector<HTMLElement>(`[data-cmd="${cmd}"]`)!.setAttribute("aria-disabled", String(!doc));
  }
  if (!doc || !result) return;
  const { errors, warnings } = countProblems(diagnostics);
  ui.fileName.textContent = doc.file.name;
  ui.fileRoutine.textContent = `routine ${routineName(result.chart, doc.file.name)}`;
  ui.fileDot.className = `dot ${errors ? "err" : warnings ? "warn" : "ok"}`;
  ui.fileInfo.title = errors ? plural(errors, "error") : warnings ? plural(warnings, "warning") : "No problems";
}

function viewKey(): string {
  return `${view.numbers}|${view.showActions}`;
}

function renderDiagram(fit: boolean): void {
  const shown = result?.graph ? result : lastGood;
  const stale = !!doc && !result?.graph && !!lastGood;
  ui.canvas.hidden = !doc || !shown;
  ui.broken.hidden = !doc || !!shown;
  ui.staleBadge.hidden = !stale;
  ui.canvas.classList.toggle("stale", stale);
  for (const id of ["zoom-out", "zoom-reset", "zoom-in", "zoom-fit"]) el<HTMLButtonElement>(id).disabled = !shown;
  if (!doc) return;
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
  const key = viewKey();
  if (!drawn || drawn.result !== shown || drawn.key !== key) {
    const first = !drawn;
    const svgText = svgOf(shown);
    const same = !first && svgText === drawnSvg;
    drawn = { result: shown, key };
    if (same) {
      applySelectionHighlight(false);
      highlightCursorElement(false);
      return;
    }
    drawnSvg = svgText;
    ui.stage.innerHTML = svgText;
    const svg = ui.stage.querySelector("svg")!;
    svg.setAttribute("aria-label", `SFC diagram of ${routineName(shown.chart, doc.file.name)}`);
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
  const c = chartCounts(result?.graph);
  ui.statusCounts.textContent = c
    ? `${plural(c.steps, "step")} · ${plural(c.transitions, "transition")} · ${plural(c.branches, "branch", "branches")}`
    : lastGood
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
  const id = problemTarget(d, drawn?.result.graph);
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
  const id = doc ? elementAtLine(drawn?.result.graph, cursor.line) : undefined;
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
  const graph = drawn?.result.graph;
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
