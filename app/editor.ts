/**
 * The qSFC code editor: CodeMirror 6 with the qSFC tokenizer (app/highlight.ts), lint
 * underlines from the compiler's diagnostics, and completion from app/complete.ts.
 * main.ts owns the compile loop; this module only wires CodeMirror.
 */
import { autocompletion, completionKeymap, snippet, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, indentOnInput, indentService, StreamLanguage, syntaxHighlighting, type StringStream } from "@codemirror/language";
import { lintGutter, lintKeymap, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Diagnostic } from "../src/model/diagnostics.js";
import { completeLine, type CompletionInfo } from "./complete.js";
import { headerOf, ioStateAfter, lineKind, indentAfter, indentStructure, TOKEN_STYLE, tokenizeLine, type Token } from "./highlight.js";
import { spanToRange } from "./nav.js";
import { SNIPPETS, snippetContext, snippetLine, snippetTemplate, templateText, usedNames } from "./snippets.js";

interface LineState {
  line: string | undefined;
  toks: Token[];
  /** The current line is inside an `io … end` block (SPEC §7.6). */
  ioHere: boolean;
  /** The next line is. */
  ioNext: boolean;
}

const qsfcLanguage = StreamLanguage.define<LineState>({
  name: "qsfc",
  startState: () => ({ line: undefined, toks: [], ioHere: false, ioNext: false }),
  copyState: (s) => ({ ...s }),
  token(stream: StringStream, state: LineState): string | null {
    if (stream.sol()) {
      state.ioHere = state.ioNext;
      state.ioNext = ioStateAfter(stream.string, state.ioHere);
    }
    if (stream.sol() || state.line !== stream.string) {
      state.line = stream.string;
      state.toks = tokenizeLine(stream.string, { inIo: state.ioHere });
    }
    const pos = stream.pos;
    const tok = state.toks.find((x) => x.to > pos);
    if (!tok) {
      stream.skipToEnd();
      return null;
    }
    if (tok.from > pos) {
      stream.pos = tok.from;
      return null;
    }
    stream.pos = tok.to;
    return TOKEN_STYLE[tok.kind];
  },
  languageData: { commentTokens: { line: "//" }, indentOnInput: /^\s*(?:--|\||end\b|(?:step|init)\s)/i },
});

/**
 * Indentation (app/highlight.ts): a new line follows the line above (indentAfter); a
 * structure line being re-indented (indentOnInput, below) lines up with its step or branch.
 */
const qsfcIndent = indentService.of((ctx, pos) => {
  const doc = ctx.state.doc;
  const above = (fromLine: number): string[] => {
    const out: string[] = [];
    for (let n = fromLine; n >= 1 && out.length < 400; n--) {
      const text = doc.line(n).text;
      if (text.trim() !== "") out.push(text);
    }
    return out;
  };
  if (ctx.simulatedBreak === pos) {
    // Enter: the text before the break is the line above the new one.
    const before = ctx.lineAt(pos, -1);
    if (before.text.trim() !== "") return indentAfter(before.text, ctx.unit);
    return indentAfter(above(doc.lineAt(before.from).number - 1)[0], ctx.unit);
  }
  const line = doc.lineAt(pos);
  const prev = above(line.number - 1);
  return indentStructure(line.text, prev, ctx.unit) ?? indentAfter(prev[0], ctx.unit);
});

/**
 * Routine header lines (`sfc x`, `st x`) that start a second (or later) routine get a dashed
 * separator above them; a file with one routine looks as before.
 */
const headerLine = Decoration.line({ class: "cm-qsfc-header" });
function headerDecorations(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  let seen = false; // a routine started above (a header, or steps without a header)
  let inIo = false; // inside an `io … end` block (not a routine)
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const wasIo = inIo;
    inIo = ioStateAfter(line.text, inIo);
    if (inIo || (wasIo && lineKind(line.text).kind === "end")) continue;
    const h = headerOf(line.text);
    if (h) {
      if (h.keyword === "program") continue;
      if (seen) b.add(line.from, line.from, headerLine);
      seen = true;
    } else if (!seen && !["blank", "comment", "tag", "meta", "action"].includes(lineKind(line.text).kind)) {
      seen = true;
    }
  }
  return b.finish();
}
const routineHeaders = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = headerDecorations(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged) this.decorations = headerDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

const qsfcHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--syn-kw)", fontWeight: "600" },
  { tag: t.operatorKeyword, color: "var(--syn-stkw)", fontWeight: "600" },
  { tag: t.definition(t.variableName), color: "var(--syn-def)", fontWeight: "600" },
  { tag: t.labelName, color: "var(--syn-label)" },
  { tag: t.special(t.variableName), color: "var(--syn-def)" },
  { tag: t.controlOperator, color: "var(--syn-kw)", fontWeight: "600" },
  { tag: t.unit, color: "var(--syn-num)" },
  { tag: t.number, color: "var(--syn-num)" },
  { tag: t.string, color: "var(--syn-str)" },
  { tag: t.lineComment, color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: t.propertyName, color: "var(--syn-member)" },
  { tag: t.function(t.variableName), color: "var(--syn-func)" },
  { tag: t.typeName, color: "var(--syn-type)" },
  { tag: t.url, color: "var(--syn-num)" },
  { tag: t.operator, color: "var(--syn-op)" },
  { tag: t.variableName, color: "var(--syn-ident)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "13.5px" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--text)", padding: "6px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)", borderLeftWidth: "2px" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": { backgroundColor: "var(--surface-2)", color: "var(--muted)", borderRight: "1px solid var(--border)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--accent-soft)", color: "var(--text)" },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-line.cm-qsfc-header": { borderTop: "1px dashed var(--border-strong)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--selection-match)" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--selection-match)", outline: "1px solid var(--border-strong)" },
  ".cm-tooltip": {
    backgroundColor: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "6px",
    boxShadow: "var(--pop)", overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--mono)", fontSize: "13px", maxHeight: "16em" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "2px 8px" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--accent)", color: "var(--on-accent)" },
  ".cm-tooltip-autocomplete ul li[aria-selected] .cm-completionDetail": { color: "var(--on-accent)" },
  ".cm-completionDetail": { color: "var(--muted)", fontStyle: "normal", marginLeft: "1em", fontFamily: "system-ui, sans-serif", fontSize: "12px" },
  ".cm-completionInfo": { padding: "6px 9px", fontSize: "12.5px", maxWidth: "320px" },
  ".cm-completionInfo pre.qsfc-snippet-preview": { margin: 0, fontFamily: "var(--mono)", fontSize: "12px", lineHeight: "1.4", whiteSpace: "pre" },
  ".cm-snippetField": { backgroundColor: "var(--selection-match)" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "700" },
  ".cm-diagnostic": { padding: "5px 9px", fontSize: "13px", maxWidth: "460px" },
  ".cm-diagnostic-error": { borderLeft: "4px solid var(--err)" },
  ".cm-diagnostic-warning": { borderLeft: "4px solid var(--warn-line)" },
  ".cm-diagnostic .qsfc-diag-code": { fontFamily: "var(--mono)", fontWeight: "600", marginRight: "6px" },
  ".cm-diagnostic-error .qsfc-diag-code": { color: "var(--err)" },
  ".cm-diagnostic-warning .qsfc-diag-code": { color: "var(--warn)" },
  ".cm-diagnostic .qsfc-diag-hint": { display: "block", color: "var(--muted)", marginTop: "2px" },
  ".cm-lintRange-error": {
    backgroundImage: "none", textDecoration: "underline wavy var(--err)", textUnderlineOffset: "3px", textDecorationSkipInk: "none",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none", textDecoration: "underline wavy var(--warn-line)", textUnderlineOffset: "3px", textDecorationSkipInk: "none",
  },
  ".cm-lint-marker": { width: "0.8em", height: "0.8em" },
  ".cm-panels": { backgroundColor: "var(--toolbar)", color: "var(--text)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-search input, .cm-search button": { fontSize: "12.5px" },
  ".cm-textfield": { backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: "4px" },
  ".cm-button": { backgroundImage: "none", backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: "4px" },
  ".cm-searchMatch": { backgroundColor: "var(--warn-soft)", outline: "1px solid var(--warn-line)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--selection)" },
});

export interface EditorCallbacks {
  /** The text changed (user edit or setText). */
  onChange(): void;
  /** The cursor moved to another line (1-based), or the selection changed. */
  onCursor(line: number, col: number): void;
  /** Current completion data (from the last compile). */
  completionInfo(): CompletionInfo;
  /**
   * Go to definition (F12, Ctrl+click): where the name at `pos` (0-based in `lineText`)
   * is defined, as a 1-based line and column, or undefined.
   */
  definition?(lineText: string, pos: number): { line: number; col: number } | undefined;
}

export interface Editor {
  view: EditorView;
  getText(): string;
  /** Replaces the whole text. `resetHistory` starts a fresh undo history (opening a file). */
  setText(text: string, resetHistory?: boolean): void;
  setReadOnly(readOnly: boolean): void;
  setDiagnostics(diags: readonly Diagnostic[]): void;
  /** Cursor to 1-based line and column; scrolls it into view and focuses the editor. */
  goTo(line: number, col?: number, focus?: boolean): void;
  /** Selects from (line, col) to (line, endCol) (1-based, end exclusive) and scrolls it into view. */
  select(line: number, col: number, endCol: number, focus?: boolean): void;
  /** Writes a CodeMirror snippet template on line `line` (1-based), replacing what follows its indentation. */
  insertSnippet(template: string, line: number): void;
  /** The document's lines. */
  lines(): string[];
  focus(): void;
}

function renderDiag(d: Diagnostic): () => Node {
  return () => {
    const box = document.createElement("div");
    const code = document.createElement("span");
    code.className = "qsfc-diag-code";
    code.textContent = d.code;
    box.append(code, document.createTextNode(d.message));
    if (d.hint) {
      const hint = document.createElement("span");
      hint.className = "qsfc-diag-hint";
      hint.textContent = `hint: ${d.hint}`;
      box.append(hint);
    }
    return box;
  };
}

export function createEditor(parent: HTMLElement, cb: EditorCallbacks, extraKeys: Extension = []): Editor {
  const readOnly = new Compartment();
  let lastLine = -1;
  let lastCol = -1;

  /**
   * Snippets (app/snippets.ts) at the start of a line where a step can start (or after the
   * last step): "snippet: timeout → fault"…, inserted with Tab fields.
   */
  const snippetOptions = (ctx: CompletionContext, lineNumber: number, text: string, pos: number): Completion[] => {
    if (!snippetLine(text, pos)) return [];
    if (pos === /^[ \t]*/.exec(text)![0].length && !ctx.explicit) return [];
    const lines = ctx.state.doc.toJSON();
    const where = snippetContext(lines, lineNumber - 1);
    if (!where) return [];
    const used = usedNames(lines, lineNumber - 1);
    return SNIPPETS.map((def): Completion => {
      const template = snippetTemplate(def, where, used);
      return {
        label: `snippet: ${def.label}`,
        detail: def.detail,
        type: "text",
        boost: -4,
        apply: snippet(template),
        info: () => {
          const pre = document.createElement("pre");
          pre.className = "qsfc-snippet-preview";
          pre.textContent = templateText(template);
          return pre;
        },
      };
    });
  };

  const source = (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const pos = ctx.pos - line.from;
    const r = completeLine(line.text, pos, cb.completionInfo(), { explicit: ctx.explicit, lineNumber: line.number });
    const options: Completion[] = (r?.options ?? []).map((o) => {
      const c: Completion = { label: o.label, type: o.type };
      if (o.detail) c.detail = o.detail;
      if (o.info) c.info = o.info;
      if (o.apply) c.apply = o.apply;
      if (o.boost !== undefined) c.boost = o.boost;
      return c;
    });
    const lead = /^[ \t]*/.exec(line.text)![0].length;
    let from = r?.from;
    let to = r?.to;
    if (!r || r.from === lead) {
      const snippets = snippetOptions(ctx, line.number, line.text, pos);
      if (snippets.length) {
        options.push(...snippets);
        from = lead;
        to = pos;
      }
    }
    if (options.length === 0 || from === undefined || to === undefined) return null;
    return { from: line.from + from, to: line.from + to, options, validFor: /^\w*$/ };
  };

  /** Jumps to the definition of the name at document offset `pos`. True when it did. */
  const goToDefinition = (pos: number): boolean => {
    const line = view.state.doc.lineAt(pos);
    const at = cb.definition?.(line.text, pos - line.from);
    if (!at) return false;
    editor.goTo(at.line, at.col, true);
    return true;
  };

  const extensions: Extension[] = [
      extraKeys,
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      EditorState.allowMultipleSelections.of(true),
      bracketMatching(),
      indentOnInput(),
      highlightActiveLine(),
      routineHeaders,
      highlightSelectionMatches(),
      search({ top: true }),
      lintGutter(),
      qsfcLanguage,
      qsfcIndent,
      syntaxHighlighting(qsfcHighlight),
      autocompletion({ override: [source], icons: false, activateOnTypingDelay: 40 }),
      keymap.of([
        ...completionKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...lintKeymap,
        { key: "Mod-/", run: toggleComment },
        { key: "F12", run: (v) => goToDefinition(v.state.selection.main.head) },
        indentWithTab,
      ]),
      readOnly.of(EditorState.readOnly.of(false)),
      theme,
      EditorView.domEventHandlers({
        mousedown(e, v) {
          // Ctrl+click (Cmd+click) on a routine name or a jump target: go to its definition.
          if (e.button !== 0 || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos === null || !goToDefinition(pos)) return false;
          e.preventDefault();
          return true;
        },
      }),
      EditorView.contentAttributes.of({ "aria-label": "qSFC source", spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) cb.onChange();
        if (u.docChanged || u.selectionSet) {
          const head = u.state.selection.main.head;
          const line = u.state.doc.lineAt(head);
          const col = head - line.from + 1;
          if (line.number !== lastLine || col !== lastCol) {
            lastLine = line.number;
            lastCol = col;
            cb.onCursor(line.number, col);
          }
        }
      }),
  ];
  const view = new EditorView({ state: EditorState.create({ doc: "", extensions }), parent });

  const editor: Editor = {
    view,
    getText: () => view.state.doc.toString(),
    setText(text, resetHistory = false) {
      if (resetHistory) {
        const ro = view.state.readOnly;
        view.setState(EditorState.create({ doc: text, extensions }));
        if (ro) editor.setReadOnly(true);
        lastLine = 1;
        lastCol = 1;
        cb.onChange();
        cb.onCursor(1, 1);
        return;
      }
      const head = Math.min(view.state.selection.main.head, text.length);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: EditorSelection.cursor(head) });
    },
    setReadOnly(ro) {
      view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(ro)) });
      view.dom.classList.toggle("cm-readonly", ro);
    },
    setDiagnostics(diags) {
      const doc = view.state.doc;
      const lineFn = (n: number): { from: number; text: string } | undefined => {
        if (n < 1 || n > doc.lines) return undefined;
        const l = doc.line(n);
        return { from: l.from, text: l.text };
      };
      const out: CmDiagnostic[] = diags.map((d) => {
        const r = spanToRange(d.span, lineFn, doc.lines);
        return { from: r.from, to: r.to, severity: d.severity, message: `${d.code} ${d.message}${d.hint ? `\nhint: ${d.hint}` : ""}`, source: d.code, renderMessage: renderDiag(d) };
      });
      view.dispatch(setDiagnostics(view.state, out));
    },
    goTo(line, col = 1, focus = true) {
      const doc = view.state.doc;
      const l = doc.line(Math.min(Math.max(1, line), doc.lines));
      const pos = l.from + Math.min(Math.max(0, col - 1), l.length);
      view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      if (focus) view.focus();
    },
    select(line, col, endCol, focus = false) {
      const doc = view.state.doc;
      const l = doc.line(Math.min(Math.max(1, line), doc.lines));
      const from = l.from + Math.min(Math.max(0, col - 1), l.length);
      const to = l.from + Math.min(Math.max(0, endCol - 1), l.length);
      view.dispatch({ selection: EditorSelection.range(from, Math.max(from, to)), effects: EditorView.scrollIntoView(from, { y: "center" }) });
      if (focus) view.focus();
    },
    insertSnippet(template, line) {
      const doc = view.state.doc;
      const l = doc.line(Math.min(Math.max(1, line), doc.lines));
      const from = l.from + /^[ \t]*/.exec(l.text)![0].length;
      view.focus();
      snippet(template)(view, null, from, l.to);
    },
    lines: () => view.state.doc.toJSON(),
    focus: () => view.focus(),
  };

  return editor;
}
