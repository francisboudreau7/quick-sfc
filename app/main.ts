/**
 * QuickSFC viewer window (Phase 2): open a .qsfc chart, see its diagram (textbook look),
 * tags and problems, export L5X or SVG. Plain DOM, no framework. The markup lives in
 * app/index.html; the pure logic in app/state.ts, app/problems.ts and app/format.ts.
 */
import { compile, exportL5X, routineName, type CompileResult } from "../src/compile.js";
import type { Diagnostic } from "../src/model/diagnostics.js";
import { renderSvg } from "../src/render/svg.js";
import { chartCounts, DEFAULT_TAG_SORT, nextTagSort, plural, sortTags, usesTitle, type TagSort, type TagSortKey } from "./format.js";
import { countProblems, orderProblems, problemKey, problemLocation, problemTag, problemTarget } from "./problems.js";
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
  canvas: el("canvas"),
  stage: el("stage"),
  welcome: el("welcome"),
  broken: el("broken"),
  brokenDetail: el("broken-detail"),
  zoomReset: el<HTMLButtonElement>("zoom-reset"),
  fileInfo: el("file-info"),
  fileDot: el("file-dot"),
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
  dropOverlay: el("drop-overlay"),
  toast: el("toast"),
};

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

/** Minimal File System Access API types (not in lib.dom for every TS version). */
interface PickerHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}
type OpenFilePicker = (options?: unknown) => Promise<PickerHandle[]>;

interface Doc {
  name: string;
  source: string;
  result: CompileResult;
  diagnostics: Diagnostic[];
  routine: string;
  exportable: boolean;
}

const storage = (): Storage | undefined => window.localStorage;
const view: ViewOptions = loadViewOptions(storage);
let doc: Doc | undefined;
/** Kept for Phase 3 watch mode (File System Access API, Edge/Chrome). */
let fileHandle: PickerHandle | undefined;
let zoom = 1;
/** Natural size of the current SVG at 100 %. */
let svgSize = { width: 0, height: 0 };
let selectedProblem: string | undefined;
let tagSort: TagSort = DEFAULT_TAG_SORT;

// Exposed for debugging and for Phase 3 (watch mode needs the handle).
(window as unknown as { qsfc: unknown }).qsfc = {
  get fileHandle() {
    return fileHandle;
  },
  get zoom() {
    return zoom;
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
    else if (cmd === "theme") on = item.dataset["value"] === view.theme;
    item.setAttribute("aria-checked", String(on));
  }
}

function setView(patch: Partial<ViewOptions>): void {
  const redraw = (patch.numbers !== undefined && patch.numbers !== view.numbers) ||
    (patch.showActions !== undefined && patch.showActions !== view.showActions);
  Object.assign(view, patch);
  saveViewOptions(storage, view);
  applyTheme(view.theme);
  syncViewMenu();
  setProblemsOpen(view.problemsOpen);
  if (redraw) renderDiagram(false);
}

// ---------------------------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------------------------

let toastTimer: number | undefined;
function toast(message: string, kind: "info" | "error" = "info"): void {
  ui.toast.textContent = message;
  ui.toast.className = `toast show ${kind}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (ui.toast.className = "toast"), 3200);
}

// ---------------------------------------------------------------------------------------------
// Loading a chart
// ---------------------------------------------------------------------------------------------

function load(name: string, rawText: string, handle?: PickerHandle): void {
  const source = stripBom(rawText);
  let result: CompileResult;
  try {
    result = compile(source);
  } catch (e) {
    toast(`Could not read ${name}: ${(e as Error).message}`, "error");
    return;
  }
  let diagnostics = result.diagnostics;
  let exportable = false;
  if (result.graph) {
    // Export-only checks (routine and program names) show up as problems too.
    const check = exportL5X(source, { fileName: name });
    exportable = check.text !== undefined;
    diagnostics = check.diagnostics;
  }
  doc = { name, source, result, diagnostics, routine: routineName(result.chart, name), exportable };
  fileHandle = handle;
  selectedProblem = undefined;
  document.title = `${name} · QuickSFC`;
  renderAll();
  renderDiagram(true);
}

async function readFile(file: File, handle?: PickerHandle): Promise<void> {
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

async function openFile(): Promise<void> {
  const picker = (window as unknown as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker;
  if (picker) {
    try {
      const [handle] = await picker({
        types: [{ description: "qSFC chart", accept: { "text/plain": [".qsfc"] } }],
        excludeAcceptAllOption: false,
        multiple: false,
      });
      if (handle) await readFile(await handle.getFile(), handle);
      return;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return;
      // SecurityError and friends: fall back to the plain input below.
    }
  }
  ui.fileInput.value = "";
  ui.fileInput.click();
}

ui.fileInput.addEventListener("change", () => {
  const file = ui.fileInput.files?.[0];
  if (file) void readFile(file);
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
  const item = e.dataTransfer?.items?.[0] as (DataTransferItem & { getAsFileSystemHandle?: () => Promise<PickerHandle | null> }) | undefined;
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  const handlePromise = item?.getAsFileSystemHandle?.().catch(() => null) ?? Promise.resolve(null);
  void handlePromise.then((h) => readFile(file, h && h.kind === "file" ? h : undefined));
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
  if (!doc) return "Open a .qsfc file first";
  if (!doc.exportable) {
    const { errors } = countProblems(doc.diagnostics);
    return `Fix the ${plural(errors, "error")} in the Problems panel before exporting`;
  }
  return undefined;
}

function exportL5XCmd(): void {
  const reason = exportReason();
  if (reason || !doc) {
    toast(reason ?? "Nothing to export", "error");
    return;
  }
  const { text } = exportL5X(doc.source, { fileName: doc.name });
  if (text === undefined) {
    toast("The chart could not be exported", "error");
    return;
  }
  const out = l5xFileName(doc.name);
  download(out, text, "application/xml");
  toast(`Exported ${out}`);
}

function exportSvgCmd(): void {
  if (!doc?.result.graph || !doc.result.layout) {
    toast(doc ? "Fix the errors first: there is no diagram to export" : "Open a .qsfc file first", "error");
    return;
  }
  const out = svgFileName(doc.name);
  download(out, currentSvg(), "image/svg+xml");
  toast(`Exported ${out}`);
}

function currentSvg(): string {
  const { graph, layout } = doc!.result;
  return renderSvg(graph!, layout!, {
    look: "textbook",
    numbering: view.numbers ? "numbers" : "names",
    showActions: view.showActions,
  });
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

function renderAll(): void {
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
    b.title = reason ?? (doc ? `Download ${l5xFileName(doc.name)} for Studio 5000` : "");
  }
  const svgItem = document.querySelector<HTMLElement>('[data-cmd="export-svg"]')!;
  const noSvg = !doc?.result.graph;
  svgItem.setAttribute("aria-disabled", String(noSvg));
  svgItem.title = noSvg ? (doc ? "Fix the errors first: there is no diagram" : "Open a .qsfc file first") : "";
  if (!doc) return;
  const { errors, warnings } = countProblems(doc.diagnostics);
  ui.fileName.textContent = doc.name;
  ui.fileRoutine.textContent = `routine ${doc.routine}`;
  ui.fileDot.className = `dot ${errors ? "err" : warnings ? "warn" : "ok"}`;
  ui.fileInfo.title = errors ? plural(errors, "error") : warnings ? plural(warnings, "warning") : "No problems";
}

function renderDiagram(fit: boolean): void {
  const graph = doc?.result.graph;
  ui.welcome.hidden = !!doc;
  ui.broken.hidden = !doc || !!graph;
  ui.canvas.hidden = !graph;
  for (const id of ["zoom-out", "zoom-reset", "zoom-in", "zoom-fit"]) el<HTMLButtonElement>(id).disabled = !graph;
  if (!doc) return;
  if (!graph) {
    ui.stage.replaceChildren();
    const { errors } = countProblems(doc.diagnostics);
    ui.brokenDetail.textContent = `${doc.name} has ${plural(errors, "error")}. The diagram is drawn again as soon as the chart is valid.`;
    return;
  }
  ui.stage.innerHTML = currentSvg();
  const svg = ui.stage.querySelector("svg")!;
  svg.setAttribute("aria-label", `SFC diagram of ${doc.routine}`);
  svgSize = { width: Number(svg.getAttribute("width")) || 1, height: Number(svg.getAttribute("height")) || 1 };
  applySelectionHighlight(false);
  if (fit) {
    // Wait for layout so the canvas has its final size.
    requestAnimationFrame(() => fitToWindow());
  } else {
    setZoom(zoom);
  }
}

function renderTags(): void {
  const tags = doc?.result.tags ?? [];
  ui.tagCount.textContent = String(tags.length);
  ui.tagTable.hidden = tags.length === 0;
  ui.tagsEmpty.hidden = tags.length > 0;
  ui.tagsEmpty.textContent = doc ? "This chart uses no tags." : "Open a chart to see its tags.";
  for (const th of ui.tagTable.querySelectorAll("th")) {
    const key = th.querySelector<HTMLElement>("button")?.dataset["sort"];
    if (key === tagSort.key) th.setAttribute("aria-sort", tagSort.dir === "asc" ? "ascending" : "descending");
    else th.removeAttribute("aria-sort");
  }
  const rows = sortTags(tags, tagSort).map((t) => {
    const tr = document.createElement("tr");
    tr.dataset["tag"] = t.name.toLowerCase();
    const name = cell("td", t.name, "mono name");
    if (!t.declared) name.title = "Not declared: created as BOOL on export";
    const type = document.createElement("td");
    type.append(cell("span", t.type, `type type-${t.type.toLowerCase()}`));
    const uses = cell("td", String(t.uses.length), "num");
    uses.title = usesTitle(t);
    const desc = cell("td", t.description ?? "", "desc");
    tr.append(name, type, uses, desc);
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
  const diags = orderProblems(doc?.diagnostics ?? []);
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
    b.addEventListener("click", () => selectProblem(k === selectedProblem ? undefined : k));
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
    return;
  }
  ui.statusFile.textContent = doc.name;
  const c = chartCounts(doc.result.graph);
  ui.statusCounts.textContent = c
    ? `${plural(c.steps, "step")} · ${plural(c.transitions, "transition")} · ${plural(c.branches, "branch", "branches")}`
    : "No diagram";
  const { errors, warnings } = countProblems(doc.diagnostics);
  ui.statusProblems.replaceChildren(
    cell("span", plural(errors, "error"), errors ? "err" : "ok"),
    cell("span", plural(warnings, "warning"), warnings ? "warn" : ""),
  );
}

// ---------------------------------------------------------------------------------------------
// Problems: selection and highlight
// ---------------------------------------------------------------------------------------------

function setProblemsOpen(open: boolean): void {
  ui.problems.classList.toggle("collapsed", !open);
  ui.problemsToggle.setAttribute("aria-expanded", String(open));
  ui.problemList.hidden = !open;
}

ui.problemsToggle.addEventListener("click", () => setView({ problemsOpen: !view.problemsOpen }));

function selectProblem(k: string | undefined): void {
  selectedProblem = k;
  for (const b of ui.problemList.querySelectorAll<HTMLElement>("button.problem")) {
    b.setAttribute("aria-pressed", String(b.dataset["key"] === k));
  }
  applySelectionHighlight(true);
}

function applySelectionHighlight(scroll: boolean): void {
  for (const e of ui.stage.querySelectorAll(".qsfc-hl")) e.classList.remove("qsfc-hl");
  for (const e of ui.tagBody.querySelectorAll(".hl")) e.classList.remove("hl");
  if (!doc || !selectedProblem) return;
  const d = doc.diagnostics.find((x) => problemKey(x) === selectedProblem);
  if (!d) return;
  const id = problemTarget(d, doc.result.graph);
  if (id) {
    const target = ui.stage.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (target) {
      target.classList.add("qsfc-hl");
      if (scroll) scrollIntoCanvas(target);
    }
  }
  const decls = new Map(doc.result.chart.tagDecls.map((t) => [t.name.text, t.span.line] as const));
  const tag = problemTag(d, doc.result.tags, decls);
  if (tag) {
    const row = ui.tagBody.querySelector(`tr[data-tag="${CSS.escape(tag.toLowerCase())}"]`);
    if (row) {
      row.classList.add("hl");
      if (scroll) row.scrollIntoView({ block: "nearest" });
    }
  }
}

/** Centers an SVG element in the canvas when it is not fully visible. */
function scrollIntoCanvas(target: Element): void {
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

let drag: { x: number; y: number; left: number; top: number; id: number } | undefined;
ui.canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.pointerType === "touch") return; // touch pans natively
  drag = { x: e.clientX, y: e.clientY, left: ui.canvas.scrollLeft, top: ui.canvas.scrollTop, id: e.pointerId };
  ui.canvas.setPointerCapture(e.pointerId);
  ui.canvas.classList.add("dragging");
});
ui.canvas.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  ui.canvas.scrollLeft = drag.left - (e.clientX - drag.x);
  ui.canvas.scrollTop = drag.top - (e.clientY - drag.y);
});
const endDrag = (e: PointerEvent): void => {
  if (!drag || e.pointerId !== drag.id) return;
  drag = undefined;
  ui.canvas.classList.remove("dragging");
};
ui.canvas.addEventListener("pointerup", endDrag);
ui.canvas.addEventListener("pointercancel", endDrag);

ui.canvas.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "+" || e.key === "=") setZoom(zoomIn(zoom));
  else if (e.key === "-" || e.key === "_") setZoom(zoomOut(zoom));
  else if (e.key === "0") fitToWindow();
  else return;
  e.preventDefault();
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
];
let openMenu: Menu | undefined;

const itemsOf = (m: Menu): HTMLElement[] => [...m.list.querySelectorAll<HTMLElement>('[role^="menuitem"]')];

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
  for (const item of itemsOf(m)) {
    item.addEventListener("pointerenter", () => item.focus({ preventScroll: true }));
    item.addEventListener("click", () => {
      hideMenu(true);
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
    case "open":
      void openFile();
      break;
    case "export-l5x":
      exportL5XCmd();
      break;
    case "export-svg":
      exportSvgCmd();
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

// Global shortcuts.
document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && !e.shiftKey) {
    const k = e.key.toLowerCase();
    if (k === "o") {
      e.preventDefault();
      hideMenu(false);
      void openFile();
      return;
    }
    if (k === "e") {
      e.preventDefault();
      hideMenu(false);
      runCommand(ui.exportBtn);
      return;
    }
  }
  if (e.key === "Escape") {
    if (openMenu) hideMenu(true);
    else if (selectedProblem) selectProblem(undefined);
  }
});

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------

applyTheme(view.theme);
syncViewMenu();
setProblemsOpen(view.problemsOpen);
renderAll();
renderDiagram(false);
