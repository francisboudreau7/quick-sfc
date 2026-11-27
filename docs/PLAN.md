# QuickSFC Studio: Phase 0 planning draft

Status: **all Phase 0 questions answered** (2026-11-25). Nothing has been implemented. The language spec draft is in [SPEC.md](SPEC.md), waiting for review.

## 0. Decisions so far

| # | Decision |
|---|---|
| Q1 | Norm = **IEC 61131-3** (PLC languages, SFC part). **GRAFCET (IEC 60848)** is included where it maps onto SFC (see §3.4) |
| Q3 | L5X export scope = **Program** (the verified format) |
| Q4/Q5 | **TypeScript, delivered as a single offline HTML file.** Must work in **Edge, Chrome and Firefox**. An `.exe` is not needed |
| Q6 | **Tags are auto-created**, with no declarations required. A live tag list plus autocomplete prevents typos (see §3.5) |
| Q2 | Studio 5000 version unknown: **default v32.01**, with a setting to change it |
| Q7 | L5X operands keep **Studio's defaults** (`Step_000`, `Tran_000`, `Action_000`); the qSFC name goes in the Description. On export the tool rewrites `fill.DN` to `Step_001.DN`; on import it reads the names back from the descriptions |
| Q8 | A jump onto a step that already has an incoming transition gets an **automatic selection convergence** (IEC-conform) |
| Q9 | Syntax = **"Mix 1" with optional transition names** (step keywords from A, transition and jump symbols from B), see §3.6 |
| Q10 | **Phase 1: one action per step** (qualifier N, one or several ST lines). Several actions and the other qualifiers come in a later phase |
| Q11 | **No converter** for old `.qsfc` files; the repo's test cases are rewritten by hand |
| Q12 | **Same GitHub repo (quick-sfc), new major version** on a branch; the Python code moves to `legacy/`, and the branch is merged when Phase 1 passes |
| Q13 | UI in **English only** |
| Q14 | Diagram look: **textbook IEC/GRAFCET (Look B)**, chosen from the Phase 2 mockups. Step names by default, with a GRAFCET numbering option |
| Q15 | **Both renderings**: ASCII in the CLI (`qsfc show`) from Phase 1, a drawn SVG diagram in the app from Phase 2, plus "copy as text" |
| new | **PLCopen XML import and export** are added to the future work |
| R1 | (2026-11-25) **Several routines per file**: a `sfc name` or `st name` line starts a routine, which runs to the next header; one file = one Program; optional `program name` line |
| R2 | **The first routine is the main routine** (`MainRoutineName`) |
| R3 | Calls are written **`call name;`**, exported as `JSR(name,0);`; Studio's `JSR(name, 0);` is accepted too |
| R4 | Diagram pane: **routine tabs that follow the cursor**; an ST routine shows a call summary |
| R5 | **Ladder routines come later** (Phase 5), in Studio's neutral text |
| R6 | (2026-11-26) **Rename: later.** The name qSFC / QuickSFC stays for now; it undersells the tool once files hold ST and ladder. Candidates found free of automation clashes (web, GitHub and a quick US trademark search): **sMate** (files `.smate`; the "s" for step, sequence, structured text, and Quebec *smatte* = clever), Scribomate (*scribe* + French *automate*). Rejected: qPLC (an existing PLC language), qIEC (Qt IEC 60870 libraries), Logimate (a Seco PLC), FemtoPLC (existing PLC projects), Zepto/Yocto/Pico/Atto (big brands). Decide before v2 replaces `main`; keep opening `.qsfc` after a rename

---

## 1. Does this already exist?

Short answer: **no.** Some pieces exist, but nothing combines "type SFC as text, see the diagram live, export to Studio 5000".

| Project | What it is | Useful to us? |
|---|---|---|
| [Schematex](https://schematex.js.org/docs/sfc) | Open-source JS library that draws a subset of IEC 61131-3 SFC from text | The closest match. It only draws diagrams: no L5X, no norm checks, no editor. Worth a look for layout ideas. Its license still needs checking |
| [Beremiz](https://beremiz.readthedocs.io/en/latest/standards.html) / [OpenPLC Editor](https://www.github.com/thiagoralves/OpenPLC_Editor) | Full open-source IEC 61131-3 IDEs (Python/wxPython) with a graphical SFC editor, saving to PLCopen XML | Not text-first, and GPL. **PLCopen XML (now IEC 61131-10)** is the vendor-neutral exchange format, so it is the natural second export target for "platform agnostic" |
| [PLCopen textual SFC](https://www.plcopen.org/sites/default/files/downloads/sfc_textual.pdf) (IEC 61131-3 clause 2.6) | The standard's own text form: `INITIAL_STEP ... END_STEP`, `TRANSITION FROM a TO b := cond; END_TRANSITION` | Exact, but slow to write and hard to read (it lists graph edges, not a flow). Good as a **reference for which concepts we must support**, not as the user-facing syntax |
| [GrafCet2](https://github.com/Cube707/GrafCet2), CTAN `grafcet`, [GoJS SFC sample](https://gojs.net/2.3.17/samples/sequentialFunction.html) | Drawing tools / samples | Visual reference only |
| [Mermaid](https://github.com/mermaid-js/mermaid) | Text-to-diagram with live editor | Same user experience idea, but no SFC diagram type. Its live editor is a good model for Phase 3 |
| L5X generators ([DMC article](https://www.dmcinfo.com/blog/21432/writing-rockwell-ladder-logic-in-xml/), assorted GitHub repos) | Mostly ladder | None handle SFC. **Your own `aube\l5x\l5xgen.py` is the best L5X writer I found**: it has passed real Studio 5000 v32.01 imports |

**Conclusion:** we build it ourselves. We reuse the knowledge in `L5X_GUIDE.md` and `l5xgen.py`, which is verified against real imports, and we take user-experience ideas from Mermaid.

---

## 2. Review of the current repo (quick-sfc @ e1c2462)

I cloned it to a scratch folder, ran the tests, and fed it edge cases. Findings, all **reproduced by running the code**:

### 2.1 Bugs that would block us
1. **Charts with more than one branch get a broken layout.** With two selection branches in a row, the last step lands at the same X/Y as the initial step, and the loop-back transition lands on top of a branch line. The layout looks up "the converge branch" by flow type only, so it always finds the first one. Studio 5000 would import overlapping elements.
2. **Nested branches are impossible.** A selection inside a parallel leg gives `Unexpected token in branch`. The parser tracks branches with flags (`inside_branch`, `after_convergence`) and sorts by line number, so it cannot nest. This is in the design, not a one-line fix.
3. **Crashes instead of error messages.** Two steps in a row raise `AttributeError: 'Step' object has no attribute 'add_outgoing_step'` (parser.py:251). Some selection branch shapes raise `IndexError` (parser.py:539). `print_summary()` crashes. `_consume()` uses an undefined variable. `_check_behind()` checks the current token instead of the previous one.
4. **Actions are silently lost.** `S@a(motor_on)` (no `;`) is treated as a comment and never exported. No warning is shown.
5. **Multi-line ST is impossible.** A newline ends the action, so `IF ... END_IF` blocks cannot be written.
6. **Test suite:** 10 of 40 tests fail. Some probably use an older syntax, as you said; others are the bugs above. The rules doc and the parser also disagree in places: `│` vs `|`, an undocumented `>>`, and `-> S@x(...)` only works inside selection legs.

### 2.2 L5X exporter vs. your verified `L5X_GUIDE.md`
| Item | Current exporter | Verified rule |
|---|---|---|
| Encoding | no BOM, LF | UTF-8 **with BOM**, **CRLF** |
| Program `MainRoutineName` | missing, so the SFC never runs after import | set it |
| ST / descriptions | escaped text (`a &lt; b`) | `CDATA` |
| `Owner` attribute | `"QuickSFC"` | leave out |
| Tags used in conditions/actions (`start_btn`...) | **never declared** | every operand declared |
| Step names | operands are `Step_000`... and the name only goes in the description | kept that way (Q7), but `fill.DN` in conditions must be rewritten to `Step_001.DN` |
| Actions | one per step, always `NonStored` | Studio supports several per step with qualifiers |
| Jumps (`-> @init`) | a step can end up with 2 incoming transitions and no selection convergence | **not IEC-conform**; Studio's reaction is unverified |

### 2.3 Verdict
The pieces worth keeping are the **ideas** (named steps, jumps, the branch concept), the **test cases**, and the **verified L5X knowledge**. The parser, the model and the layout need a **rewrite, not a patch**:
- a real syntax tree (a sequence of steps, transitions and branches, where each branch holds legs that are sequences again), which gives nesting for free
- a separate validation pass for IEC 61131-3 rules
- one layout engine shared by the on-screen diagram **and** the L5X X/Y coordinates, so Studio 5000 shows the same picture as our tool

Since we rewrite the core anyway, **now is the cheapest moment to choose the language** (see §4).

---

## 3. Syntax review and proposal

### 3.1 What slows down or confuses the current syntax
- **`S@name(...)`, `T@name(...)`**: the `@`, the parentheses and the prefix are noise. Most typing is punctuation.
- **Action vs. comment depends on whether there is a `;`**: hidden rule, silent data loss (bug 4).
- **`/\  \/  //\\  \\//`**: hard to type, easy to confuse, and backslashes cause escaping problems (I hit this myself while writing tests).
- `END` adds nothing. `#` comments clash with ST literals like `16#FF`. ST already has `//` and `(* *)`.
- **Missing for IEC 61131-3 and Studio 5000:** action **qualifiers** (N, S, R, L, D, P, P0, P1, SD, DS, SL), **several actions per step**, **multi-line ST**, preset units (`5s` instead of `5000`), step/transition **descriptions**, tag declarations, nesting.

### 3.2 Same chart in three syntaxes (for comparison)

**Current:**
```
SI@idle(motor:=0;)
T@start(start_btn AND safety_ok)
S@fill(valve[:=]1;, 5000)
T@full(fill.DN)
S@check()
/\
T@good(quality_ok)
S@pack(packer[:=]1;)
T@packed(pack_done) -> @idle
|
T@bad(NOT quality_ok)
S@reject(pusher[:=]1;)
T@rejected(reject_done) -> @idle
END
```

**Proposal A: keywords** (reads like code, easy to learn)
```
sfc FillAndCheck

init Idle
  N  Motor := 0;
trans Start: StartBtn AND SafetyOk
step Fill 5s  "Fill the tank"
  N  Valve [:=] 1;
trans Full: Fill.DN
step Check
select
  trans Good: QualityOk
  step Pack
    N  Packer [:=] 1;
  trans Packed: PackDone
  jump Idle
|
  trans Bad: NOT QualityOk
  step Reject
    N  Pusher [:=] 1;
  trans Rejected: RejectDone
  jump Idle
end
```

**Proposal B: diagram-like symbols** (fastest to type; looks like the chart: double box = initial step, bar = transition)
```
sfc FillAndCheck

[[Idle]]
  N  Motor := 0;
-- Start: StartBtn AND SafetyOk
[Fill] 5s  "Fill the tank"
  N  Valve [:=] 1;
-- Full: Fill.DN
[Check]
select
  -- Good: QualityOk
  [Pack]
    N  Packer [:=] 1;
  -- Packed: PackDone
  -> Idle
|
  -- Bad: NOT QualityOk
  [Reject]
    N  Pusher [:=] 1;
  -- Rejected: RejectDone
  -> Idle
end
```

Rules shared by A and B (all open to discussion):
- **One element per line.** Indentation is optional and only cosmetic, so a bad indent never breaks parsing. That matters for live coding, where the text is half-typed most of the time.
- **Actions are the lines under a step**, starting with a qualifier: `N`, `S`, `R`, `L 2s`, `D 1s`, `P`, `P1`, `P0`, `SD 1s`, `DS 1s`, `SL 1s`. Multi-line body: `N { ... }`.
- **Branches are blocks:** `select ... | ... end` (OR) and `parallel ... | ... end` (AND). They nest freely. The validator enforces the IEC rules: a selection leg starts with a transition, a parallel leg starts and ends with a step, and so on.
- **One jump operator** (`jump X` / `-> X`). An explicit selection convergence is added automatically when needed (see Q8).
- **Comments with `//`**, like ST. A `"string"` after a step or transition becomes its description in L5X.
- Steps and transitions must alternate. The tool says so clearly when they don't, at the exact line.
- Optional `tags` block for declarations (see Q6).
- Old `.qsfc` files: a converter is possible if you have many (Q11).

### 3.3 Q9 explained: the separate choices

**Code vs. diagram, to avoid confusion.** The box drawings in the repo's `QUICK_SFC_RULES.md` (`┌───┐ │ SI@idle │`) are **diagrams**, not code. Proposals A and B above are **new code syntaxes** that I wrote for discussion; neither exists in the repo. B borrows the idea of a box for a step (`[Fill]`), but it is still code that gets parsed, not a picture. If code that looks like a diagram is confusing, that counts against B. The diagram itself (ASCII or drawn) is a separate question: Q15.

**Option C: keep qSFC and only fix it.** Same `SI@` / `S@` / `T@` / `->` / `/\` style, with these changes:
1. Everything inside a step's parentheses is the action: no more "`;` means action, no `;` means comment" rule. Comments use `//`.
2. Extra actions, qualifiers and multi-line ST go on indented lines under the step.
3. The preset takes units: `5s`, `500ms`.
4. Every branch closes with its closer (`\/`, `\\//`), even when all legs jump. Nesting needs this.
5. `END` becomes optional; `>>` is removed (`->` is the only jump).

```
SI@idle(motor := 0;)
T@start(start_btn AND safety_ok)
S@fill(valve [:=] 1;, 5s)
T@full(fill.DN)
S@check()
/\
    T@good(quality_ok)
    S@pack(packer [:=] 1;)
    T@packed(pack_done) -> @idle
|
    T@bad(NOT quality_ok)
    S@reject(pusher [:=] 1;)
        L 10s  horn [:=] 1;
    T@rejected(reject_done) -> @idle
\/
```

If you pick C, you're done with Q9. If you prefer a new syntax (A, B or a mix), the choices below apply.

The new-syntax choice breaks down into six small ones. For each, pick a column or mix them. **(R)** marks my recommendation.

**a) How a step is written**
| Words | Short letters | Box symbols (R) |
|---|---|---|
| `step Fill` | `S Fill` | `[Fill]` |
| `init Idle` | `SI Idle` | `[[Idle]]` |

Box symbols look like the diagram (a double box is the IEC sign for the initial step) and can't collide with anything in ST. Short letters are a trap: `S` is also the "Stored" action qualifier, so a line `S Fill` under a step would be ambiguous.

**b) How a transition is written**
| Words | Short letters | Bar symbol (R) |
|---|---|---|
| `trans Start: StartBtn AND SafetyOk` | `T Start: StartBtn AND SafetyOk` | `-- Start: StartBtn AND SafetyOk` |

**c) Are transition names required?**
| Required | Optional (R) |
|---|---|
| `-- Start: StartBtn` | `-- StartBtn` → named automatically `T1`, `T2`, ... |

Steps always need a name (jumps and `Fill.DN` refer to it); transitions rarely do. The parser tells the two apart because `Name:` (a name followed by `:` but not `:=`) can never start an ST expression.

**d) How a jump is written**
| Word | Arrow (R) |
|---|---|
| `jump Idle` | `-> Idle` |

**e) How branches are written**
| Current symbols | Words + bar (R) | Words only |
|---|---|---|
| `/\` ... `\|` ... `\/` | `select` ... `\|` ... `end` | `select` ... `or` ... `end` |
| `//\\` ... `\|` ... `\\//` | `parallel` ... `\|` ... `end` | `parallel` ... `and` ... `end` |

"Words only" reads nicely but `or`/`and` are also ST operators, which is confusing on screen. The current symbols are hard to type on a French keyboard (`\` is AltGr+8) and easy to mix up.

**f) How actions are written (under a step)**
| One action | Several, with qualifiers | Multi-line ST |
|---|---|---|
| `Valve [:=] 1;` → qualifier N by default | `N  Valve [:=] 1;`<br>`S  Count := Count + 1;`<br>`L 2s  Horn [:=] 1;` | `N {`<br>`  IF Level > 80 THEN Valve := 0; END_IF;`<br>`}` |

**All recommendations together**, with a parallel branch, a nested selection and optional transition names:
```
sfc Mixer

[[Idle]]
  Motor := 0;
-- Start: StartBtn AND SafetyOk
parallel
  [FillA] 5s
    ValveA [:=] 1;
  -- FillA.DN OR LevelA
  [WaitA]
|
  [FillB]
    ValveB [:=] 1;
  select
    -- LevelB
  |
    -- FaultB
    [AlarmB]
      L 10s  Horn [:=] 1;
    -- AckBtn
  end
  [WaitB]
end
-- AllFilled
[Mix] 30s  "Mixing phase"
  N  Motor [:=] 1;
-- Mix.DN
-> Idle
```
How to read it: the parallel branch starts after the `Start` transition (IEC rule) and has two legs, each starting and ending with a step. Leg B contains a selection: either the level is reached directly, or a fault raises the horn for 10 s until it is acknowledged. Both selection legs end with a transition and merge into `[WaitB]`.

Errors are reported at the exact line, with a suggestion. For example, if the selection legs ended in two different steps: *"line 17: selection legs must end with a transition and merge into one step after `end`."* The error messages are part of the spec.

### 3.4 GRAFCET (IEC 60848) vs SFC (IEC 61131-3)

SFC was derived from GRAFCET, so the basics match one to one: steps, transitions (GRAFCET calls the condition the *receptivity*), OR/AND divergence and convergence, and step activity variables (GRAFCET `X1`, Studio `Step.X`).

GRAFCET-only features with no direct SFC equivalent are **macro-steps, enclosing steps, forcing orders (`F/G2:{3}`), and actions on events (↑ / ↓)**. Plan: don't support them in the language at first. If we add them later, the L5X/PLCopen exporters must either expand them into plain SFC or refuse with a clear message.

A display option to number steps (GRAFCET-style `1, 2, 3`) instead of naming them goes with the Phase 2 mockups (Q14).

### 3.5 Tags: auto-created, with a live tag list

Every identifier found in a condition or action that isn't a step name or an ST keyword becomes a tag. Its **type is inferred**:
- used alone in a condition, or assigned `0/1/TRUE/FALSE` → `BOOL`
- assigned or compared with an integer → `DINT`, with a decimal → `REAL`
- `Fill.DN`, `Fill.X`, `Fill.T` on a step name → the step's own `SFC_STEP` tag, so nothing is created

**Typo protection without declarations:** the live tag panel lists every tag with its type and where it is used. A tag used **only once** gets a soft warning ("`StratBtn` used only once — typo of `StartBtn`?"). Autocomplete offers known tags as you type.

**What declarations would still give**, and the lightweight way to get each:
| Need | Without declaration block |
|---|---|
| A non-BOOL type the tool can't infer (TIMER, COUNTER, a UDT) | a one-line override anywhere in the file: `tag Count : DINT` |
| A tag description in Studio 5000 | `tag StartBtn "Green push button"` |
| Matching existing tags in the target project | Studio's import dialog already offers *Use existing* for conflicts |

So declarations stay **optional overrides, never required**. That matches the "drafting language" goal.

### 3.6 Chosen syntax (Q9): Mix 1, optional transition names

```
init idle
  motor := 0;
-- start_btn AND safety_ok
step fill 5s
  valve [:=] 1;
-- fill.DN
step check
select
  -- good: quality_ok
  step pack
    packer [:=] 1;
  -- pack_done -> idle
|
  -- bad: NOT quality_ok
  step reject
    pusher [:=] 1;
    L 10s  horn [:=] 1;
  -- rejected: reject_done -> idle
end
```

| Element | Form |
|---|---|
| Initial step | `init name [preset] ["description"]` |
| Step | `step name [preset] ["description"]`; preset like `5s`, `500ms`, `1m` |
| Action | the lines under a step: plain ST, one action (qualifier N). **Phase 1** allows one action per step, which may span several lines. Later: `[qualifier [time]] ST` per action line, and `N { ... }` blocks |
| Transition | `-- [name:] condition [-> target]`; without a name it becomes `T1`, `T2`, ... |
| Jump | `-> target` at the end of a transition line |
| Selection (OR) | `select` ... `\|` ... `end` |
| Parallel (AND) | `parallel` ... `\|` ... `end` |
| Comment | `// ...` |
| Tag override (optional) | `tag name [: TYPE] ["description"]` |
| Header (optional) | `sfc RoutineName` |

Details still to settle in `SPEC.md`, with proposed defaults:
- **Keyword case.** Proposed: case-insensitive, since Studio 5000 is (`STEP`, `Step` and `step` all work).
- **Names in L5X (Q7).** Operands are `Step_000` and so on, and the qSFC name goes in the Description (`fill`; auto-named transitions get `T1`...). References such as `fill.DN`, `fill.X` and `fill.T` in conditions or actions are rewritten to the operand on export and restored on import.
- **Indentation** is cosmetic: never an error, but the editor can auto-format it.
- **Phase 1 single action:** every ST line under a step goes into one N action. A line starting with a qualifier (`L 10s ...`) gives a clear "not supported yet" error, not a silent change.

---

## 4. Technology choice — **decided: A (TypeScript, single HTML file)**

Consequences of the decision:
- **Firefox has no File System Access API**, so there: *Open* uses a normal file picker, *Save/Export* downloads the file, and **watch mode (Phase 3, editing in vim/VS Code) works only in Edge/Chrome**. Firefox could get a "reload file" button instead. Everything else works in all three browsers.
- **The Phase 1 CLI runs on Node.js.** It is a development and testing tool; the HTML file is the product. The parser and exporter are the same code in both.
- The `.exe` wrapper is dropped unless you ask for it later.

The key constraint is "**runs from a USB key on any computer**", including school computers you don't administer.

| | **A. TypeScript web app** (recommended) | **B. Python + Qt desktop** (keeps current language) |
|---|---|---|
| How it runs | **One `QuickSFC.html` file**, offline, opened in Edge/Chrome. No install, no admin rights, nothing for IT to block. Works on Windows, Mac and Linux. An optional `.exe` wrapper (Tauri) can come later | `.exe` folder built with PyInstaller (~100 MB). School policy may block unknown executables run from USB |
| Code editor + autocomplete (Phase 3) | **CodeMirror 6**: syntax colors, autocomplete, red underlines for errors, all built in | Must be built on QScintilla or by hand; more work, less polished |
| Diagram drawing | SVG. Crisp, zoomable, exports to SVG/PNG for homework reports | Qt graphics scene; fine |
| Watching a file edited in vim/VS Code | Works in Edge/Chrome (File System Access API); not in Firefox | Easy (file watcher) |
| CLI (Phase 1 acceptance) | Node.js CLI (you already have `fnm` installed); can be compiled to a single `.exe` | Same as today |
| Testing by Claude | Unit tests (Vitest) for parser/validator/exporter, plus I can open the page in my built-in browser and screenshot it | Unit tests (pytest), plus rendering the scene to PNG |
| Cost | Port the core to TypeScript (we rewrite it anyway). `l5x_sfc` (ladder, Python) would have to be ported later | Reuse the Python ecosystem and the `l5x_sfc` repo directly |

My recommendation is **A**: the single HTML file is the most portable thing possible, and the editor features you want come almost free. The cost is that the later ladder feature means porting `l5x_sfc`.

---

## 5. Proposed phases (refined)

Each phase ends with something usable, and with an **import test pack** sized so that you only need one short session in Studio 5000.

### Phase 0: Planning (now)
- Answer the open questions; freeze the language choice.
- Write `SPEC.md`: the grammar, every rule with an example, and the error messages.
- Diagram **mockups** (2–3 static SVG variants) so you can pick a visual style before any UI is built. They could also wait for the start of Phase 2.

### Phase 1: New core + CLI
- New parser (syntax tree, nesting, exact line/column errors, keeps going after the first error).
- IEC 61131-3 validator (alternation, initial step, branch shapes, unreachable steps, unknown jump targets, duplicate names) plus **Studio 5000 rules** (tag naming, 40-char limit, reserved words, declared tags).
- L5X exporter rebuilt on the rules verified in `L5X_GUIDE.md` (BOM, CRLF, CDATA, ID order, link patterns, MainRoutineName), with layout coordinates.
- CLI: `qsfc check file.qsfc`, `qsfc export file.qsfc -o out.L5X [--version 32.01]`, `qsfc show file.qsfc` (ASCII diagram in the terminal).
- Repo: new major version on a branch of `quick-sfc`; the Python code moves to `legacy/`.
- Tests: unit tests, "golden" L5X files compared byte for byte, ASCII snapshots of the diagrams, and the old repo's cases rewritten by hand in the new syntax.
- **Import test pack**: about 6 L5X files covering linear, selection, parallel, nested, jumps with automatic convergence, presets and multi-line ST. You import each one once and report any errors.
- ✅ Acceptance: every file in the pack imports into Studio 5000 without errors.
- **Status (2026-11-25):** built, committed on branch `v2` and pushed (646 tests). The test pack is in `testpack/`. **The Studio import is not done yet**; Phase 2 started anyway. Points that may need export fixes once the import results arrive:
  1. how step names show: tag description beside the box, the `// name` action comment, or both (and whether comment-only actions pass Verify)
  2. REAL and TIMER tag data
  3. a chart ending on a step (tp06)
  4. automatic convergence fed by jumps far apart (tp05), and its bar spanning two chains
  5. a parallel diverge leg linked directly into a selection converge leg (tp07)
  6. deep nesting (tp04), and a program with the same name as its routine
  7. the general layout spacing as Studio draws it
  8. code review of the subagent-written modules (deferred until the import results)
- **Studio import results (2026-11-26): tp01–tp11 all import and look right** in Studio 5000 v32.01. Points 1–7 above are settled. What the imports changed in the export:
  - names: kept in the step/transition tag descriptions with `HideDesc="true"` (no boxes); the `// name - description` action comment shows the step name
  - `TRUE` / `FALSE` exported as `1` / `0` (Studio ST has no Boolean keywords)
  - rows grow with the action's line count, so action boxes don't run into the next element
  - a jump drawn as a cross-reference in the app is `Show="false"` in the L5X; room is left above its target and below its source for Studio's connector labels, and its transition moves right when it starts a leg
  - automatic convergences list their legs left to right; a loop's convergence sits right above its target when all its jumps come from the target's chain, else at the bottom (Studio then routes that loop round the left: accepted)
  - still to do: point 8 (code review)

### Phase 2: Viewer window
- Start with mockups of **both looks** (Studio 5000 and textbook IEC/GRAFCET); you choose one.
- Window: toolbar **File → Open .qsfc**, **Export L5X**; the diagram is auto-drawn; an error list is shown below with clickable line numbers.
- Zoom/pan. Export diagram as SVG/PNG (optional, handy for reports).
- Tests: layout tests (no overlaps, legs aligned) and screenshot comparisons I can run myself.
- ✅ Acceptance: opening any test-pack `.qsfc` shows the correct diagram; Export L5X gives the same file as the CLI.

**Implementation design (Phase 2):**
- `src/render/svg.ts`: `renderSvg(graph, layout, options)` returns an SVG string. Pure, so it is snapshot-tested in Node and used in the browser the same way. It has two looks (Studio 5000 / textbook) behind one option until you choose. It draws from the same `Layout` as the L5X coordinates and the ASCII view.
- `app/`: the window. Plain TypeScript and DOM, no UI framework (Phase 3 adds CodeMirror 6 for the editor).
- Build: `npm run build:app` bundles everything with esbuild and inlines it into **one file, `dist/QuickSFC.html`**, which works offline from a USB key.
- File access:
  - **Open:** a file picker in every browser. Edge and Chrome use the File System Access API when present, which Phase 3's watch mode will reuse.
  - **Export L5X:** a download, which works everywhere (Firefox included).
- Checks: unit and snapshot tests for the renderer. For the window, I open `dist/QuickSFC.html` in my built-in browser, load the test-pack charts and compare screenshots.

### Phase 3: Live coding
- Split view: editor on the left, diagram on the right, redrawn as you type. When the text is broken, the last valid diagram stays visible with the error highlighted.
- Autocomplete: keywords, qualifiers, **step names after `jump`/`->`**, `Step.DN`/`.X`/`.T` members, declared tags.
- Click a step in the diagram to jump to its line, and the reverse.
- "Watch mode": open a file being edited in vim/VS Code; the diagram follows its saves.
- ✅ Acceptance: as in your file, plus the items above.

**Implementation design (Phase 3):**
- Layout (chosen 2026-11-25): editor | diagram | **collapsible Tags sidebar** (toolbar toggle); Problems stays at the bottom. The splitters can be dragged.
- Editor: **CodeMirror 6**, bundled into the single HTML file. It has qSFC syntax highlighting, red/yellow underlines from the diagnostics, and autocomplete for keywords, step names after `->`, step members after `name.`, known tags and qualifiers.
- Live: the chart is recompiled after a short pause in typing (~150 ms). On errors, the last valid diagram stays, dimmed, with a "showing last valid diagram" badge.
- Cross-navigation: clicking a step or transition in the diagram selects its line, and moving the cursor highlights the element under it. Clicking a problem puts the cursor on its line.
- Files: New, Open, **Save (Ctrl+S)**, Save As. In Edge/Chrome they write back to the file; in Firefox, Save downloads the file. The window warns before closing with unsaved changes.
- Watch mode (Edge/Chrome): File → "Watch file…" follows a file edited elsewhere (vim, VS Code) and redraws on each save, with the editor read-only meanwhile. Firefox gets a "Reload from disk" button instead.

### Phase 3.5: Several routines and calls
- One file = one Program: `program name`, then `sfc name` / `st name` routines (SPEC §4.5). The first routine is main.
- `call name;` (and native `JSR(name, 0);`) in ST routines and SFC actions, checked against the routines (E600-E602, W600-W603), autocompleted, highlighted, click-to-jump.
- One namespace and one operand numbering across the file (Studio keeps them at program scope); step members readable from any routine.
- Export: several `<Routine>`s (SFC and ST), `MainRoutineName` = first routine. CLI `show` prints every routine.
- App: tabs above the diagram, one per routine, following the cursor; an ST routine shows what it calls and who calls it. Mockup first.
- Test pack tp08 (several routines, ST routine, JSR from ST and from an SFC action, operands across two charts).
- ✅ Acceptance: tp08 imports and verifies in Studio; one-routine files export byte-identical to before.

### Phase 4: L5X import, qualifiers, user experience (order decided 2026-11-26: 4a → 4e)
**4a. Tidy (first deliverable, decided 2026-11-26).** Studio 5000 has no way to clean up a messy SFC diagram; the qSFC layout engine can do it.
- Read an SFC routine from an L5X (exported from Studio), rebuild its structure (steps, transitions, branches, links), run the qSFC layout, and write back **only** the coordinates (step/transition X/Y, branch Y, description positions) and the `Show` flags of hidden wires. Every other byte stays as it was: operands (`Step_007` keeps its name, so HMIs and other routines that use `Step_007.X` keep working), actions and qualifiers, presets and expressions, alarms, the user's own descriptions, tags.
- The layout learns the elements qSFC doesn't write: Stop elements, text boxes, several actions per step (taller action boxes).
- A chart the layout can't handle (a shape the qSFC rules don't allow, e.g. a jump into the middle of a parallel branch) is left untouched, with a message saying why; never "fixed" silently.
- Output: the tidied L5X, imported back into the project. Replacing a routine needs a routine-level import: **[Verify]** that format first (L5X_GUIDE flags it as unverified), or re-import the whole program.
- In the app: File → "Tidy an L5X…" shows before/after diagrams and saves the tidied file; CLI `qsfc tidy in.L5X -o out.L5X`.
- Tests: tidying a qSFC-made L5X changes nothing but coordinates; tidy twice = tidy once; real messy charts from class, exported from Studio, tidied, re-imported, Verify + screenshot.

**4b. Several actions per step, with qualifiers** (Q10: N, S, R, L, D, P…), before the round trip: real Studio charts use them, so the round trip would lose them otherwise.
- Sugar (decided 2026-11-26): **output verbs** `on valve, pump` (N: `valve [:=] 1;`), `set alarm` (S), `reset alarm` (R). Removes the `[:=]` vs `:=` confusion.
- **Status: built (2026-11-26), not committed.** As in SPEC §4.3: a line holding only `N S R L D P` (+ duration for L/D) starts an action (E110 for P0 P1 SL SD DS, E111 duration missing / not allowed, E112 empty action); `on` / `set` / `reset` sugar in any action (`set a` = `a := 1;`, `reset a` = `a := 0;`, the tags are BOOL); W402 per action; one `<Action>` per action, the name comment in the first one; stacked action rows in both SVG looks and in the ASCII view; highlighting, completion and the cheat sheet. Test pack **tp12_qualifiers**.
- **Unverified until the tp12 import:** the L5X words `StoredUntilReset` (S), `Reset` (R), `TimeLimited` (L), `TimeDelayed` (D), `Pulse` (P) (only `NonStored` is verified, L5X_GUIDE §6.2); the action time as the `PRE` of the action tag with `PresetUsesExpr="false"`; how Studio links an R action to the stored action it resets (we write the R action with its own operand and body); whether Studio stacks several actions as we space the rows.

**4c. User experience improvements** (small items, decided 2026-11-26; mockups approved 2026-11-27: docs/mockups/ux4c; share-by-link dropped):
- where a tag is used: click a tag in the Tags sidebar to highlight every step and transition that uses it
- overview map and search for big charts
- I/O mapping: an `io … end` block (`start_btn  Local:1:I.Data.0  "Start button"`), exported as alias tags (decided 2026-11-27)
- snippets / templates: start-stop, timeout to fault, reset sequence, parallel join
- print / PDF view: title block from the file header (`program tank "Title"`, `course "…"`, `author "…"`; date at print time), diagram, tag table with I/O addresses, code
- Sugar (decided 2026-11-26): **time in a condition** `-- after 5s` (exports `step.T >= 5000` for the step above); **readable step members** `fill.active` / `.done` / `.time` / `.first` for `.X` / `.DN` / `.T` / `.FS` (both spellings accepted).
- **Status of the language parts: built (2026-11-27), not committed.** As in SPEC §4.4, §4.5, §7.3, §7.6, §8: `program name "Title"` (the Program's `<Description>`, and the print title), `course "…"` / `author "…"` header lines (printing only, E210 / E107), `io … end` blocks (alias tags; E413 bad address, E414 bit address vs a non-BOOL `tag` type, E415 name mapped twice; E206 for a missing `end`), `after <duration>` in conditions (rewritten at export to `<step>.T >= ms`, the step before the transition or before the `select`; E416 after a parallel `end`), readable members rewritten with the step names (§8.4, ST routines included; W302 for `.done`). New reserved keywords `course author io`; `after` is a keyword only before a duration. Highlighting (io block state in the editor), completion (`.active/.done/.time/.first`, `after`, `io/course/author`) and the cheat sheet. Test pack **tp13_ux**.
- **Status of the app screens: built (2026-11-27), not committed** (mockups A–D). **A. Where a tag is used:** clicking a row of the Tags sidebar outlines the steps (and their action boxes) and transitions using the tag, with the name emphasized in their text; tabs of other routines using it get a dot; click again or Esc clears; Enter on a focused row (or a click on its "uses" count) selects the next use in the editor, cycling. The tag table has an **I/O address** column (sortable) when the file has an `io` block ("—" for the other tags); in a narrow Tags pane the address goes under the name. **B. Overview map** (View → Overview map, on by default, remembered): a thumbnail of the diagram in the canvas corner when it doesn't fit, with a frame for the visible part (drag it, or click to go there). **Find in the diagram** (Ctrl+F on the canvas; the editor keeps its own search): step names, transition conditions and action text, "1 of 2", Enter / Shift+Enter or ‹ ›, the match selected in the editor, Esc closes. **C. Snippets** (start / stop, timeout → fault with `after 30s`, reset sequence, parallel join, counter loop): in autocomplete ("snippet: …", only on a line where a step can start: after a transition without a jump, after a `select … end`, in an empty routine, or after the last step, then with a transition first) and in a new **Insert** menu (a "Snippet" group: a flat menu rather than a submenu, keyboard-friendly; the menubar is File · View · Insert · Help). Names are Tab fields; a name already used in the file is suffixed (`fault2`); a snippet with nothing after it ends with a jump to the routine's initial step. **D. Print / PDF** (File → Print…, Ctrl+P): Diagram / Tags / Code checkboxes, then a print-only layout (title block: title, course · author · date, `program name`; per routine: diagram scaled down to the page width, tag table with I/O addresses, code with line numbers), light colors whatever the theme; the browser's own Print command prints the same layout. Pure helpers in `app/{taguse,overview,search,snippets,print}.ts`, unit-tested.
- **Unverified until the tp13 import:** the Program `<Description>` (same shape as the verified routine description); an alias tag holding a `<Description>`; a word alias (`Local:3:I.Ch0Data`) written without `Radix`; the context `<Module Use="Reference" Name="Local">` entries (Studio's own export also lists the slot module, e.g. `Discrete_IO`, whose name qSFC can't know). The alias needs the module in the destination project.

**4d. Round trip** (after 4b and 4c).
- L5X → syntax tree → `.qsfc` text; actions, qualifiers, presets and descriptions preserved.
- Anything we can't represent (Stop elements, text boxes, ...) is reported, never silently dropped.
- Names: from the step/transition tag descriptions (hidden boxes, decided 2026-11-26), else the step's `// name - description` comment; auto names (`T1`…) become unnamed transitions again. Elements with neither get a plain name (never `Step_000`, which is reserved).
- Tests: export → import → export gives the same file; your real `MainProgram.L5X` imports.
- ✅ Acceptance: as in your file.
- **Decided 2026-11-27:** unnamed steps get `s<N>` from `Step_<N>`; **operand pins**: a step named `s<N>` exports as `Step_<N>`, a named transition `tr<N>` as `Tran_<N>` (changed from `t<N>` the same day: timers are often named `T1`, `T2`…, and names are case-insensitive), the rest are numbered in file order around them (the import keeps Studio's operands this way, no new syntax); sugar comes back only where it matches exactly; text boxes become comments, a Stop ends the chain, everything else lost is in the report and a comment at the top; **tag values** `tag t2 : TIMER 3s`, `tag x : DINT = 1` (E417), exported even when unused; routine names may be qSFC keywords (`sfc SFC`). Mockup approved: docs/mockups/import.
- **Status: built (2026-11-27), not committed.** As in SPEC §8.7: `src/import` (`importL5X`), CLI `qsfc import`, the app's File → Open an L5X… dialog (Studio sketch, highlighted .qsfc preview, notes, "Tidy it instead…"; a dropped .L5X opens it), tag values (§7.4), pins (§8.2). Every test pack file and fixture round-trips byte for byte; MainProgram.L5X imports with 0 errors, same wires and step operands, timer presets and values kept.
- **Unverified until a Studio import:** a re-exported Studio chart (MainProgram → import → export) and the tag values (TIMER and BOOL/DINT shapes copied from Studio's own export; REAL from L5X_GUIDE 6c).

### Phase 4d+: Importing real projects (found 2026-11-27 with GEMMA.L5X and the STATION2 MainProgram.L5X)
Proposed before 4e. Each task says what goes wrong today (reproduced with `qsfc import` + `qsfc check`).

**I1. Copy the problems' text** (app, small). The Problems panel can't be selected or copied. Make the text selectable, add "Copy" on each row (code, line:col, message, hint) and "Copy all".

**I2. Steps of other routines in code** (`Step_000`, `Step_001.T`, `Step_017.DN`, `Step_016.Count`).
- Today: E405 "reserved name" and E402 "type unknown… add `tag Step_017 : TIMER`". A step tag isn't a TIMER: it is an `SFC_STEP` (members X FS SA LS DN OV T TMax Count PRE…).
- Fix: an operand name (`Step_<N>`, `Tran_<N>`, `Action_<N>`) that is not an element of the file is a reference to another routine (one that wasn't exported, or another program). It is typed `SFC_STEP` / `BOOL` / `SFC_ACTION`, with no E405 and no E402. Its number is **reserved**, so the automatic numbering skips it (a new step never becomes `Step_000` when the code already uses `Step_000`). An info line lists these outside references, since they must exist in the destination project.
- When the step *is* in the file, the import already writes its name (`s0`), as today.

**I3. SFC instructions and routines that aren't in the file.**
- `SFR(PRODUCTION_NORMALE,s0);` gives E410 "is a routine, not a tag" and E400 "`s0` is a step; use `s0.X`". `SFR(routine, step)` and `SFP(routine, Execute|Pause)` (and `SFR`'s step as `Step_000`) are valid ST and must pass through. Their routine argument is a routine. The step argument is a step of that routine: a qSFC name is rewritten to its operand at export, and `Step_<N>` is kept.
- `JSR(INIT);` to a routine missing from the export (`Use="Reference"`) is commented out today, and the note says "qSFC has no ? routines". Keep the line as is and know the routine as **outside** (no error). Both `JSR(x);` and `call x;` stay supported; the import doesn't turn one into the other.
- The program's main routine is kept even when it isn't imported (`MainRoutine`, ladder). Today `flash_ER` becomes main, which gives the false W602 on `JSR(flash_ER)` and W600 "never called". W600 is off while some routines of the program are outside the file.
- How an outside routine is declared in the text is still to choose: implicit, or a line such as `uses INIT, PRODUCTION_NORMALE`.

**I4. Controller-scope tags.**
- Today the import reads only the program's `<Tags>`. In STATION2 every tag is at controller scope (the `<Controller><Tags Use="Context">` block of the export), so the import loses step presets (`Step_042` PRE 200 ms, which gives the false W302 "`s42` has no preset"), values (`stop` = 1, which gives W400 "did you mean `e_stop`"), aliases (`e_stop`, `FM`, `ejections` → `Step_017.Count`) and descriptions (`Tran_042` "VERS AUTO").
- Studio's L5X export already holds every controller tag the program uses, with values, so reading it needs no extra file. A tags **CSV** export has types, descriptions and aliases but no values: useful only for tags the L5X doesn't hold.
- To decide: whether qSFC keeps the scope (e.g. a `controller` marker on `tag` / `io` lines, exported in the controller `<Tags Use="Context">`) or imports everything as program tags (simpler; Studio then has two tags with the same name at two scopes, and the program one wins inside the program).

**I5. Also seen.** The `PulseRisingEdge` (P1) qualifier has no qSFC form yet (written as N, with a warning). A description over several lines (`PROCEDURE NORMALE AUTO` / `F1`) isn't a name, so the step becomes `s26` and the text should be kept as its description.

- **Decided 2026-11-27:** do 4d+ before 4e. Controller tags in a `controller … end` block at the top of the file (`tag` lines, an `io` block, `sfc tags`). The import **mirrors the L5X**: SFC tags at controller scope are listed on `sfc tags`, and moving them to the program is an option, not the default (the usual practice is program scope; a project with controller-scope SFC tags is kept as is). Routines not in the file go on a `uses` line (typos in `JSR` are still caught), the main one marked `(main)`. An alias of a tag member goes in the `io` block (`ejections  Step_017.Count`).
- **Status: built (2026-11-27), not committed.** As in SPEC §4.5 (`uses`, SFR / SFP: E603, E604), §7.3 (operands of other routines: not tags, members checked, numbers reserved; E405 when it is an element of the file), §7.6 (aliases of tag members), §7.7 (controller block: E223, E418, E419) and §8.7. I1: "Copy all" in the Problems header, a Copy button on each problem, Ctrl+C on a focused problem (text as the CLI prints it). I5: descriptions over several lines are kept on one line; a step named from its description whose operand would change is named `s<N>` instead. Import dialog: a check box "Make the N controller-scope step tags program tags" (CLI `--sfc-tags-at-program`). `legacy/tests/STATION2_MainProgram.L5X` imports with 0 errors (2 real W302); every SFC routine comes back with the same wires and operands, and the same controller tags (except 4 FBD-type tags: SCALE, FBD_LIMIT); `STATION2_GEMMA.L5X` (a routine export) imports with no warning and 0 problems.
- **Help → Examples (2026-11-27):** six ready charts open as new, unsaved files (`app/examples.ts`; each compiles without errors or warnings, test/app/examples.test.ts): start / stop, selection, parallel, timers and qualifiers, several routines (call, SFR, SFP), controller tags and other routines.
- **Still open:** the P1 qualifier (`PulseRisingEdge`, also P0) has no qSFC form (written as N with a warning; Q10 later); FBD types (SCALE, FBD_LIMIT) can't be declared.
- **Verified 2026-11-27 (tp15 import):** a program import creates the controller context tags at controller scope (tags, I/O aliases, the alias of a step member without `Radix`). The `sfc tags` element tags (`Step_000`, `Step_001`, `Tran_000` and their actions) are controller tags, the others program tags; a transition pin `tr123` gives `Tran_123` in Studio.
- **STATION2 round trip in Studio (2026-11-27):** imports as a new program; warnings only for the main routine left out and the routines it doesn't reach (expected). Two errors fixed since: the word alias `Analogue_mesure` needs `Radix="Decimal"` (now on every alias), and `Step_016` (a step tag no chart has, used by `Step_016.Count:=0;`) is declared `tag Step_016 : SFC_STEP 500ms` by the import so the export creates it. Re-tested 2026-11-27: imports correctly. Seen then: a long condition in a leg overlapped the next leg's text in Studio. Fixed (option C, 2026-11-27): the export breaks conditions longer than 38 characters before `and` / `or` into several Studio lines (`src/l5x/wrap.ts`; the import joins them back), the layout widens a column for a line it can't break and makes the row taller per extra line; Tidy uses the chart's own lines. Unverified: the 20-unit line height and the 7-unit character width.
- **Unverified:** a program L5X whose called routines are not in it (`uses`; an outside main routine is no longer written as `MainRoutineName`, which Studio refused: "Failed to set the 'MainRoutineName' property", STATION2 round trip 2026-11-27). Replacing a program that has ladder routines would lose them: until Phase 5, import single routines back into such a project (a routine-level export is a later item).

### Phase 4e: Simulation (dry run), with SFC logic checks
- Toggle inputs, step through scans, see active steps light up, timers count and tags change; no PLC needed.
- Logic checks: selection legs whose conditions can be true together, a tag written in two parallel legs, an S action never reset, a step that can never be left.
- Sugar (decided 2026-11-26): **`else` leg** in a `select`: `-- else` exports `NOT (cond1 OR cond2 …)`, so the legs can never be true together.
- All sugar exports to plain Studio ST/SFC; the round trip turns it back into the short form where it can. Considered and set aside: step timeout (`timeout -> fault`), edge detection (`rising x`, needs a hidden memory tag), C-style operators (`!`, `&&`, `||`).

### Phase 5: Ladder routines (planned, not started)
- **Syntax: Studio's neutral text**, one rung per `rung` line, an optional `"comment"`, the instructions on the same line or indented below it:
  ```
  ladder main
    rung "Run the sequence"
      XIC(auto_mode) XIO(fault) JSR(fill_seq,0);
    rung XIC(start_btn) [OTE(lamp), TON(t1,?,?)];
  ```
  It maps 1:1 to the L5X `<Rung>` text (format verified by Test_Basic, L5X_GUIDE §5), so export, import and round trip are cheap, and it's the text students see in Studio. A friendlier syntax (`auto_mode & !fault -> JSR fill_seq`) can be added later as sugar.
- Checks: known instructions and their argument counts (XIC XIO OTE OTL OTU ONS OSR OSF TON TOF RTO CTU CTD RES MOV ADD SUB MUL DIV EQU NEQ LES LEQ GRT GEQ JSR NOP …), balanced `[ , ]` branches, `;` at the end, unique ONS storage bits, tag types inferred from the instruction (XIC → BOOL, TON → TIMER, MOV → numeric).
- Diagram: first a rung list (text, with the tags highlighted and click-to-jump); a drawn ladder (rails, contacts, coils, branches, instruction boxes) as a second step, reusing the routine tabs from Phase 3.5.
- Reuse `l5x_sfc` (Python) only as a reference for the rung grammar and drawing rules; it is ported, not called.
- Test pack: rungs with branches, nested branches, timers, ONS, JSR to an SFC; a mixed ladder + SFC + ST program.
- Open questions to ask before starting: rung syntax details (one line vs. indented), whether to draw the ladder in the first step, the instruction set for the first version.

### Later (not planned in detail)
Several actions per step with all IEC qualifiers (Q10) · PLCopen XML **import and export** (platform-agnostic: Beremiz, OpenPLC, CODESYS) · GRAFCET-only features (§3.4) · editing the diagram graphically · simulation (step through the chart, toggle inputs).

---

## 6. Questions (all answered; decisions in §0, original wording kept below for reference)

**Norms and target**
- **Q1.** You wrote IEC 61512 and "IEC 61531-3". I assume you mean **IEC 61131-3** (PLC languages, which defines SFC). IEC 61512 is ISA-88 batch control: should anything from it apply (procedures, phases)? Should **GRAFCET (IEC 60848)** be considered too, since it's often what schools teach?
- **Q2.** Studio 5000 version: is it always **v32.01** (home and school)? If the school has another version, the L5X header changes. 
- **Q3.** Export scope: **Program** (verified to import) or **Routine** (imports into an existing program, probably more useful for homework, but unverified)? If Routine, could you export any SFC routine from Studio 5000 once (right-click the routine → Export) and give me the file?

**Platform**
- **Q4.** On school computers, can you run an `.exe` from a USB key? Which browser do they have (Edge, Chrome)? Do you use a Mac or Linux anywhere?
- **Q5.** Language: **A (TypeScript, single HTML file)** or **B (Python + Qt)**? See §4.

**Language and export behavior**
- **Q6.** Tags used in conditions/actions (`StartBtn`, `Valve`): (a) declare them in a `tags` block in the file, (b) auto-create BOOL tags for anything undeclared, or (c) leave them undeclared and let Studio's import dialog sort it out? (c) might fail or give errors; that's unverified.
- **Q7.** Should step names become the **L5X operands** (`Fill` instead of `Step_001`, so `Fill.DN` works in conditions), or keep Studio's default `Step_000` with the name in the description?
- **Q8.** When a jump lands on a step that already has an incoming transition, IEC requires a selection convergence in front of it. Should I generate one automatically (conform to the norm, slightly busier diagram) or just draw a wire (Studio-style)? We'll test both in the import pack.
- ~~Q9~~ Decided: Mix 1 with optional transition names (§3.6).
- **Q15.** Diagram rendering: **drawn** (SVG boxes and lines, like Studio 5000 or a textbook), **ASCII** (like the README), or **both**? My suggestion is both, at different times: an ASCII view in the Phase 1 CLI (`qsfc show file.qsfc` prints the chart in the terminal, so the layout can be checked before any UI exists, and I can test it as plain text) and a drawn diagram in the app from Phase 2. ASCII could also stay as a "copy as text" option for code comments and READMEs.
- **Q10.** Is "several actions per step with qualifiers" needed from Phase 1, or is one `N` action per step enough at first?
- **Q11.** Do you have many existing `.qsfc` files worth converting automatically?

**Project and UI**
- **Q12.** Where should the new code live: the existing `quick-sfc` GitHub repo (new major version on a branch) or a new repo? This folder is not a git repo yet.
- **Q13.** UI language: English, French, or both?
- **Q14.** Diagram style preference: a Studio 5000 look (so the tool matches what you'll see after import) or a textbook IEC/GRAFCET look? The Phase 2 mockups will show both, but tell me if you already know.
