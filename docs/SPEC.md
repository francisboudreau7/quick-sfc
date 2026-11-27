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
- One file holds **one Program**: one or more routines that share the program's tags (§4.5). A file without routine headers holds one SFC routine, as before.

### 3.2 Lines
Each line is one of the following, chosen by its **first word**. Leading spaces and tabs are ignored.

| First word | Line kind | Section |
|---|---|---|
| `program` | program header | §4.5 |
| `uses` | routines of the program that aren't in the file | §4.5 |
| `controller` | controller tags, up to its `end` | §7.7 |
| `course`, `author` | header lines (printing only) | §4.5 |
| `sfc`, `st` | routine header | §4.1, §4.5 |
| `tag` | tag override | §7.4 |
| `io` | I/O block, up to its `end` | §7.6 |
| `init`, `step` | step | §4.2 |
| `--` | transition | §4.4 |
| `select`, `parallel` | branch start | §5 |
| `\|` | leg separator | §5 |
| `end` | branch end | §5 |
| *(empty)* or `//` | blank / comment | §3.3 |
| anything else | **action line**, part of the step above (§4.3); in an `st` routine, a line of its ST body (§4.5) |

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
- not a qSFC keyword (`program sfc st call tag init step select parallel end course author io`)
  - **Position keywords** (decided 2026-11-27): `after` (before a duration in a condition, §4.4), `on` / `set` / `reset` (sugar lines, §4.3) and the qualifiers `N S R L D P` (qualifier lines, §4.3) are keywords only in those positions. Elsewhere they are ordinary names, so a tag named `after` or `set` still works (`after := 1;`, `-- after AND x`). `after 5s` in a condition always means the time form.
- not an ST keyword (`AND OR XOR NOT MOD TRUE FALSE IF THEN ELSIF ELSE END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT EXIT RETURN`)
- not a generated operand name: `Step_` + digits, `Tran_` + digits, `Action_` + digits (§8.2)
- **Routine and program names [Phase 4d]** may be a qSFC keyword (`sfc SFC`, `call SFC;`: Studio projects often name the chart routine `SFC`); ST keywords stay forbidden.
- **Pinned operands [Phase 4d]:** a step named `s` + a number (`s3`) is exported as that operand (`Step_003`), and so is a named transition `tr` + a number (`tr5:` → `Tran_005`; not `t5`, which would clash with timers named `T5`); see §8.2.

**One namespace:** a name can't be used by two things. Two steps, a step and a transition, a step and a tag, or a routine and any of these can't share a name. The namespace covers the whole file (all routines), because Studio keeps step, transition and tag names at program scope.

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
- Optional for the first routine of the file. It starts an SFC routine (§4.5) and sets its **routine name** in the L5X.
- When the file starts with steps and no header, that first SFC routine is named after the file (invalid characters become `_`, and the result must still be a valid name).
- Before the first routine, the file can also hold the program header with a title and the `course` / `author` lines (§4.5), `tag` lines (§7.4) and `io` blocks (§7.6).

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

### 4.3 Actions [P1; several actions and qualifiers: Phase 4b]
The **action lines** of a step are all the lines between the step line and the next structure line. They form one or more actions.

```
step fill 5s
  valve [:=] 1;          // N action: the lines before any qualifier line
  S
    alarm_lamp := 1;     // S action
  L 10s
    horn [:=] 1;         // L action, time limit 10 s
  P
    count := count + 1;  // P action (pulse: once, when the step becomes active)
```

- The text is **Structured Text, copied as is**. The only change is the step-name rewrite in §8.4 (and the sugar below).
- The common leading indentation of each action is removed, and relative indentation is kept. Blank lines inside an action are kept; blank lines at its start and end are dropped.
- A step with no action lines has no action.
- Studio 5000 assignment forms are both allowed:
  - `x [:=] 1;` is a **non-retentive** assignment: `x` goes back to 0 when the action stops. Use it for "output on while the step is active".
  - `x := 1;` is a **retentive** assignment: `x` stays 1 until something else writes it.

**Qualifiers [Phase 4b].** A line that holds **only** a qualifier, optionally followed by a duration (and a comment), starts a new action; the lines below it belong to that action until the next qualifier line or structure line. Indentation is cosmetic, as everywhere in qSFC. The lines before the first qualifier line form an **N** action.

| Qualifier | Meaning (IEC 61131-3) | Duration |
|---|---|---|
| `N` | non-stored: runs while the step is active | not allowed |
| `S` | stored: keeps running after the step, until reset | not allowed |
| `R` | reset a stored action | not allowed |
| `L` | time limited: runs while the step is active, at most the duration | **required** |
| `D` | time delayed: starts after the duration, if the step is still active | **required** |
| `P` | pulse: runs once when the step becomes active | not allowed |

- `P0`, `P1`, `SL`, `SD`, `DS` come with the round trip (Phase 4d); today they give **E110**.
- A line like `S := 1;` (a tag named `S`) is still ST: only a line holding nothing but the qualifier (and its duration) starts an action.
- Errors: **E111** a duration is missing (L, D) or not allowed (N, S, R, P); **E112** an empty action (a qualifier line with no ST under it).
- **[Verify]** The L5X names of S, R, L, D, P (L5X_GUIDE §6: only `NonStored` is verified), how Studio links an R action to the stored action it resets, and the action time (`PRE` of the action tag). Test pack tp12.

**Output sugar [Phase 4b].** Three short forms for the most common action lines; each line expands to plain ST on export (and in the diagram):

| Write | Means | Exported as |
|---|---|---|
| `on valve, pump` | outputs on while the action runs | `valve [:=] 1; pump [:=] 1;` |
| `set alarm` | latch the tag on | `alarm := 1;` |
| `reset alarm, horn` | latch the tags off | `alarm := 0; horn := 0;` |

- A sugar line is the keyword, then one or more tag names separated by commas, then optionally `;` and a comment. Anything else on the line makes it ordinary ST (so a tag named `on` or `set` still works in `set := 1;`).
- The tags are BOOL (type inference, §7).

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

**Time in a condition [Phase 4c].** `after <duration>` means "the step above has been active at least that long":
```
step fill
  on valve
-- after 5s                  // exported as fill.T >= 5000 (fill's operand, §8.4)
-- after 5s AND level_ok     // can be combined like any Boolean operand
```
- The step is the one right before the transition in the flow. For the first transition of a `select` leg, it is the step before the `select`.
- After the `end` of a `parallel` block there are several steps before the transition, so `after` is an error there (**E416**); test one leg's step instead (`-- wait_a.time >= 5000`).
- `after` is a keyword only when a duration follows it (§3.4); the duration follows §3.5 (E104, E105).
- On export each term becomes `step.T >= ms`, in parentheses when an operator other than `AND`, `OR`, `XOR`, `&` or a bracket is next to it (`NOT after 5s` → `NOT (Step_001.T >= 5000)`). The diagram shows the condition as written.

### 4.5 Program, routines and calls [P3.5]
A file is one **Program** made of one or more routines. They share the program's tags.

```
program tank "Tank filling"  // optional: the Program name, and an optional title
course "GEI-243"             // optional header lines, for printing only
author "Francis B."

st main                      // ST routine; the first routine is the main routine
  call fill_seq;             // runs the SFC routine fill_seq (exported as JSR(fill_seq,0);)
  call alarms;

sfc fill_seq                 // SFC routine: steps, transitions, branches as in §4-§6
init idle
-- start_btn AND main_ok
step fill 5s
  valve [:=] 1;
-- fill.DN -> idle

st alarms
  alarm := level_high AND NOT pump;
```

**Routines**
- `sfc name` starts an SFC routine and `st name` starts an ST routine. A routine runs until the next routine header.
- If the file starts with steps and no header, that first SFC routine is named after the file (§4.1).
- The **first routine is the main routine** (`MainRoutineName` in the L5X). It is the only one Studio runs by itself; every other routine runs only when something calls it.
- An **ST routine's body** is every line until the next header, except `tag` lines (§7.4), which can appear anywhere. The body is dedented like an action (§4.3): the common leading whitespace is removed, and blank lines at its start and end are dropped. `//` comment lines inside it are part of the ST and are exported, but comment lines after its last code line are not (they usually introduce the next routine).
- Step, transition, branch lines (`init`, `step`, `--`, `select`, `parallel`, `|`, `end`) inside an ST routine are an error (E222).
- Names are shared by the whole file (§3.4): a step `fill` in one SFC routine can be read from any routine as `fill.X`, `fill.DN`… and is exported as its operand.
- Operands are numbered across the whole file (`Step_000`… continue from one SFC routine to the next), because Studio keeps them at program scope. Names `s<N>` / `tr<N>` pin their number (§8.2).
- A jump (`-> target`) can't leave its SFC routine (E303 says where the step is).

**Program header**
- `program name` sets the Program name. It is optional and must come before the first routine (comments and blank lines may precede it). Without it, the Program takes the main routine's name (CLI `--program` overrides both).
- **Title [Phase 4c].** `program name "Title"`: the optional string is the Program's **description** in Studio (§8.2) and the title of the printed page.
- **Header lines [Phase 4c].** `course "…"` and `author "…"` are optional, each at most once, before the first routine (like `program`; E210 otherwise), in any order. They are only for printing (the title block, with the date at print time) and are **not exported** to the L5X. The text must be in quotes (E107).

**Routines outside the file: `uses` [Phase 4d+]**
```
uses INIT, PRODUCTION_NORMALE, MainRoutine (main)
```
- Names the routines of the Program that this file doesn't hold: a ladder routine (until Phase 5), an FBD routine, or a routine left out of a Studio routine export. Before the first routine (E210); several `uses` lines add up; a name can't also be a routine of the file (E309).
- `JSR`, `call`, `SFR` and `SFP` may name them; any other unknown routine is still E600.
- `(main)` after one name: that routine is the Program's main routine, so the first routine of the file is not. One `(main)` at most (E210). Studio refuses a `MainRoutineName` that is not a routine of the file (verified, STATION2 import 2026-11-27: "Failed to set the 'MainRoutineName' property"), so the export leaves the attribute out: the program comes in without a main routine; set it in Studio (Program Properties → Configuration) once the routine is there.
- While the file has a `uses` line, W600 (routine never called) and W404 (tag declared but unused) are off, and an unused `tag` line is still exported: the routines outside may call the file's routines and use its tags.
- **[Verify]** importing in Studio a program L5X without a main routine, and with `JSR`s to routines that are not in it (the routines must already be in the project).

**Calls**
- `call name;` runs routine `name` once each time it is executed. It is a statement, so it belongs in an action or an ST routine, not in a condition (E602). It is exported as Studio's `JSR(name,0);`.
- Studio's own `JSR(name, 0);` is also accepted; its first argument is checked the same way.
- The routine must exist (E600). Calling the main routine (W602) or a routine calling itself (W601) is a warning; so is a routine that nothing calls and that isn't the main routine (W600).
- **[Later]** Parameters (`call name(in1, in2)`), ladder routines (PLAN Phase 5).
- A JSR in an SFC action runs while the step is active (qualifier N). When the step goes inactive, the called routine is no longer scanned and keeps its state.

**SFC instructions [Phase 4d+]**
- `SFR(routine, step);` (reset an SFC to a step) and `SFP(routine, Execute);` / `SFP(routine, Pause);` (pause or resume it) are Studio ST and pass through. Their first argument is a routine, not a tag; they are not calls (no W600 / W602 effect).
- The routine must be an SFC routine (E603 for an ST routine; E600 when it doesn't exist and isn't on a `uses` line).
- SFR's step is a step of that routine, by its name when the routine is in the file (exported as its operand: `SFR(seq, idle)` → `SFR(seq, Step_004)`), else by its operand (`SFR(PRODUCTION_NORMALE, Step_000)`). SFP's second argument is `Execute` or `Pause`. Anything else is E604.

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

**Readable members [Phase 4c].** Four members have a readable name too; both spellings are accepted anywhere a step member is (conditions, actions, ST routines), case-insensitive:

| Readable | Studio | Meaning |
|---|---|---|
| `fill.active` | `fill.X` | the step is active |
| `fill.done` | `fill.DN` | the step timer reached the preset |
| `fill.time` | `fill.T` | time active, in ms |
| `fill.first` | `fill.FS` | first scan of the step |

The export writes the Studio member (`fill.done` → `Step_001.DN`, §8.4).

Rules:
- An unknown member gives E401 (its suggestion includes the readable names). A step name used alone (`fill`) gives E400 with the hint "use `fill.X`".
- `.DN` (or `.done`) on a step without a preset gives warning W302: the timer is done immediately.

**Elements of other routines [Phase 4d+].** An operand name in the code, `Step_<N>`, `Tran_<N>` or `Action_<N>`, that is not an element of the file is a step, transition or action of a routine that isn't in the file (`Step_017.DN`, `Step_016.Count := 0;`). It is not a tag of the file and is not exported as one; it must exist in the destination project. A step's members are checked as above (E401; alone: E400), an action's are `Status A Q PauseTimer PRE T Count`, a transition is a BOOL without members. Its number is **reserved**: no element of the file gets it (§8.2). Naming an element of the file this way (`Step_003` when the file has a step `s3`) is E405: write its name.

**Declaring such a tag.** When the tag doesn't exist in the destination project, declare it so the export creates it: `tag Step_016 : SFC_STEP [preset]` (its PRE, like a TIMER), `tag Action_005 : SFC_ACTION`, `tag Tran_007 : BOOL`, in the `controller` block for a controller tag (§7.7). Only an operand name takes these types (E409 otherwise), and only its own type (E405); it reserves the number too. The import writes such a line for every one the code names and the file defines (STATION2: `Step_016.Count := 0;` with a `Step_016` no chart has: without it Studio reported "Referenced tag is undefined").

### 7.4 Tag overrides (optional) [P1; values: Phase 4d]
```
tag name [: TYPE [value]] ["description"]
```
- These lines can go anywhere (the top of the file is recommended). Without a value they never make a tag exist by themselves: a declared tag that is never used gives W404.
- **Value [Phase 4d].** After the type, the tag's initial value: `= 0`/`= 1`/`= TRUE`/`= FALSE` for BOOL, `= -5` for DINT, `= 1.5` for REAL, and the **preset** for a TIMER, written as a duration (`tag t2 : TIMER 3s`, `= 3s` also works). A value that doesn't fit the type, a value without a type, or a value on an `io` point is **E417**. A tag with a value is exported even when the code doesn't use it (no W404): a timer set up for later, or a Studio tag brought back by the import (§8.7). Exported as Studio writes it: the L5K and Decorated data (`[0,3000,0]` and `PRE` for a timer, as in a real Studio export; REAL **[Verify]**).
- Phase 1 types: `BOOL`, `DINT`, `REAL`, `TIMER`. **[Later]** `SINT`, `INT`, `COUNTER`, arrays, UDTs.
- A declared type takes priority over inference. A use that contradicts it (for example `count := 1.5` with `tag count : DINT`) is an error.
- The description becomes the tag's description in Studio 5000.

```
tag start_btn "Green push button"
tag count : DINT
tag tmr : TIMER
tag t2 : TIMER 3s "Fill timer"
tag parts : DINT = 10
tag ok : BOOL = 1
```

### 7.5 Live tag list (editor, Phase 3)
The tag panel and the autocomplete use the same data: every tag with its type, where the type came from (inferred or declared), its description, its I/O address (§7.6), and the lines where it is used. A tag used **once** whose name is very close to an established tag (one used at least twice, declared, or mapped in an `io` block) gets W400, which suggests that name. A tag used once with no such neighbour gets no warning, because in a draft most outputs are written only once.

### 7.6 I/O mapping (`io` block) [Phase 4c]
```
io
  start_btn   Local:1:I.Data.0  "Start button"
  valve       Local:2:O.Data.3
  level       Local:3:I.Ch0Data "Tank level"
end
```
- An `io` line (alone, a comment may follow) starts the block and `end` closes it. Each line inside is `name  address  ["description"]`; blank and `//` comment lines are allowed.
- Blocks can appear anywhere a `tag` line can (the top of the file is recommended), several times; all of them are program-wide. A block that is missing its `end` is E206; it ends at the next structure line.
- **Every I/O point is a tag**, exported as an **alias tag** of that address (§8.2), even when the code doesn't use it (an I/O list is often a full wiring list): no W404.
- `address` is a Logix I/O path, checked loosely: a module part with at least one `:` (`Local:1:I`, `Rack1:I`), then `.member`, `.bit` or `[index]` parts, e.g. `Local:1:I.Data.0`, `Local:2:O.Data.3`, `Local:3:I.Ch0Data`, `Rack1:I.Data[2].5`. Anything else (or no address) is **E413**.
- **Type.** An address ending in `.digits` is a bit: the tag is BOOL (strong evidence, §7.2; a numeric use is E404). Any other address gives no type clue: the tag keeps its inferred or declared type, shown in the tag table, but the alias in the L5X has no data type (it takes the target's).
- **With a `tag` line.** A name can also have a `tag` line (for a description, or a type for the tag table). For a bit address the type must be BOOL, otherwise **E414**; for a word address any type is accepted. The `io` description wins over the `tag` line's.
- The same name twice in `io` lines (in one block or two) is **E415**. The name follows §3.4 and shares the one namespace (a step and an I/O point can't have the same name: E410).
- **Radix.** Every alias is written with `Radix="Decimal"`, as Studio writes its own (bit, word and tag-member aliases alike; `Float` for a word alias declared REAL). Without it Studio reported the word alias `Local:2:I.Ch0Data` as "doesn't reference valid object" (STATION2, 2026-11-27).
- **Alias of a tag member [Phase 4d+].** The address may also be a tag member (`ejections  Step_017.Count`, `bit3  status.3`): it starts with a tag, a step of the file (exported as its operand: `s17.Count` → `Step_017.Count`) or an operand of another routine (§7.3); anything else is E413. Such an alias names no module.
- **In Studio,** the module at the address must exist in the project (an alias to a missing module is an unresolved reference at import). Adjust the addresses to your rack.

---

### 7.7 Controller tags (`controller` block) [Phase 4d+]
```
controller
  tag stop : BOOL = 1
  tag auto : BOOL = 1 "Automatic mode"
  io
    e_stop     Local:1:I.Data.15
    ejections  Step_017.Count
  end
  sfc tags s26, s27, tr29
end
```
- Tags declared here are **controller-scope** tags in Studio; every other tag is a program tag. The block holds `tag` lines (§7.4), `io` blocks (§7.6), `sfc tags` lines, blank and comment lines (anything else: E223), and ends with `end` (E206 without it). It comes before the first routine (E210); the import writes it at the top of the file.
- A tag lives at one scope: a name declared both here and as a program tag is E418. A controller alias can't point to a program tag (E418): Studio doesn't allow it.
- A tag line here is exported even when the code doesn't use it (another program may).
- `sfc tags` lists steps and named transitions whose operand tags are controller tags (a step's action tags go with it); other element tags are program tags, as Studio creates them today. A name that is not a step or transition of the file is E419. The import writes this line so that a project whose SFC tags are controller tags keeps them there; it can also move them to the program (CLI `--sfc-tags-at-program`, the import dialog's check box).
- **Export:** controller tags are written in the controller's context `<Tags Use="Context">` with the same shapes as program tags. Studio creates them at controller scope when it imports the program (verified with tp15, 2026-11-27: the tags, the I/O aliases and the alias of a step member `fills` → `Step_001.Count`).

## 8. Export to L5X (Studio 5000) [P1]

### 8.1 File
Follows the verified format in [L5X_GUIDE.md](../../L5X_GUIDE.md):
- **Program** export (`TargetType="Program"`, `ContainsContext="true"`).
- UTF-8 **with BOM**, **CRLF** line endings, ST and descriptions in CDATA.
- `SoftwareRevision`: `32.01` by default, configurable (CLI `--version`).
- **Names.** Routine = header or file name. Program = `program` header, else the main routine's name; CLI `--program` overrides both. Controller (context only) = `QuickSFC`.
- The Program's `MainRoutineName` is the first routine (§4.5), so the program runs right after import.
- Routines are written in file order. An SFC routine is a `<Routine Type="SFC">` with its own element IDs (from 0); an ST routine is a `<Routine Type="ST">` whose `<STContent>` has one `<Line>` per body line (an empty body gets one empty line).
- `call name;` is written `JSR(name,0);`; the rest of the line is unchanged.

### 8.2 Elements
| qSFC | L5X |
|---|---|
| step | `<Step>`, operand `Step_000`, `Step_001`, … in file order, plus an `SFC_STEP` tag with `PRE` = preset in ms. **Pins [Phase 4d]:** a step named `s<N>` (`s3`; `s0`, no leading zero) is `Step_<N>` (`Step_003`), and the other steps take the free numbers in file order, skipping the pinned ones and the numbers of other routines' elements named in the code (§7.3; same for transitions and actions). That is how an imported Studio chart (§8.7) keeps its operands |
| `init` | `InitialStep="true"` |
| action | one `<Action>` per action in source order, `Qualifier` = `NonStored` (N; verified), `StoredUntilReset` (S), `Reset` (R), `TimeLimited` (L), `TimeDelayed` (D), `Pulse` (P) [Verify: tp12], `PresetUsesExpr="false"`; operands `Action_000`, … across the program, plus an `SFC_ACTION` tag whose `PRE` is the L/D duration in ms. Each source line becomes one `<Line>` (sugar lines expanded, §4.3) |
| transition | `<Transition>`, operand `Tran_000`, …, plus a BOOL tag. The condition is one `<Line>`. A transition named `tr<N>:` is `Tran_<N>` (pin, as for steps; `t<N>` is an ordinary name, so timers `T1`, `T2`… don't clash); auto names (`T1`) never pin |
| select / parallel | `<Branch BranchType="Selection" / "Simultaneous">` diverge + converge, one `<Leg>` per leg; `Priority="Default"` on the selection diverge only |
| automatic convergence (§6.4) | `<Branch BranchType="Selection" BranchFlow="Converge">` |
| links | `<DirectedLink>` following the verified patterns (L5X_GUIDE §6.3). A jump wire that the app's diagram (default view) draws as a cross-reference is written `Show="false"`: Studio then hides the wire and shows connector labels at both ends (verified with the user's tp05 export, 2026-11-26). The app draws such a hidden wire as a dashed arrow under the transition (labelled with the target) and a dashed arrow into the target (labelled with the transition and its condition) |
| user tags | program-scope tags of the inferred or declared type; controller tags (§7.7) in the controller's context `<Tags>` |
| `io` point (§7.6) | alias tag, no `DataType`, no `Data`: `<Tag Name="start_btn" TagType="Alias" Radix="Decimal" AliasFor="Local:1:I.Data.0" ExternalAccess="Read/Write"/>` (shape verified for bit aliases, L5X_GUIDE §4). With a description: `>` + `<Description>` (CDATA) + `</Tag>`. A word address (not ending in `.digits`) has no `Radix`. Each module named by an address (`Local`, `Rack1`: the part before the first `:`) is listed once in the context `<Modules>` as `<Module Use="Reference" Name="Local">` + `</Module>`; without `io` points the `<Modules>` context stays empty. **[Verify: tp13]** the description inside an alias, the word alias without Radix, and the module references (the module at a slot, e.g. `Discrete_IO` at `Local:1`, has its own name in the project, which qSFC can't know) |
| `program name "Title"` (§4.5) | the Program's `<Description>` (CDATA), right after the `<Program ...>` start tag, before `<Tags>`. **[Verify: tp13]** (same shape as a verified routine description) |
| X/Y | computed by the layout engine, the same one that draws the diagram in the app |

IDs are numbered in the order the reference export uses: each step followed by its actions, then the transitions, then each branch followed by its legs, then the links.

### 8.3 Names and descriptions
Following Q7, operands keep Studio's default names. The qSFC name is kept in the **description of the element's tag** (`Step_001` gets the description `fill`), which Studio shows beside the step.
- With a `"description"`, the tag description is `fill` + new line + `Fill the tank`.
- Transitions get their name, including auto-names (`T3`), in the same way.
- This is what lets the Phase 4 import recover the names.
- **Name comment.** Every step's first action starts with a comment line holding its name: `// fill`, or `// fill - Fill the tank` with a description (whatever the qualifier of that action). A step without an action gets an N action containing only that line. The Phase 4 import removes this first line again.
- **Decided after the tp01 imports (2026-11-26):** Studio draws a tag description as a box over the action box (steps) or over the condition (transitions). The export keeps the names in the tag descriptions but writes `HideDesc="true"` on every step and transition, the way Studio itself stores a hidden description (verified by importing tp01_hidden into a clean project). So the chart shows no boxes, the `// name` comment shows the step name, and the Tags list and the Phase 4 import still have every name, transitions included.
- Rows after a step grow with its action boxes' line count (every action's lines, the name comment, and one header line per action after the first), so the boxes don't run into the next element.
- **[Verify]** The reference export has no element descriptions, so how Studio displays a tag description beside its step must be checked in the test pack.

### 8.4 Step-name rewrite
In conditions and actions, every `stepname.member` is rewritten to its operand (`fill.DN` becomes `Step_001.DN`). The rewrite works on identifiers (`refill.DN` is untouched) and skips strings and comments. In the same pass a readable member (§7.3) becomes Studio's: `fill.done` → `Step_001.DN`, `fill.active` → `Step_001.X`, `fill.time` → `Step_001.T`, `fill.first` → `Step_001.FS` (other members keep their spelling). This applies to ST routines too.

Before it, each `after 5s` of a condition (§4.4) is expanded to `step.T >= 5000` with the step before the transition, so `-- after 5s AND ok` below `step fill` exports as `Step_001.T >= 5000 AND ok`.

`TRUE` and `FALSE` are rewritten to `1` and `0`: Studio 5000 ST has no Boolean keywords (found in the tp02 import, 2026-11-26). qSFC keeps accepting `TRUE`/`FALSE` (IEC 61131-3), so `-- TRUE -> idle` exports as the condition `1`. Nothing else in the ST is changed.

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
- several routines in one program, an ST routine, `JSR(name,0);` in ST (from an ST routine and from an SFC action), and operands continuing across two SFC routines (§4.5)
- alias tags with descriptions, the module references and the Program description (§8.2, test pack tp13)

### 8.6 Tidy (Phase 4a)
`qsfc tidy in.L5X [-o out.L5X]` (default `in_tidy.L5X`) re-lays out every SFC routine of an L5X exported from Studio 5000 (program, routine or controller export) with the qSFC layout engine.

- **What changes:** only attribute values, in place in the original text: `X`, `Y`, `DescX`, `DescY` of `Step`, `Transition` and `Stop` (a description keeps its offset from its element), `Y` of `Branch`, `X`/`Y` of a `TextBox` attached to a moved element (`<Attachment>`; it moves with that element, a free text box stays), and `Show` of `DirectedLink` (the jump wires the app draws as cross-references get `Show="false"`, every other wire `Show="true"`, as in §8.2).
- **What never changes:** everything else, byte for byte: links, IDs, operands, actions and qualifiers, conditions, presets, descriptions, tags, other routines, the BOM, CRLF, Studio's line wraps inside long start tags, CDATA.
- **How:** Tidy rebuilds a qSFC structure from the links (chains, `select` / `parallel` blocks, jumps, automatic convergences), runs the normal pipeline on it (parse, validate, lower, layout) and computes the coordinates as the export does (§8.3: rows grow with the action boxes; a step's box counts all its actions' lines plus one header line per extra action). A Stop is laid out as a step with nothing after it.
- **Skip rule:** a routine is left untouched, with a one-sentence reason, when its shape is one qSFC can't draw (e.g. a jump into a parallel leg, a step with two incoming wires and no converge), when it has an element Tidy doesn't know, or when the rebuilt chart's links, mapped back to the original IDs, are not exactly the original `DirectedLink`s (same pairs, same branch types and flows, same legs). Other routines of the file are still tidied.
- **Choosing the structure.** Several qSFC sources can give the same links. qSFC's own export numbers steps and transitions in file order, so Tidy first looks for a structure in that order (tidying a qSFC export changes nothing); otherwise (a chart drawn in Studio) any order. Among the structures that fit it prefers: no steps inside a jumping leg that could follow `end`, then the fewest jumps, then balanced legs, the least nesting, the fewest chains. One known ambiguity: `-- t -> s` right above `step s` (W301) comes back as `-- t` + `step s`.
- **[Verify]** The Stop, SbrRet, TextBox and Attachment formats are assumed (no Studio export with them yet).

### 8.7 Import (Phase 4d)
`qsfc import in.L5X [-o out.qsfc] [--program NAME]` (default `in.qsfc`), and in the app File → **Open an L5X…** (or drop a `.L5X` on the window; the dialog can hand the file to Tidy instead), turns one Program of a Studio 5000 export back into qSFC. A file with several programs (a controller export) imports the exported one (`Use="Target"`), else the first; `--program` or the dialog's list picks another.

- **Routines:** SFC and ST routines, the main routine first. Ladder (RLL), FBD and others are not imported (ladder: Phase 5), nor the routines a routine export only names (`Use="Reference"`): they go on a `uses` line (§4.5), with `(main)` for the main routine, and the code calling them stays as written.
- **Structure:** each chart is rebuilt as Tidy does (§8.6: same search, same check that the links come out exactly as in the file). A chart that can't be rebuilt is not imported, with Tidy's reason.
- **Names:** the first line of the step's tag description (what the export writes, §8.3), else the step's `// name - description` comment, else a plain name from the operand: `Step_003` → `s3`, which pins `Step_003` again on export (§8.2). Stops become `stop<N>`. Transitions take the name in their tag description, except auto names (`T3`), which come back unnamed. An unnamed transition whose operand would change on export is named `tr<N>:` to keep it, and so is one the code refers to (`Tran_005.…`). Operands that still change (a name already taken, a named step) are listed in a note. Action operands are renumbered.
- **Text:** conditions and actions keep Studio's ST, with operands replaced by names (`Step_003.DN` → `s3.DN`); several condition lines are joined, a trailing `;` is dropped, a lone `1`/`0` condition is written `TRUE`/`FALSE`. Sugar (`on`, `set`, `reset`, `call`, `after`) comes back **only where it matches exactly** what the export writes (`a [:=] 1; b [:=] 1;` → `on a, b`; `x := 1;` with a BOOL `x` → `set x`; `JSR(name,0);` → `call name;`; `s1.T >= 3000` right after `s1` → `after 3s`): the import compiles both versions and keeps the plain text wherever the sugar would not export the same way. Studio spellings such as `F:=1;` stay as written.
- **Qualifiers and times:** N S R L D P with the L/D time from the action tag; another qualifier is written as N with a `// Studio qualifier: …` comment.
- **Tags:** `tag` lines for DINT, REAL, TIMER and described BOOL tags, with their values (§7.4); a BOOL used by the code with no description and no value is left to automatic creation. Alias tags of I/O addresses and of tag members become an `io` block. Step and action tags not used by any chart are left out (info note), and so are tags named like operands (`Tran_005`: elements of routines not imported).
- **Controller tags [Phase 4d+]:** the controller's context `<Tags>` of the file are read too (presets of controller step tags, values, aliases, descriptions) and written in the `controller` block (§7.7), always declared (for their scope). A program tag with the same name wins. From a whole-controller export, only the controller tags the program uses. Steps and transitions whose tags are controller tags are listed on `sfc tags` (an unnamed one gets a `tr<N>` name for it), unless the option moves them to the program.
- **Operands of other routines** in the code (`Step_017.DN`) stay as written (§7.3), and their numbers are skipped when the import checks which operands the export would change. A step named from its tag description whose operand would change is named `s<N>` instead, the description keeping the text.
- **Program:** `program name "description"` when the name differs from the main routine's or the program has a description.
- **What can't be kept** is listed in the report and as a comment block at the top of the file, never dropped silently: text boxes (written as `//` comments above the element they are attached to, or at the top of the routine), Stop elements (a step that ends the chain), step alarms and limits, preset expressions, Boolean actions, other tag types (INT, COUNTER, UDTs, arrays: their type is inferred again), aliases that are not I/O addresses, values that can't be written, other routine types.
- **Round trip:** exporting a qSFC file, importing it and exporting again gives the same L5X byte for byte (every test pack file and fixture, `test/import/roundtrip.test.ts`); a chart drawn in Studio comes back with the same wires and step operands (`legacy/tests/MainProgram.L5X`).

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
| E107 | unexpected text `extra` after the step's duration/description / `course` needs a text in quotes: `course "GEI-243"` |
| E108 | `select` is a keyword and can't be used as a name |
| E109 | text can't contain `]]>` (L5X limitation) |
| E110 | qualifier `SL` is not supported yet (N, S, R, L, D, P are) |
| E111 | qualifier `L` needs a duration: `L 10s` / qualifier `S` takes no duration |
| E112 | the `S` action of step `fill` is empty |

**Structure (E2xx)**
| Code | Message (example) |
|---|---|
| E200 | the file has no steps / SFC routine `fill_seq` has no steps |
| E201 | a chain must start with a step; this transition has nothing before it |
| E202 | two steps in a row: `fill` and `check`; add a transition between them |
| E203 | two transitions in a row; add a step between them |
| E204 | `\|` outside a `select` or `parallel` block |
| E205 | `end` without a matching `select` or `parallel` |
| E206 | `select` at line 8 is never closed: add `end` (also an `io` block, §7.6) |
| E207 | a branch needs at least 2 legs (separate them with `\|`) |
| E208 | empty leg between `\|` and `end` |
| E209 | this action line has no step above it (it follows a transition) |
| E210 | `program` must come before the first routine, and appear only once (also `course` and `author`, §4.5) |
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
| E222 | `step` lines belong to an `sfc` routine; `main` is an `st` routine |
| E223 | only `tag` lines, an `io` block and `sfc tags` go in the `controller` block (§7.7) |

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
| E401 | `fill.DNE`: steps have no member `DNE` (did you mean `DN`?) |
| E402 | type of `tmr` unknown (it has member `.DN`): add `tag tmr : TIMER` |
| E403 | `a[3]` needs a declared array tag (not supported yet) |
| E404 | `level` is used as BOOL (line 4) and as REAL (line 9): add `tag level : REAL` |
| E405 | `Step_003` is a reserved name (used for generated operands) |
| E406 | `:=` in a condition: did you mean `=`? |
| E407 | unbalanced `(` / `[`, or an ST string `'` is not closed |
| E408 | tag `count` declared twice with different types |
| E409 | unknown type `TMR` (Phase 1 types: BOOL, DINT, REAL, TIMER) |
| E410 | `pack` is both a step and a tag |
| E413 | `Local:1:I.Data.` is not a valid I/O address / I/O point `start_btn` has no address / `Local1.I.Data.0`: `Local1` is not a tag, a step or an I/O module (§7.6) |
| E414 | `count` is mapped to the bit `Local:1:I.Data.0` but declared as DINT (line 2) |
| E415 | `start_btn` is already mapped to `Local:1:I.Data.0` (line 3) |
| E416 | `after` needs one step before the transition; this transition follows the `end` of a `parallel` block (§4.4) |
| E418 | `x` is declared in the `controller` block here and as a program tag at line 4 / `ejections` is a controller tag: it can't alias `b`, a program tag (§7.7) |
| E419 | `zz` is not a step or a named transition of this file (`sfc tags`, §7.7) |
| E417 | `1.5` is not a DINT value; a value needs the tag's type first; an I/O point can't have a value (§7.4) |
| W400 | `strat_btn` is used only once; did you mean `start_btn`? |
| W401 | `Valve` and `valve` are the same tag; the first spelling is used |
| W402 | the action of `fill` doesn't end with `;` |
| W403 | `valve = 1;` compares and does nothing; did you mean `:=`? |
| W404 | tag `spare` is declared but never used |

**Routines and calls (E6xx / W6xx)**
| Code | Message (example) |
|---|---|
| E600 | `call fil_seq`: there is no routine `fil_seq`; did you mean `fill_seq`? |
| E601 | write `call routine_name;` |
| E602 | `call` is a statement: it can't be used in a condition |
| E603 | `SFR` needs an SFC routine; `calc` is an ST routine (§4.5) |
| E604 | `a` is not a step of `seq` / `Ext` is not in this file: name its step by its operand / the second argument of `SFP` is `Execute` or `Pause` |
| W600 | routine `alarms` is never called (only the main routine runs by itself) |
| W601 | routine `alarms` calls itself |
| W602 | `main` is the main routine: Studio already runs it every scan |
| W603 | ST routine `alarms` is empty |

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
line        = blank | comment | program | uses | controller | meta | header | tag_decl | io_block | step
            | action_line | transition | "select" | "parallel" | "|" | "end" ;

program     = "program" NAME [ STRING ] ;           (* STRING: the title, §4.5 *)
meta        = ( "course" | "author" ) STRING ;      (* before the first routine, once each *)
uses        = "uses" NAME [ "(main)" ] { "," NAME [ "(main)" ] } ;   (* §4.5 *)
controller  = "controller" { tag_decl | io_block | sfc_tags | blank | comment } "end" ;   (* §7.7 *)
sfc_tags    = "sfc" "tags" NAME { "," NAME } ;
header      = ( "sfc" | "st" ) NAME ;
tag_decl    = "tag" NAME [ ":" TYPE [ value ] ] [ STRING ] ;
value       = "=" VALUE | DURATION ;                  (* DURATION: TIMER preset, §7.4 *)
io_block    = "io" { io_line | blank | comment } "end" ;
io_line     = NAME ADDRESS [ STRING ] ;
ADDRESS     = MODULE { ":" WORD } { "." WORD | "[" digits "]" } ;   (* at least one ":", §7.6 *)
            | NAME ( "." WORD | "[" digits "]" ) { "." WORD | "[" digits "]" } ;   (* a tag member *)
step        = ( "init" | "step" ) NAME [ DURATION ] [ STRING ] ;
transition  = "--" [ NAME ":" ] CONDITION [ "->" NAME ] ;
action_line = qualifier_line | sugar_line | ST_TEXT ;   (* any other line *)
qualifier_line = QUALIFIER [ DURATION ] ;  (* N S R L D P, §4.3 *)
sugar_line  = ( "on" | "set" | "reset" ) NAME { "," NAME } [ ";" ] ;

(* structure built from the lines *)
chart       = chain { chain } ;
sequence    = element { element } ;        (* alternation rule, §5.3 *)
element     = step_block | transition | selection | parallel ;
step_block  = step { action_line } ;
selection   = "select" leg { "|" leg } "end" ;
parallel    = "parallel" leg { "|" leg } "end" ;
leg         = sequence ;

(* in CONDITION, the name part ends at "->" outside strings, or at "//" *)
(* in CONDITION, "after" DURATION is a Boolean operand (§4.4); STEP "." MEMBER accepts
   active | done | time | first besides the Studio members (§7.3) *)
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
8. **Phase 4c (2026-11-27).** An `io` point is a tag even when the code never uses it (no W404), and it is always exported as an alias. `io` blocks may appear several times and anywhere a `tag` line can. `after`, `on`, `set`, `reset` and the qualifiers stay usable as tag names outside their positions (§3.4); `course`, `author` and `io` are reserved like the other line keywords.
9. **Phase 4d+ (2026-11-27).** The import mirrors the L5X: controller tags go in a `controller` block at the top of the file, SFC tags at controller scope are listed on `sfc tags` (moving them to the program is an option), routines not imported are named on a `uses` line and the code calling them is kept. Operand names in the code are elements of other routines, with reserved numbers.
