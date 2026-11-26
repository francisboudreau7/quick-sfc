# Architecture (v2, TypeScript)

The language is defined in [SPEC.md](SPEC.md); the plan is in [PLAN.md](PLAN.md). This file defines the modules, their contracts and the conventions everyone follows.

## Pipeline

```
source text
  │ parse()            src/parse      → Chart (syntax tree) + diagnostics E1xx, E2xx (line-level)
  │ validate()         src/validate   → diagnostics E2xx (structure), E3xx, W3xx
  │ analyzeTags()      src/tags       → TagInfo[] + diagnostics E4xx, W4xx
  │ lower()            src/lower      → Graph   (only when there are no errors so far)
  │ layout()           src/layout     → Layout (grid) → l5xPositions() → L5XPositions
  │ renderAscii()      src/render     → string (CLI `qsfc show`)
  │ writeL5X()         src/l5x        → L5X text (only when there are no errors)
  ▼
src/compile.ts glues the stages; src/cli/main.ts is the CLI.
```

Every stage is a **pure function** (no file I/O, no global state, no `Date.now()` unless injected) so it runs the same in Node (CLI, tests) and in the browser (Phase 2+). File I/O lives only in `src/cli`.

## Shared model (`src/model/`, owned by the lead; change only by agreement)

- `diagnostics.ts`: `Span`, `Diagnostic`, `error()`, `warning()`, `formatDiagnostic()`
- `ast.ts`: `Chart`, `StepNode`, `TransitionNode`, `BranchNode`, `TagDecl`, `key()`, `walk()`
- `graph.ts`: `Graph`, `GStep`, `GTransition`, `GBranch`, `GLink`, `TagInfo`
- `positions.ts`: `L5XPositions`

## Module contracts

| Module | Export | Contract |
|---|---|---|
| `src/parse/index.ts` | `parse(source: string): { chart: Chart; diagnostics: Diagnostic[] }` | Never throws. Always returns a best-effort `Chart`, even with errors (needed for live coding). Assigns auto transition names. |
| `src/validate/index.ts` | `validate(chart: Chart): Diagnostic[]` | Structure and chart rules of SPEC §5-§6 and §3.4 names (steps/transitions). Never throws. |
| `src/tags/index.ts` | `analyzeTags(chart: Chart): { tags: TagInfo[]; diagnostics: Diagnostic[] }`<br>`rewriteStepRefs(text: string, operandByStepKey: Map<string, string>): string` | SPEC §7. `operandByStepKey` maps `key(stepName)` → `"Step_001"`. |
| `src/lower/index.ts` | `lower(chart: Chart): Graph` | Precondition: parse + validate produced no errors. Builds ids, links, branches, automatic convergences (SPEC §6.4). |
| `src/layout/index.ts` | `layout(graph: Graph, chart: Chart): Layout`<br>`l5xPositions(layout: Layout): L5XPositions` | Deterministic. `Layout` is a grid layout (owned by the layout module) shared by the ASCII view, the L5X coordinates and later the SVG view. |
| `src/render/ascii.ts` | `renderAscii(graph: Graph, layout: Layout): string` | SPEC §12. |
| `src/render/svg.ts` | `renderSvg(graph: Graph, layout: Layout, options?: SvgOptions): string` | Window / export diagram (studio and textbook looks), from the same `Layout`. Jump wires are routed at render time by `src/render/route.ts` (side of the leg, lanes hugging the chart, T-junction or top entry, cross-reference when a crossing is unavoidable); automatic convergence bars are not drawn. Never changes the `Layout` or the L5X. |
| `src/l5x/index.ts` | `writeL5X(graph: Graph, positions: L5XPositions, tags: TagInfo[], options: L5XOptions): string`<br>`checkL5X(xml: string): string[]` | Graph actions/conditions arrive **already rewritten**. `checkL5X` is a self-check of a generated file (ids, links, initial step); `[]` = OK. |

## Conventions

- **TypeScript strict.** ES modules, imports with `.js` extension (`import { parse } from "../parse/index.js"`).
- **No runtime dependencies** in `src/` (the HTML file must stay small and offline). Dev tools only: TypeScript, Vitest, tsx.
- **Tests** in `test/<module>/*.test.ts` (Vitest). Shared `.qsfc` fixtures in `test/fixtures/`. Golden files in `test/golden/`.
- **Node.** Every shell needs Node on PATH first:
  ```bash
  cd /c/Users/franc/Documents/aube/quick_SFC/quick-sfc && eval "$(fnm env --shell bash)" && fnm use >/dev/null
  npx vitest run test/parse        # one module
  npx tsc --noEmit                 # typecheck
  ```
- Diagnostic codes and message wording come from SPEC §9.2. Spans are 1-based.
- The Python code in `legacy/` is reference only: never import it or run it in tests.
