/**
 * The Help view (mockup docs/mockups/help): Learning qSFC, Reference and the cheat sheet, over
 * the editor. Pages are example-first; each example is a playground (the app's editor and
 * diagram; edits are never saved). Content: app/help/content.ts, app/help/problems.ts.
 */
import type { CompileResult } from "../../src/compile.js";
import { programStepNames } from "../../src/model/ast.js";
import { hasErrors, type Diagnostic } from "../../src/model/diagnostics.js";
import type { SimDraw } from "../../src/render/svg.js";
import { Simulator } from "../../src/sim/index.js";
import type { CompletionInfo } from "../complete.js";
import type { Editor, EditorCallbacks } from "../editor.js";
import { activeLines, clockText, simDraw } from "../sim.js";
import { LESSONS, REFERENCE, REFERENCE_GROUPS, findEntry, findLesson, searchReference } from "./content.js";
import { codeHtml, compileExample, diagramsHtml, escapeHtml, inline, learningPage, referencePage } from "./page.js";
import { PROBLEM_GROUPS, findProblem } from "./problems.js";

export type HelpTab = "learning" | "reference" | "cheatsheet";

export interface HelpDeps {
  makeEditor(parent: HTMLElement, cb: EditorCallbacks): Editor;
  completionFor(r: CompileResult | undefined): CompletionInfo;
  /** Routine `i` of `r` as the app draws it (look, numbers, actions from View), live when simulating. */
  svg(r: CompileResult, i: number, sim?: SimDraw): string;
  openInEditor(source: string, label: string): void;
  /** The cheat sheet page (docs/cheatsheet.html). */
  cheatsheetHtml: string;
  /** Opens an HTML page in a new tab (or downloads it). */
  openPage(html: string, fileName: string): void;
  /** Called after the view closes (focus back to the editor). */
  onClose(): void;
}

export interface Help {
  open(tab: HelpTab, id?: string): void;
  close(): void;
  readonly isOpen: boolean;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const button = (label: string, cls = "btn"): HTMLButtonElement => {
  const b = h("button", cls);
  b.type = "button";
  b.textContent = label;
  return b;
};

/** A live example: editable code, the diagram and the problems follow as you type. Run simulates it. */
class Playground {
  readonly root = h("div", "help-pg");
  private editor: Editor;
  private result: CompileResult | undefined;
  private timer: number | undefined;
  private readonly dia = h("div", "help-pg-dia");
  private readonly problems = h("ul", "help-pg-problems");
  private readonly codeHost = h("div", "help-pg-code");
  private readonly runBtn = button("▶ Run");
  private readonly strip = h("div", "help-pg-sim");
  private sim: Simulator | undefined;
  private simTimer: number | undefined;

  constructor(
    private source: string,
    private readonly deps: HelpDeps,
    label: string,
  ) {
    const bar = h("div", "help-pg-bar");
    bar.append(h("span", "help-pg-title", "Playground"), h("span", "help-pg-note", "edit me: the diagram follows"), h("span", "sp"));
    const reset = button("Reset");
    reset.addEventListener("click", () => this.load(this.source));
    const open = button("Open in the editor", "btn primary");
    open.title = "Copy this example to a new, unsaved file";
    open.addEventListener("click", () => deps.openInEditor(this.editor.getText(), label));
    this.runBtn.title = "Simulate this example: toggle the inputs, watch the steps";
    this.runBtn.addEventListener("click", () => (this.sim ? this.stop() : this.run()));
    bar.append(reset, this.runBtn, open);
    const body = h("div", "help-pg-body");
    body.append(this.codeHost, this.dia);
    this.strip.hidden = true;
    this.root.append(bar, body, this.strip, this.problems);
    this.dia.addEventListener("click", (e) => this.diagramClick(e));
    this.editor = deps.makeEditor(this.codeHost, {
      onChange: () => this.schedule(),
      onCursor: () => undefined,
      completionInfo: () => deps.completionFor(this.result),
    });
    this.load(source);
  }

  /** Replaces the code (Reset, or a problem's example). */
  load(source: string, keep = false): void {
    this.stop();
    if (!keep) this.source = source;
    this.editor.setText(source, true);
    this.sizeEditor();
    this.compileNow();
  }

  private sizeEditor(): void {
    const lines = this.editor.lines().length;
    this.codeHost.style.height = `${Math.max(140, Math.min(560, lines * 20 + 34))}px`;
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.sizeEditor();
      this.compileNow();
    }, 150);
  }

  private compileNow(): void {
    let r: CompileResult;
    try {
      r = compileExample(this.editor.getText());
    } catch {
      return;
    }
    this.result = r;
    this.editor.setDiagnostics(r.diagnostics);
    this.editor.setStepNames(programStepNames(r.program));
    this.drawDiagram();
    this.renderProblems(r.diagnostics);
  }

  private drawDiagram(): void {
    const r = this.result;
    if (!r) return;
    const sim = this.sim;
    const html = diagramsHtml(r, (res, i) => {
      const routine = res.routines[i]!;
      const live = sim ? simDraw(sim, routine) : undefined;
      return `<div data-routine="${escapeHtml(routine.name)}">${this.deps.svg(res, i, live)}</div>`;
    });
    if (html) {
      this.dia.innerHTML = html;
      this.dia.classList.remove("stale");
    } else this.dia.classList.add("stale");
  }

  /** Run: the same simulation as the app's (SPEC §9.3), inputs as toggles under the code. */
  private run(): void {
    const r = this.result;
    if (!r || hasErrors(r.diagnostics) || !r.routines.some((x) => x.graph)) {
      this.strip.hidden = false;
      this.strip.replaceChildren(h("span", "help-pg-sim-note", "Fix the problems first: then Run simulates the chart."));
      return;
    }
    this.sim = new Simulator(r);
    this.sim.scan();
    this.editor.setReadOnly(true);
    this.runBtn.textContent = "■ Stop";
    this.runBtn.classList.add("on");
    this.root.classList.add("sim-on");
    this.simTimer = window.setInterval(() => {
      this.sim?.scan();
      this.renderSim();
    }, this.sim.scanMs);
    this.renderSim();
  }

  private stop(): void {
    window.clearInterval(this.simTimer);
    this.simTimer = undefined;
    this.strip.hidden = true;
    this.strip.replaceChildren();
    if (!this.sim) return;
    this.sim = undefined;
    this.editor.setReadOnly(false);
    this.editor.setSimLines([], []);
    this.runBtn.textContent = "▶ Run";
    this.runBtn.classList.remove("on");
    this.root.classList.remove("sim-on");
    this.drawDiagram();
  }

  private renderSim(): void {
    const s = this.sim;
    const r = this.result;
    if (!s || !r) return;
    this.drawDiagram();
    const lines = activeLines(s, r.routines);
    this.editor.setSimLines(lines.steps, lines.actions);
    this.strip.hidden = false;
    // a number field being typed in keeps its text
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement && this.strip.contains(focused)) return;
    const parts: HTMLElement[] = [h("span", "help-pg-sim-clock", escapeHtml(`▶ ${clockText(s.time, s.scans)}`))];
    const tags = s.tagList();
    const ins = tags.filter((t) => t.input);
    const outs = tags.filter((t) => !t.input && t.type === "BOOL");
    if (ins.length) parts.push(h("span", "help-pg-sim-label", "Inputs:"));
    for (const t of ins) {
      if (t.type === "BOOL") {
        const b = button(`${t.name} ${t.value ? 1 : 0}`, `live-sw help-pg-sw${t.value ? " on" : ""}`);
        b.title = "Click to toggle, Shift+click for one scan";
        b.addEventListener("click", (e) => {
          if (e.shiftKey) s.pulse(t.name);
          else s.toggle(t.name);
          this.renderSim();
        });
        parts.push(b);
      } else {
        const wrap = h("label", "help-pg-num", escapeHtml(t.name));
        const inp = document.createElement("input");
        inp.type = "number";
        inp.className = "live-num";
        inp.value = String(t.value);
        inp.addEventListener("change", () => {
          s.setTag(t.name, Number(inp.value) || 0);
          inp.blur();
          this.renderSim();
        });
        wrap.append(inp);
        parts.push(wrap);
      }
    }
    if (outs.length) parts.push(h("span", "help-pg-sim-label", "Outputs:"));
    for (const t of outs) {
      const o = h("span", "help-pg-out");
      o.append(h("span", `live-lamp${t.value ? " on" : ""}`), document.createTextNode(t.name));
      parts.push(o);
    }
    this.strip.replaceChildren(...parts);
  }

  /** While running: an input toggles (Shift: one scan), a transition whose steps are active fires. */
  private diagramClick(e: MouseEvent): void {
    const s = this.sim;
    if (!s) return;
    const t = e.target as Element | null;
    const input = t?.closest("[data-input]")?.getAttribute("data-input");
    if (input) {
      if (e.shiftKey) s.pulse(input);
      else s.toggle(input);
      this.renderSim();
      return;
    }
    const id = t?.closest(".qsfc-transition")?.getAttribute("data-id");
    const routine = t?.closest("[data-routine]")?.getAttribute("data-routine");
    if (!id || !routine) return;
    if (!s.fire(routine, id)) {
      s.scan();
      this.renderSim();
    }
  }

  private renderProblems(diags: readonly Diagnostic[]): void {
    if (!diags.length) {
      this.problems.replaceChildren(h("li", "ok", "No problems"));
      return;
    }
    this.problems.replaceChildren(
      ...diags.map((d) => {
        const li = h("li", d.severity);
        const b = button("", "help-pg-problem");
        b.innerHTML = `<b>${d.code}</b> line ${d.span.line}: ${escapeHtml(d.message)}${d.hint ? ` <span class="hint">${escapeHtml(d.hint)}</span>` : ""}`;
        b.addEventListener("click", () => this.editor.goTo(d.span.line, d.span.col, true));
        li.append(b);
        return li;
      }),
    );
  }

  destroy(): void {
    this.stop();
    window.clearTimeout(this.timer);
    this.editor.view.destroy();
  }
}

export function createHelp(root: HTMLElement, deps: HelpDeps): Help {
  let tab: HelpTab = "learning";
  const place: Record<HelpTab, string> = { learning: LESSONS[0]!.id, reference: REFERENCE[0]!.id, cheatsheet: "" };
  let playground: Playground | undefined;
  let open = false;
  let query = "";

  // ---- chrome ----
  const chrome = h("div", "help-chrome");
  const back = button("← Back to the editor", "help-back");
  back.addEventListener("click", () => close());
  const tabs = h("div", "help-tabs");
  tabs.setAttribute("role", "tablist");
  const tabButtons = new Map<HelpTab, HTMLButtonElement>();
  for (const [t, label] of [["learning", "Learning"], ["reference", "Reference"], ["cheatsheet", "Cheat sheet"]] as const) {
    const b = button(label, "help-tab");
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => show(t));
    tabButtons.set(t, b);
    tabs.append(b);
  }
  const print = button("Print / open as a page", "btn");
  print.addEventListener("click", () => {
    if (tab === "learning") deps.openPage(learningPage(), "qsfc-learning.html");
    else if (tab === "reference") deps.openPage(referencePage(), "qsfc-reference.html");
    else deps.openPage(deps.cheatsheetHtml, "qsfc-cheatsheet.html");
  });
  chrome.append(back, tabs, h("span", "sp"), print);

  const toc = h("nav", "help-toc");
  toc.setAttribute("aria-label", "Contents");
  const pageEl = h("main", "help-page");
  pageEl.tabIndex = -1;
  const cols = h("div", "help-cols");
  cols.append(toc, pageEl);
  root.replaceChildren(chrome, cols);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented && !(e.target as HTMLElement).closest(".cm-tooltip-autocomplete")) {
      e.preventDefault();
      close();
    }
  });

  // ---- navigation ----
  function show(t: HelpTab, id?: string): void {
    tab = t;
    if (id !== undefined) place[t] = id;
    for (const [k, b] of tabButtons) {
      b.classList.toggle("on", k === t);
      b.setAttribute("aria-selected", String(k === t));
    }
    root.classList.toggle("help-sheet", t === "cheatsheet");
    renderToc();
    renderPage();
  }

  function tocLink(label: string, id: string, active: boolean, num?: number): HTMLLIElement {
    const li = h("li", active ? "on" : "");
    const b = button("", "help-toc-link");
    b.innerHTML = `${num !== undefined ? `<span class="n">${num}</span>` : ""}${escapeHtml(label)}`;
    if (active) b.setAttribute("aria-current", "page");
    b.addEventListener("click", () => show(tab, id));
    li.append(b);
    return li;
  }

  function renderToc(): void {
    if (tab === "cheatsheet") {
      toc.replaceChildren();
      return;
    }
    if (tab === "learning") {
      const ol = h("ol");
      LESSONS.forEach((l, i) => ol.append(tocLink(l.title, l.id, place.learning === l.id, i + 1)));
      toc.replaceChildren(h("div", "help-toc-h", "Learning qSFC"), ol);
      return;
    }
    const search = h("input", "help-search");
    search.type = "search";
    search.placeholder = "Search the reference";
    search.value = query;
    search.setAttribute("aria-label", "Search the reference");
    const list = h("div");
    const fill = (): void => {
      const found = new Set(searchReference(query).map((e) => e.id));
      list.replaceChildren();
      for (const g of REFERENCE_GROUPS) {
        const items = REFERENCE.filter((e) => e.group === g && found.has(e.id));
        if (!items.length) continue;
        const ul = h("ul");
        for (const e of items) ul.append(tocLink(e.title, e.id, place.reference === e.id));
        list.append(h("div", "help-toc-h", g), ul);
      }
      if (!query.trim() || "problems codes errors warnings".includes(query.trim().toLowerCase()) || /^[ew]\d/i.test(query.trim())) {
        const ul = h("ul");
        ul.append(tocLink("Every message, by code", "problems", place.reference === "problems"));
        list.append(h("div", "help-toc-h", "Problems"), ul);
      }
      if (!list.childElementCount) list.append(h("p", "help-muted", "Nothing found."));
    };
    search.addEventListener("input", () => {
      query = search.value;
      fill();
      const code = /^[ew]\d{3}$/i.test(query.trim()) ? query.trim().toUpperCase() : undefined;
      if (code && findProblem(code)) {
        place.reference = "problems";
        renderPage(code);
      }
    });
    fill();
    toc.replaceChildren(search, list);
  }

  function setPlayground(source: string, label: string): HTMLElement {
    playground?.destroy();
    playground = new Playground(source, deps, label);
    return playground.root;
  }

  function renderPage(problemCode?: string): void {
    playground?.destroy();
    playground = undefined;
    pageEl.replaceChildren();
    if (tab === "cheatsheet") {
      const frame = h("iframe", "help-sheet-frame");
      frame.title = "qSFC cheat sheet";
      frame.srcdoc = deps.cheatsheetHtml;
      pageEl.append(frame);
      return;
    }
    if (tab === "learning") renderLesson();
    else if (place.reference === "problems") renderProblems(problemCode);
    else renderEntry();
    pageEl.scrollTo(0, 0);
  }

  function renderLesson(): void {
    const i = Math.max(0, LESSONS.findIndex((l) => l.id === place.learning));
    const l = LESSONS[i]!;
    pageEl.append(
      h("div", "help-crumb", `Lesson ${i + 1} of ${LESSONS.length}`),
      h("h2", "", escapeHtml(l.title)),
      h("p", "help-lead", inline(l.lead)),
      setPlayground(l.example, l.title),
    );
    const sum = h("div", "help-summary");
    for (const [c, t] of l.summary) sum.append(h("code", "", escapeHtml(c)), h("span", "", inline(t)));
    pageEl.append(sum);
    const tryBox = h("div", "help-try");
    tryBox.append(h("h3", "", "Try this"));
    const ol = h("ol");
    for (const t of l.tries) {
      const li = h("li", "", inline(t.prompt));
      if (t.solution) {
        const sol = h("div", "help-solution", codeHtml(t.solution));
        sol.hidden = true;
        const b = button("Show a solution", "btn help-sol");
        b.addEventListener("click", () => {
          sol.hidden = !sol.hidden;
          b.textContent = sol.hidden ? "Show a solution" : "Hide the solution";
        });
        li.append(" ", b, sol);
      }
      ol.append(li);
    }
    tryBox.append(ol);
    pageEl.append(tryBox);
    const pager = h("div", "help-pager");
    const prev = LESSONS[i - 1];
    const next = LESSONS[i + 1];
    const link = (l2: typeof prev, label: string, cls: string): HTMLElement => {
      if (!l2) return h("span");
      const b = button(label, `help-link ${cls}`);
      b.addEventListener("click", () => show("learning", l2.id));
      return b;
    };
    pager.append(link(prev, `← ${prev?.title ?? ""}`, "prev"), link(next, `${next?.title ?? ""} →`, "next"));
    pageEl.append(pager);
  }

  function renderEntry(): void {
    const e = findEntry(place.reference) ?? REFERENCE[0]!;
    pageEl.append(h("div", "help-crumb", `Reference · ${escapeHtml(e.group)}`), h("h2", "", escapeHtml(e.title)), h("div", "", codeHtml(e.syntax)));
    if (e.example) pageEl.append(setPlayground(e.example, e.title));
    pageEl.append(h("h3", "", "Rules"));
    const ul = h("ul", "help-rules");
    for (const r of e.rules) ul.append(h("li", "", inline(r)));
    pageEl.append(ul);
    if (e.problems.length) {
      pageEl.append(h("h3", "", "Problems you may see"));
      const table = h("table", "help-codes");
      for (const c of e.problems) {
        const p = findProblem(c);
        const tr = h("tr");
        const ex = button("example", "help-link");
        ex.addEventListener("click", () => {
          place.reference = "problems";
          renderToc();
          renderPage(c);
        });
        tr.append(h("td", "", `<b>${c}</b>`), h("td", "", p ? inline(p.what) : ""), h("td", "", ""));
        tr.lastElementChild!.append(ex);
        table.append(tr);
      }
      pageEl.append(table);
    }
    if (e.see.length) {
      const p = h("p", "help-also", "See also: ");
      e.see.forEach((id, k) => {
        const s = findEntry(id);
        if (!s) return;
        if (k) p.append(" · ");
        const b = button(s.title, "help-link");
        b.addEventListener("click", () => show("reference", id));
        p.append(b);
      });
      pageEl.append(p);
    }
  }

  function renderProblems(code?: string): void {
    const first = (code && findProblem(code)) || PROBLEM_GROUPS[0]!.items[0]!;
    pageEl.append(
      h("div", "help-crumb", "Reference · Problems"),
      h("h2", "", "Every message, by code"),
      h("p", "help-lead", "Click <b>Try it</b> to load a chart that gives the message, then fix it."),
    );
    const current = h("div", "help-problem-now");
    const pg = setPlayground(first.example, first.code);
    const showNow = (c: string): void => {
      const p = findProblem(c)!;
      current.innerHTML = `<b>${p.code}</b> ${inline(p.what)} <span class="help-muted">Fix: ${inline(p.fix)}</span>${p.exportOnly ? ' <span class="help-muted">(shown when exporting)</span>' : ""}`;
    };
    showNow(first.code);
    pageEl.append(current, pg);
    for (const g of PROBLEM_GROUPS) {
      pageEl.append(h("h3", "", escapeHtml(g.title)));
      const table = h("table", "help-codes");
      for (const p of g.items) {
        const tr = h("tr", p.code === first.code ? "on" : "");
        tr.dataset["code"] = p.code;
        const tryIt = button("Try it", "help-link");
        tryIt.addEventListener("click", () => {
          playground?.load(p.example);
          showNow(p.code);
          for (const row of pageEl.querySelectorAll<HTMLElement>("tr[data-code]")) row.classList.toggle("on", row.dataset["code"] === p.code);
          current.scrollIntoView({ block: "start", behavior: "smooth" });
        });
        tr.append(h("td", "", `<b>${p.code}</b>`), h("td", "", inline(p.what)), h("td", "help-muted", inline(p.fix)), h("td"));
        tr.lastElementChild!.append(tryIt);
        table.append(tr);
      }
      pageEl.append(table);
    }
    if (code) current.scrollIntoView({ block: "start" });
  }

  // ---- open / close ----
  function openHelp(t: HelpTab, id?: string): void {
    if (id !== undefined && t === "learning" && !findLesson(id)) id = undefined;
    root.hidden = false;
    open = true;
    document.body.classList.add("help-open");
    show(t, id);
    (tabButtons.get(t) ?? back).focus();
  }

  function close(): void {
    if (!open) return;
    playground?.destroy();
    playground = undefined;
    root.hidden = true;
    open = false;
    document.body.classList.remove("help-open");
    deps.onClose();
  }

  return {
    open: openHelp,
    close,
    get isOpen() {
      return open;
    },
  };
}
