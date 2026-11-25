# qSFC language specification — version 2 (draft)

Status: **draft for review**, written in Phase 0 and not implemented yet. The decisions it builds on are in [PLAN.md](PLAN.md) §0.

Scope tags used below:
- **[P1]**: implemented in Phase 1 (parser, validator, CLI, L5X export).
- **[Later]**: part of the language design, but rejected with a clear "not supported yet" error until a later phase.
- **[Verify]**: L5X behavior that the Phase 1 import test pack must confirm in Studio 5000.

---

## 1. Purpose and principles

qSFC is a **drafting language** for Sequential Function Charts (IEC 61131-3). You write the structure of a chart quickly as text, see it as a diagram, and export it to Studio 5000 (L5X) for final touches.

1. **Fast to write.** Nothing is declared in advance: tags are created automatically, and transition names are optional.
2. **One element per line.** The line's first word says what it is. Indentation is for readability only and never causes an error.
3. **Never lose data silently.** Anything the tool can't represent or export is an error or a warning, never dropped.
4. **Errors are exact and helpful.** Every message has a line, a column, a code and, when possible, a suggestion. Parsing continues after an error, so all problems are shown at once. This matters for live coding, where the text is half-typed most of the time.
5. **Norm first.** The validator enforces IEC 61131-3 SFC rules. Studio 5000-specific rules are checked separately, at export.

---

## 2. A first example

```
// Fill a tank and check the product
sfc fill_and_check

init idle
  motor := 0;
-- start_btn AND safety_ok
step fill 5s "Fill the tank"
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
  -- rejected: reject_done -> idle
end
```

Reading it: `idle` is the initial step and resets the motor. When the start button is pressed and safety is OK, `fill` opens the valve for 5 s. Then `check` chooses one of two paths: pack good products or reject bad ones. Both paths return to `idle`.

---

## 3. Files and lexical rules

### 3.1 File
- Extension `.qsfc`, UTF-8 text, with LF or CRLF line endings.
- One file holds **one SFC routine**.

### 3.2 Lines
Each line is one of the following, chosen by its **first word**. Leading spaces and tabs are ignored.

| First word | Line kind | Section |
|---|---|---|
| `sfc` | header | §4.1 |
| `tag` | tag override | §7.4 |
| `init`, `step` | step | §4.2 |
| `--` | transition | §4.4 |
| `select`, `parallel` | branch start | §5 |
| `\|` | leg separator | §5 |
| `end` | branch end | §5 |
| *(empty)* or `//` | blank / comment | §3.3 |
| anything else | **action line**, part of the step above | §4.3 |

Keywords are **case-insensitive** (`step`, `Step` and `STEP` are the same). They are only recognized as the first word of a line.

### 3.3 Comments
- `//` starts a comment that runs to the end of the line, except inside an ST string (`'...'`) or a qSFC string (`"..."`).
- On **structure lines** (header, step, transition, branch, tag), comments are dropped.
- On **action lines**, `//` comments are part of the ST and are **exported** with it (Studio's ST accepts `//`).
- qSFC does not track ST block comments `(* ... *)`. A line inside one that starts with a keyword (for example a commented-out `step x`) is still read as a qSFC line. Use `//` to comment out structure.

### 3.4 Names
Steps, transitions and tags all follow **Studio 5000 tag naming rules**, so that a draft never fails on import:
- start with a letter or `_`, then letters, digits or `_` (`[A-Za-z_][A-Za-z0-9_]*`)
- at most **40 characters**
- no `__` (two underscores in a row), and no `_` at the end
- **case-insensitive**: `Fill` and `fill` are the same name
- not a qSFC keyword (`sfc tag init step select parallel end`)
- not an ST keyword (`AND OR XOR NOT MOD TRUE FALSE IF THEN ELSIF ELSE END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT EXIT RETURN`)
- not a generated operand name: `Step_` + digits, `Tran_` + digits, `Action_` + digits (§8.2)

**One namespace:** a name can't be used by two things. Two steps, a step and a transition, or a step and a tag can't share a name.

### 3.5 Durations
Used for step presets.

```
duration = 1*( number unit )      ; e.g. 5s   500ms   1m30s   2h
number   = digit { digit }
unit     = "ms" | "s" | "m" | "h"
```
- No spaces inside a duration. Parts add up (`1m30s` = 90 000 ms).
- A number without a unit is an error (E104): `5` could mean 5 ms or 5 s.
- Maximum 2 147 483 647 ms (about 24.8 days), the limit of a DINT preset.

### 3.6 Strings (descriptions)
- Written `"..."` on one line. `\"` gives a double quote and `\\` gives a backslash.
- Cannot contain `]]>`, which L5X CDATA forbids (E109).

---

## 4. Elements

### 4.1 Header [P1]
```
sfc fill_and_check
```
- Optional. If present, it must be the first non-blank, non-comment line.
- It sets the **routine name** in the L5X. Without it, the routine name comes from the file name (invalid characters become `_`, and the result must still be a valid name).

### 4.2 Steps [P1]
```
init name [duration] ["description"]
step name [duration] ["description"]
```
- `init` marks the **initial step**. There must be exactly one in the file, and it can be anywhere.
- `duration` sets the step's timer preset (`PRE`). The step's `.DN` bit becomes TRUE once the step has been active that long.
- `"description"` is a free comment shown beside the step (§8.3).

Examples:
```
init idle
step fill 5s
step mix 1m30s "Mixing phase"
step wait "Wait for the operator"
```

### 4.3 Actions [P1: one action per step]
The **action lines** of a step are all the lines between the step line and the next structure line. Together they form the step's single action: qualifier **N** (*non-stored*: it runs while the step is active).

```
step fill 5s
  valve [:=] 1;
  IF level > 80 THEN
    alarm := 1;
  END_IF;
```

- The text is **Structured Text, copied as is**. The only change is the step-name rewrite in §8.4.
- The common leading indentation of the block is removed, and relative indentation is kept.
- Blank lines inside the block are kept. Blank lines at the start and end are dropped.
- A step with no action lines has no action.
- Studio 5000 assignment forms are both allowed:
  - `x [:=] 1;` is a **non-retentive** assignment: `x` goes back to 0 when the step ends. Use it for "output on while the step is active".
  - `x := 1;` is a **retentive** assignment: `x` stays 1 until something else writes it.

**[Later]** Several actions per step, with IEC qualifiers:
```
step reject
  N      pusher [:=] 1;
  L 10s  horn [:=] 1;
  S      count := count + 1;
  N {
    IF x THEN y := 1; END_IF;
  }
```
In Phase 1, a line that starts with a qualifier (`N S R L D P P0 P1 SD DS SL`) followed by a duration, `{`, or something that can't follow a tag name in ST gives **E110** ("action qualifiers are not supported yet"). A line like `S := 1;`, where `S` is a tag, is still a normal ST line.

### 4.4 Transitions [P1]
```
-- [name:] condition [-> target]
```
- `condition` is a **Boolean ST expression** on one line, for example `start_btn AND safety_ok`, `fill.DN`, `level > 80`.
- `name:` is optional. The parser knows it is a name because a name followed by `:` (not `:=`) can't start an ST expression. Unnamed transitions are named **`T1`, `T2`, …** in file order, skipping names already in use.
- `-> target` is a **jump**: the transition leads to step `target` instead of the next line (§6).
- The condition can't be empty (E307). Write `TRUE` for a transition that is always TRUE.
- **[Later]** Conditions that span several lines.

Examples:
```
-- start_btn
-- start: start_btn AND safety_ok
-- fill.DN OR level_high
-- done: count >= 10 -> idle
-- TRUE -> idle
```

---

## 5. Branches

The examples in this section are fragments of a chart, not complete files.

### 5.1 Selection (OR divergence) [P1]
Exactly **one** leg runs: the first one, from left to right (file order), whose first transition is TRUE.

```
step check
select
  -- quality_ok
  step pack
  -- pack_done
|
  -- NOT quality_ok
  step reject
  -- reject_done
end
step next
```
- `select` must come right after a **step** (the divergence step).
- Each leg **starts with a transition** and **ends with a transition**. A leg can be a single transition, to skip steps:
  ```
  select
    -- skip_wash
  |
    -- NOT skip_wash
    step wash 10s
    -- wash.DN
  end
  step dry
  ```
- After `end`, the legs that don't jump **merge into the next step** (the convergence step). If at least one leg doesn't end with a jump, a step must follow `end` (E214).
- If **every** leg ends with a jump, nothing merges, and the line after `end` starts a new chain (§6.3).

### 5.2 Parallel (AND divergence) [P1]
**All** legs start together. The branch finishes when every leg has reached its last step **and** the transition after `end` is TRUE.

```
-- start
parallel
  step fill_a
    valve_a [:=] 1;
  -- level_a
  step wait_a
|
  step fill_b
    valve_b [:=] 1;
end
-- level_b
step mix
```
- `parallel` must come right after a **transition**.
- Each leg **starts with a step** and **ends with a step**.
- A **transition** must follow `end` (E218): it is the convergence transition.

### 5.3 Common rules [P1]
- A branch has **at least 2 legs** (E207), separated by `|` lines. Legs can't be empty (E208).
- Branches **nest** freely: a leg can contain other branches, as long as the alternation rule below holds.
- **Alternation rule.** In any sequence, step-like and transition-like elements must alternate:
  - **step-like**: a step, or a `parallel ... end` block (it sits where a step would)
  - **transition-like**: a transition, or a `select ... end` block (it sits where a transition would)

  This one rule gives all the IEC constraints. For example, `select` followed by `select` needs a step in between, and `parallel` followed by `parallel` needs a transition in between.

Nested example: a selection inside a parallel leg.
```
-- start
parallel
  step fill_a 5s
  -- fill_a.DN
  step done_a
|
  step fill_b
  select
    -- level_b
  |
    -- fault_b
    step alarm_b
      horn [:=] 1;
    -- ack_btn
  end
  step done_b
end
-- TRUE
step mix
```

---

## 6. Flow, jumps and chains

### 6.1 Normal flow
Each element leads to the one written after it at the same nesting level.

### 6.2 Jumps [P1]
`-- condition -> target` sends the flow to step `target`. The flow **stops** after a jumping transition, so the next line must be a step (a new chain), `|`, `end`, or the end of the file.

Rules:
- `target` must be a **step** (E303 if it doesn't exist, E304 if it's a transition). The message suggests the closest name ("did you mean `idle`?").
- A jump **can't enter or leave a parallel branch**. The source and the target must be in the same innermost parallel leg, or both outside any parallel branch (E305). Otherwise a step of one leg could be activated twice, or never finish (IEC "unsafe" and "unreachable" charts).
- **Inside a branch, a jump can only be the last transition of a `select` leg** (E220), and at least one leg of a `select` nested in another branch must not jump (E221). At the top level, a jump can end the flow anywhere. A loop inside a parallel leg is written with a nested `select`:
  ```
  step fill_a
  select
    -- retry -> fill_a
  |
    -- level_ok
  end
  step done_a
  ```
- A jump to the step that would come next anyway is allowed, with warning W301.

### 6.3 Chains [P1]
A **chain** is a sequence that starts with a step. The file is a list of chains:
- the first chain starts at the first step of the file
- a new chain starts at any step that follows a point where the flow stopped (a jump, or a selection whose legs all jump)

A chain's first step must be reachable: it must be the initial step or the target of a jump (otherwise E306).

```
init idle
-- start -> work      // flow stops here
step error             // new chain, reached by the jump below
  alarm [:=] 1;
-- reset_btn -> idle
step work              // new chain, reached from idle
  motor [:=] 1;
-- fault -> error
```

### 6.4 Steps with several incoming paths: automatic convergence [P1]
In IEC 61131-3, a step that can be reached from several transitions needs a **selection convergence** in front of it. qSFC adds it automatically:
- If a step has more than one incoming transition (normal flow, a merging `select`, and/or jumps), the exporter puts a selection convergence in front of it with one leg per incoming transition.
- If the step is already the convergence step of a `select ... end`, the jumps become **extra legs of that same convergence**.

You never write the convergence yourself. The diagram shows it the same way Studio 5000 would.

### 6.5 End of a chart [P1]
- A chain may end with a **step** that has no transition after it: the chart stays there (warning W300). **[Verify]** that Studio 5000 accepts a step with no outgoing transition.
- A chain can't end with a transition that has no jump: it would lead nowhere (E308).

---

## 7. Tags

### 7.1 Automatic creation [P1]
Every **identifier** in a condition or action becomes a program tag, unless it is:
- an ST keyword (§3.4) or an ST function / instruction name followed by `(` (such as `ABS(`, `TON(`). The list of known names is kept in the code.
- a step reference (`fill.DN`, §7.3)
- a number, or text inside an ST string or comment

### 7.2 Type inference [P1]
Each tag gets one type, from how it is used anywhere in the file:

| Use | Inferred type |
|---|---|
| alone as a Boolean operand (`start_btn`, `NOT x`, `a AND b`) | BOOL |
| assigned only `0`, `1`, `TRUE`, `FALSE` (`:=` or `[:=]`) | BOOL |
| assigned another integer, used in `+ - * / MOD`, or compared with `< > <= >=` | DINT |
| compared with `=` or `<>` to an integer other than 0 or 1 | DINT |
| any use together with a decimal number (`1.5`, `2.0E3`) | REAL |
| `a := b` | `a` and `b` get the same type |
| no clue | BOOL |

- The rules are applied until nothing changes. If one tag gets two different types (for example BOOL in one place and REAL in another), that is error **E404**, which suggests adding a `tag` line.
- `x.0` (bit access) makes `x` a DINT.
- **Member access** on a tag that isn't a step (`tmr.DN`), or **array access** (`a[3]`), can't be inferred: errors E402 / E403 ask for a `tag` line, for example `tag tmr : TIMER`.

### 7.3 Step references [P1]
`stepname.member` uses the step's built-in SFC_STEP tag. Valid members: `X`, `FS`, `SA`, `LS`, `DN`, `OV`, `T`, `PRE`, `TMax`, `Count`, `Reset`, `PauseTimer`, `AlarmEn`, `AlarmLow`, `AlarmHigh`, `LimitLow`, `LimitHigh`, `Status` (case-insensitive). The most useful ones:
- `X`: the step is active
- `FS`: first scan of the step (TRUE only on its first scan)
- `DN`: the step timer reached the preset
- `T`: time the step has been active, in ms

Rules:
- An unknown member gives E401. A step name used alone (`fill`) gives E400 with the hint "use `fill.X`".
- `.DN` on a step without a preset gives warning W302: the timer is done immediately.

### 7.4 Tag overrides (optional) [P1]
```
tag name [: TYPE] ["description"]
```
- These lines can go anywhere (the top of the file is recommended). They never make a tag exist by themselves: a declared tag that is never used gives W404.
- Phase 1 types: `BOOL`, `DINT`, `REAL`, `TIMER`. **[Later]** `SINT`, `INT`, `COUNTER`, arrays, UDTs.
- A declared type takes priority over inference. A use that contradicts it (for example `count := 1.5` with `tag count : DINT`) is an error.
- The description becomes the tag's description in Studio 5000.

```
tag start_btn "Green push button"
tag count : DINT
tag tmr : TIMER
```

### 7.5 Live tag list (editor, Phase 3)
The tag panel and the autocomplete use the same data: every tag with its type, where the type came from (inferred or declared), its description, and the lines where it is used. A tag used **once** whose name is very close to an established tag (one used at least twice, or declared) gets W400, which suggests that name. A tag used once with no such neighbour gets no warning, because in a draft most outputs are written only once.

---

## 8. Export to L5X (Studio 5000) [P1]

### 8.1 File
Follows the verified format in [L5X_GUIDE.md](../../L5X_GUIDE.md):
- **Program** export (`TargetType="Program"`, `ContainsContext="true"`).
- UTF-8 **with BOM**, **CRLF** line endings, ST and descriptions in CDATA.
- `SoftwareRevision`: `32.01` by default, configurable (CLI `--version`).
- **Names.** Routine = header or file name. Program = routine name unless set otherwise (CLI `--program`). Controller (context only) = `QuickSFC`.
- The Program's `MainRoutineName` is the SFC routine, so the chart runs right after import.

### 8.2 Elements
| qSFC | L5X |
|---|---|
| step | `<Step>`, operand `Step_000`, `Step_001`, … in file order, plus an `SFC_STEP` tag with `PRE` = preset in ms |
| `init` | `InitialStep="true"` |
| action | one `<Action Qualifier="NonStored">`, operand `Action_000`, …, plus an `SFC_ACTION` tag. Each source line becomes one `<Line>` |
| transition | `<Transition>`, operand `Tran_000`, …, plus a BOOL tag. The condition is one `<Line>` |
| select / parallel | `<Branch BranchType="Selection" / "Simultaneous">` diverge + converge, one `<Leg>` per leg; `Priority="Default"` on the selection diverge only |
| automatic convergence (§6.4) | `<Branch BranchType="Selection" BranchFlow="Converge">` |
| links | `<DirectedLink>` following the verified patterns (L5X_GUIDE §6.3) |
| user tags | program-scope tags of the inferred or declared type |
| X/Y | computed by the layout engine, the same one that draws the diagram in the app |

IDs are numbered in the order the reference export uses: each step followed by its action, then the transitions, then each branch followed by its legs, then the links.

### 8.3 Names and descriptions
Following Q7, operands keep Studio's default names. The qSFC name is kept in the **description of the element's tag** (`Step_001` gets the description `fill`), which Studio shows beside the step.
- With a `"description"`, the tag description is `fill` + new line + `Fill the tank`.
- Transitions get their name, including auto-names (`T3`), in the same way.
- This is what lets the Phase 4 import recover the names.
- **Name comment (on by default for now).** Every step's action also starts with a comment line holding its name: `// fill`, or `// fill - Fill the tank` with a description. A step without an action gets an action containing only that line. The Phase 4 import removes this first line again. The test pack decides whether we keep the description, the comment, or both.
- **[Verify]** The reference export has no element descriptions, so how Studio displays a tag description beside its step must be checked in the test pack.

### 8.4 Step-name rewrite
In conditions and actions, every `stepname.member` is rewritten to its operand (`fill.DN` becomes `Step_001.DN`). The rewrite works on identifiers (`refill.DN` is untouched) and skips strings and comments. Nothing else in the ST is changed.

### 8.5 Export checks (Studio 5000 rules)
Beyond the language rules, the exporter refuses to write a file when:
- a name breaks the Studio naming rules (§3.4 already enforces them in the language)
- two tags differ only in capitalization
- the text contains `]]>`

**[Verify]** in the test pack:
- a step with no outgoing transition (§6.5)
- tag descriptions shown beside steps (§8.3)
- REAL and TIMER tag data
- deep nesting
- a selection convergence with legs coming from jumps (§6.4)
- a program and its SFC routine having the same name (§8.1)

---

## 9. Diagnostics

### 9.1 Format
```
fill.qsfc:12:5: error E202: two steps in a row: 'fill' (line 10) and 'check'
  hint: add a transition between them, e.g.  -- fill.DN
```
- `file:line:column: severity code: message`, with an optional `hint:` line.
- Severities: **error** (export refused) and **warning** (export allowed).
- The parser continues after an error, line by line, and reports everything it finds.

### 9.2 Codes

**Lines and names (E1xx)**
| Code | Message (example) |
|---|---|
| E100 | this looks like qSFC version 1 syntax (`S@name(...)`); see §11 for the new form |
| E101 | `2fill` is not a valid name: names start with a letter or `_` |
| E102 | name `...` is 43 characters long; the maximum is 40 |
| E103 | name `fill__a` can't contain `__` or end with `_` (Studio 5000 rule) |
| E104 | `5` has no unit: write `5s` or `5ms` |
| E105 | duration `30d`: unknown unit (use ms, s, m, h) / too long (max about 24.8 days) |
| E106 | string not closed: add `"` |
| E107 | unexpected text `extra` after the step's duration/description |
| E108 | `select` is a keyword and can't be used as a name |
| E109 | text can't contain `]]>` (L5X limitation) |
| E110 | action qualifiers are not supported yet: write the ST without `L 10s` (N is used) |

**Structure (E2xx)**
| Code | Message (example) |
|---|---|
| E200 | the file has no steps |
| E201 | a chain must start with a step; this transition has nothing before it |
| E202 | two steps in a row: `fill` and `check`; add a transition between them |
| E203 | two transitions in a row; add a step between them |
| E204 | `\|` outside a `select` or `parallel` block |
| E205 | `end` without a matching `select` or `parallel` |
| E206 | `select` at line 8 is never closed: add `end` |
| E207 | a branch needs at least 2 legs (separate them with `\|`) |
| E208 | empty leg between `\|` and `end` |
| E209 | this action line has no step above it (it follows a transition) |
| E210 | `sfc` header must be the first line, and appear only once |
| E211 | `select` must follow a step |
| E212 | each `select` leg must start with a transition (`-- condition`) |
| E213 | each `select` leg must end with a transition; leg 2 ends with step `reject` |
| E214 | the `select` legs that don't jump need a step after `end` to merge into |
| E215 | `parallel` must follow a transition |
| E216 | each `parallel` leg must start with a step |
| E217 | each `parallel` leg must end with a step |
| E218 | a transition must follow the `end` of a `parallel` block |
| E219 | unexpected text after the jump target `idle` |
| E220 | inside a branch, a jump must be the last transition of a `select` leg |
| E221 | at least one leg of this `select` must continue (it is inside another branch, so the flow can't stop here) |

**Chart rules (E3xx / W3xx)**
| Code | Message (example) |
|---|---|
| E300 | no initial step: mark one step with `init` |
| E301 | more than one initial step: `idle` (line 1) and `start` (line 9) |
| E302 | the initial step can't be inside a `parallel` block |
| E303 | jump target `idel` doesn't exist; did you mean `idle`? |
| E304 | jump target `good` is a transition; jumps go to steps |
| E305 | a jump can't enter or leave a `parallel` block |
| E306 | step `error` can never become active (no jump or flow reaches it) |
| E307 | transition has no condition; write `TRUE` for "always" |
| E308 | transition leads nowhere: add `-> step` or a step after it |
| E309 | name `fill` is already used by the step at line 6 |
| W300 | step `done` has no transition after it: the chart stops there |
| W301 | jump to `next` is not needed: it is the next step anyway |
| W302 | `fill.DN` is used but `fill` has no preset, so it is TRUE immediately |

**Tags and ST (E4xx / W4xx)**
| Code | Message (example) |
|---|---|
| E400 | `fill` is a step; use `fill.X` (active) or another member |
| E401 | `fill.DONE`: steps have no member `DONE` (did you mean `DN`?) |
| E402 | type of `tmr` unknown (it has member `.DN`): add `tag tmr : TIMER` |
| E403 | `a[3]` needs a declared array tag (not supported yet) |
| E404 | `level` is used as BOOL (line 4) and as REAL (line 9): add `tag level : REAL` |
| E405 | `Step_003` is a reserved name (used for generated operands) |
| E406 | `:=` in a condition: did you mean `=`? |
| E407 | unbalanced `(` / `[`, or an ST string `'` is not closed |
| E408 | tag `count` declared twice with different types |
| E409 | unknown type `TMR` (Phase 1 types: BOOL, DINT, REAL, TIMER) |
| E410 | `pack` is both a step and a tag |
| W400 | `strat_btn` is used only once; did you mean `start_btn`? |
| W401 | `Valve` and `valve` are the same tag; the first spelling is used |
| W402 | the action of `fill` doesn't end with `;` |
| W403 | `valve = 1;` compares and does nothing; did you mean `:=`? |
| W404 | tag `spare` is declared but never used |

**Export (E5xx)**
| Code | Message (example) |
|---|---|
| E501 | software revision `32` should look like `32.01` |
| E502 | program name `my-prog` is not a valid Studio 5000 name |

There are no deep ST checks in Phase 1. Studio 5000 still verifies the ST on import; qSFC only catches the common slips above.

---

## 10. Grammar (summary)

The grammar is line-based. The ordering rules (alternation, branch shapes) are checked after parsing, so their messages can be specific (§9).

```
file        = { line } ;
line        = blank | comment | header | tag_decl | step | action_line
            | transition | "select" | "parallel" | "|" | "end" ;

header      = "sfc" NAME ;
tag_decl    = "tag" NAME [ ":" TYPE ] [ STRING ] ;
step        = ( "init" | "step" ) NAME [ DURATION ] [ STRING ] ;
transition  = "--" [ NAME ":" ] CONDITION [ "->" NAME ] ;
action_line = ST_TEXT ;                    (* any other line *)

(* structure built from the lines *)
chart       = chain { chain } ;
sequence    = element { element } ;        (* alternation rule, §5.3 *)
element     = step_block | transition | selection | parallel ;
step_block  = step { action_line } ;
selection   = "select" leg { "|" leg } "end" ;
parallel    = "parallel" leg { "|" leg } "end" ;
leg         = sequence ;

(* in CONDITION, the name part ends at "->" outside strings, or at "//" *)
```

---

## 11. From qSFC version 1

There is no automatic converter (decision Q11). Equivalences:

| v1 | v2 |
|---|---|
| `SI@idle(motor:=0;)` | `init idle` + action line `motor := 0;` |
| `S@fill(valve:=1;, 5000)` | `step fill 5s` + action line `valve := 1;` |
| `S@wait(some text)` (comment) | `step wait "some text"` |
| `T@start(start_btn)` | `-- start: start_btn` or just `-- start_btn` |
| `T@done(x) -> @idle` / `>> @idle` | `-- done: x -> idle` |
| `/\` … `\|` … `\/` | `select` … `\|` … `end` |
| `//\\` … `\|` … `\\//` | `parallel` … `\|` … `end` |
| `# comment` | `// comment` |
| `END` | *(nothing)* |

---

## 12. ASCII view (CLI `qsfc show`) [P1]

`qsfc show` prints the chart in the terminal with box characters. The output is for reading and for snapshot tests; it is not a format that can be read back in. Illustrative only, the final style is settled in Phase 1:

```
      ╔═══════════╗
      ║   idle    ║─[ motor := 0; ]
      ╚═════╤═════╝
            ┼  start_btn AND safety_ok
      ┌─────┴─────┐
      │ fill  5s  │─[ valve [:=] 1; ]
      └─────┬─────┘
            ┼  fill.DN
      ┌─────┴─────┐
      │   check   │
      └─────┬─────┘
       ┌────┴─────────┐
       ┼ good         ┼ bad
      ...            ...
```

---

## 13. Decisions taken in this spec (tell me if you disagree)

These came up while writing the spec and weren't in the Phase 0 questions. I chose the option that fits "drafting language, never lose data"; each is easy to change now:

1. **`//` comments on action lines are exported** with the ST. On every other line they are dropped (§3.3).
2. **All names share one namespace**: steps, transitions and tags (§3.4). This avoids `pack` meaning two things.
3. **A duration without a unit is an error**, not milliseconds by default (§3.5).
4. **A chart may end on a step** with only a warning, pending the Studio test (§6.5).
5. **Transition descriptions are not supported**; only steps take `"..."`. A string after a condition would be confusing next to ST.
6. **Type inference falls back to BOOL** when there's no clue (§7.2).
7. **Operands are numbered in file order** (`Step_000` is the first step written, not necessarily the initial step), so exports are stable and testable.
