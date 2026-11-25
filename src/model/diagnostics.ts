/** Diagnostics shared by every stage. Codes and wording follow docs/SPEC.md §9. */

export type Severity = "error" | "warning";

/** 1-based line and column. `end*` are optional and exclusive. */
export interface Span {
  line: number;
  col: number;
  endLine?: number;
  endCol?: number;
}

export interface Diagnostic {
  /** e.g. "E202", "W400" */
  code: string;
  severity: Severity;
  message: string;
  hint?: string;
  span: Span;
}

export function error(code: string, span: Span, message: string, hint?: string): Diagnostic {
  return hint === undefined
    ? { code, severity: "error", message, span }
    : { code, severity: "error", message, hint, span };
}

export function warning(code: string, span: Span, message: string, hint?: string): Diagnostic {
  return hint === undefined
    ? { code, severity: "warning", message, span }
    : { code, severity: "warning", message, hint, span };
}

export function hasErrors(diags: readonly Diagnostic[]): boolean {
  return diags.some((d) => d.severity === "error");
}

/** Sort by line, then column, then code. Stable for equal keys. */
export function sortDiagnostics(diags: readonly Diagnostic[]): Diagnostic[] {
  return [...diags].sort(
    (a, b) => a.span.line - b.span.line || a.span.col - b.span.col || a.code.localeCompare(b.code),
  );
}

/** `file:line:col: severity CODE: message` + optional `  hint: ...` line (SPEC §9.1). */
export function formatDiagnostic(d: Diagnostic, file: string): string {
  const head = `${file}:${d.span.line}:${d.span.col}: ${d.severity} ${d.code}: ${d.message}`;
  return d.hint ? `${head}\n  hint: ${d.hint}` : head;
}
