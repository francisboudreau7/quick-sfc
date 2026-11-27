/**
 * Help → Reference → Problems: every diagnostic code with a short example that triggers it and
 * the usual fix (test/app/help.test.ts checks that each example really gives its code).
 */

export interface ProblemDoc {
  code: string;
  /** What it means, short. Backticks mark code. */
  what: string;
  /** How to fix it, short. */
  fix: string;
  /** A chart that gives this code. */
  example: string;
  /** The code shows only when exporting (the program or routine names). */
  exportOnly?: boolean;
}

export interface ProblemGroup {
  title: string;
  items: ProblemDoc[];
}

const L = (...lines: string[]): string => `${lines.join("\n")}\n`;

export const PROBLEM_GROUPS: readonly ProblemGroup[] = [
  {
    title: "Lines and names",
    items: [
      { code: "E100", what: "Old qSFC syntax (`S@name(...)`).", fix: "Write `step name` and `-- condition` lines.", example: L("S@idle()", "init idle", "-- go -> idle") },
      { code: "E101", what: "Not a valid name, or a name is missing.", fix: "Start with a letter or `_`; use letters, digits and `_`.", example: L("init 2fill", "-- go -> 2fill") },
      { code: "E102", what: "Name longer than 40 characters.", fix: "Shorten it.", example: L("init a_name_that_is_much_too_long_for_a_plc_tag", "-- go -> a_name_that_is_much_too_long_for_a_plc_tag") },
      { code: "E103", what: "Name with `__` or ending with `_`.", fix: "Use single underscores, not at the end.", example: L("init fill__a", "-- go -> fill__a") },
      { code: "E104", what: "A duration without a unit.", fix: "Add `ms`, `s`, `m` or `h`.", example: L("init idle", "-- go", "step fill 5", "-- done -> idle") },
      { code: "E105", what: "Unknown unit, or a duration too long.", fix: "Use ms, s, m, h; at most about 24 days.", example: L("init idle", "-- go", "step fill 30d", "-- done -> idle") },
      { code: "E106", what: "A string is not closed.", fix: "Add the closing `\"`.", example: L('init idle "Waiting', "-- go -> idle") },
      { code: "E107", what: "Unexpected text at the end of a line.", fix: "Remove it, or put it in a `//` comment.", example: L("init idle 5s extra", "-- go -> idle") },
      { code: "E108", what: "A keyword used as a name.", fix: "Choose another name.", example: L("init select", "-- go -> select") },
      { code: "E109", what: "Text containing `]]>`.", fix: "Remove `]]>`.", example: L('init idle "a ]]> b"', "-- go -> idle") },
      { code: "E110", what: "A qualifier that isn't supported yet.", fix: "Use N, S, R, L, D or P.", example: L("init idle", "  SL", "    x := 1;", "-- go -> idle") },
      { code: "E111", what: "L and D need a duration; the others take none.", fix: "`L 10s`, `D 2s`; `S` alone.", example: L("init idle", "  L", "    horn [:=] 1;", "-- go -> idle") },
      { code: "E112", what: "An action with no lines.", fix: "Write its lines under the qualifier, or remove it.", example: L("init idle", "  S", "-- go -> idle") },
    ],
  },
  {
    title: "Structure",
    items: [
      { code: "E200", what: "A chart without steps.", fix: "Start with `init name`.", example: L("// nothing yet") },
      { code: "E201", what: "A transition with no step before it.", fix: "Write a step first.", example: L("-- start_btn", "init idle", "-- go -> idle") },
      { code: "E202", what: "Two steps in a row.", fix: "Add a transition between them.", example: L("init idle", "step fill", "-- go -> idle") },
      { code: "E203", what: "Two transitions in a row.", fix: "Add a step between them.", example: L("init idle", "-- start_btn", "-- level_ok", "step fill", "-- go -> idle") },
      { code: "E204", what: "`|` outside a branch.", fix: "Use `|` only between legs of `select` or `parallel`.", example: L("init idle", "|", "-- go -> idle") },
      { code: "E205", what: "`end` without `select` or `parallel`.", fix: "Remove it, or open the branch.", example: L("init idle", "-- go -> idle", "end") },
      { code: "E206", what: "A block never closed.", fix: "Add `end`.", example: L("init idle", "select", "  -- a", "  step x", "  -- b -> idle", "|", "  -- c", "  step y", "  -- d -> idle") },
      { code: "E207", what: "A branch with one leg.", fix: "Add a leg after `|`, or remove the branch.", example: L("init idle", "select", "  -- a", "  step x", "  -- b -> idle", "end") },
      { code: "E208", what: "An empty leg.", fix: "Write the leg's lines, or remove the `|`.", example: L("init idle", "select", "  -- a", "  step x", "  -- b -> idle", "|", "end") },
      { code: "E209", what: "An action line with no step above.", fix: "Move it under a step.", example: L("init idle", "-- go", "  valve [:=] 1;", "step fill", "-- done -> idle") },
      { code: "E210", what: "A header line in the wrong place, or twice.", fix: "`program`, `uses`, `controller` come before the first routine, once.", example: L("init idle", "-- go -> idle", 'program tank "Tank"') },
      { code: "E211", what: "`select` not after a step.", fix: "Put the step that chooses before `select`.", example: L("init idle", "-- go", "select", "  -- a", "  step x", "  -- b -> idle", "|", "  -- c", "  step y", "  -- d -> idle", "end") },
      { code: "E212", what: "A `select` leg that starts with a step.", fix: "Start each leg with `-- condition`.", example: L("init idle", "select", "  step x", "  -- b -> idle", "|", "  -- c", "  step y", "  -- d -> idle", "end") },
      { code: "E213", what: "A `select` leg that ends with a step.", fix: "End each leg with a transition.", example: L("init idle", "select", "  -- a", "  step x", "|", "  -- c", "  step y", "  -- d -> idle", "end", "step z", "-- e -> idle") },
      { code: "E214", what: "Legs that don't jump have nowhere to merge.", fix: "Add a step after `end`.", example: L("init idle", "select", "  -- a", "  step x", "  -- b", "|", "  -- c", "  step y", "  -- d", "end") },
      { code: "E215", what: "`parallel` not after a transition.", fix: "Put the transition that starts both legs before it.", example: L("init idle", "parallel", "  step x", "|", "  step y", "end", "-- go -> idle") },
      { code: "E216", what: "A `parallel` leg that starts with a transition.", fix: "Start each leg with a step.", example: L("init idle", "-- go", "parallel", "  -- a", "  step x", "|", "  step y", "end", "-- done -> idle") },
      { code: "E217", what: "A `parallel` leg that ends with a transition.", fix: "End each leg with a step.", example: L("init idle", "-- go", "parallel", "  step x", "  -- a", "|", "  step y", "end", "-- done -> idle") },
      { code: "E218", what: "Nothing after a `parallel` block.", fix: "Add the transition that waits for every leg.", example: L("init idle", "-- go", "parallel", "  step x", "|", "  step y", "end") },
      { code: "E219", what: "Text after a jump target.", fix: "One step name after `->`.", example: L("init idle", "-- go -> idle now") },
      { code: "E220", what: "A jump in the middle of a branch.", fix: "A jump ends a `select` leg.", example: L("init idle", "select", "  -- a -> idle", "  step x", "  -- b -> idle", "|", "  -- c", "  step y", "  -- d -> idle", "end") },
      { code: "E221", what: "Every leg of an inner `select` jumps away.", fix: "Let one leg continue.", example: L("init idle", "-- go", "parallel", "  step p", "  select", "    -- a -> idle", "  |", "    -- b -> idle", "  end", "|", "  step q", "end", "-- z -> idle") },
      { code: "E222", what: "Chart lines in an `st` routine.", fix: "Start an `sfc` routine first.", example: L("st main", "  x := 1;", "step fill") },
      { code: "E223", what: "Another line in the `controller` block.", fix: "Only `tag`, `io … end` and `sfc tags`.", example: L("controller", "  x := 1;", "end", "init idle", "-- go -> idle") },
      { code: "E224", what: "`else` that doesn't open the last leg of a `select`.", fix: "Move that leg last, or write its condition.", example: L("init idle", "-- else", "step run", "-- stop -> idle") },
    ],
  },
  {
    title: "Chart rules",
    items: [
      { code: "E300", what: "No initial step.", fix: "Write `init` instead of `step` on one step.", example: L("step idle", "-- go -> idle") },
      { code: "E301", what: "Two initial steps.", fix: "Keep one `init`.", example: L("init idle", "-- go", "init fill", "-- done -> idle") },
      { code: "E302", what: "The initial step inside `parallel`.", fix: "Put it before the branch.", example: L("step a", "-- go", "parallel", "  init x", "|", "  step y", "end", "-- done -> a") },
      { code: "E303", what: "A jump to a step that doesn't exist.", fix: "Check the spelling.", example: L("init idle", "-- go -> idel") },
      { code: "E304", what: "A jump to a transition.", fix: "Jump to a step.", example: L("init idle", "-- go: start_btn", "step fill", "-- done -> go") },
      { code: "E305", what: "A jump into or out of `parallel`.", fix: "Leave a parallel block through its `end`.", example: L("init idle", "-- go", "parallel", "  step x", "  -- a -> idle", "  step x2", "|", "  step y", "end", "-- done -> idle") },
      { code: "E306", what: "A step nothing can reach.", fix: "Jump to it, or connect it to the flow.", example: L("init idle", "-- go -> idle", "step lost", "-- x -> idle") },
      { code: "E307", what: "A transition without a condition.", fix: "Write a condition; `TRUE` to go on at once.", example: L("init idle", "--", "step fill", "-- done -> idle") },
      { code: "E308", what: "A transition that leads nowhere.", fix: "Add `-> step`, or a step after it.", example: L("init idle", "-- go") },
      { code: "E309", what: "A name used twice.", fix: "Names are shared by the whole file: rename one.", example: L("init idle", "-- go", "step idle", "-- done -> idle") },
      { code: "W300", what: "A step with nothing after it: the chart stops.", fix: "Add a transition (a jump back), if it shouldn't stop.", example: L("init idle", "-- go", "step fill") },
      { code: "W301", what: "A jump to the very next step.", fix: "Remove `-> name`: the flow goes there anyway.", example: L("init idle", "-- go -> fill", "step fill", "-- done -> idle") },
      { code: "W302", what: "`.DN` of a step with no preset: TRUE at once.", fix: "Give the step a duration.", example: L("init idle", "-- go", "step fill", "-- fill.DN -> idle") },
    ],
  },
  {
    title: "Tags and ST",
    items: [
      { code: "E400", what: "A step name used alone.", fix: "Use a member: `fill.X` (active).", example: L("init idle", "-- go", "step fill", "-- fill -> idle") },
      { code: "E401", what: "A step member that doesn't exist.", fix: "X FS DN T Count… or active, done, time, first.", example: L("init idle", "-- go", "step fill 5s", "-- fill.Done2 -> idle") },
      { code: "E402", what: "A member of a tag whose type is unknown.", fix: "Declare it: `tag t1 : TIMER`.", example: L("init idle", "-- t1.DN -> idle") },
      { code: "E403", what: "An array index.", fix: "Arrays are not supported yet.", example: L("init idle", "-- a[1] -> idle") },
      { code: "E404", what: "A tag used as two types.", fix: "Declare its type with a `tag` line.", example: L("init idle", "  n := 5;", "-- n -> idle") },
      { code: "E405", what: "A reserved name (`Step_003`, a keyword).", fix: "Rename it; write the step's own name.", example: L("init s3", "-- Step_003.X -> s3") },
      { code: "E406", what: "`:=` in a condition.", fix: "Compare with `=`.", example: L("init idle", "-- x := 1 -> idle") },
      { code: "E407", what: "Unbalanced brackets or an open ST string.", fix: "Close what you opened.", example: L("init idle", "-- (a AND b -> idle") },
      { code: "E408", what: "A tag declared twice with two types.", fix: "Keep one `tag` line.", example: L("tag n : DINT", "tag n : REAL", "init idle", "  n := 1;", "-- go -> idle") },
      { code: "E409", what: "An unknown type.", fix: "BOOL, DINT, REAL or TIMER.", example: L("tag n : INT", "init idle", "  n := 1;", "-- go -> idle") },
      { code: "E410", what: "A name that is a step (or routine) and a tag.", fix: "Rename one.", example: L("tag fill : BOOL", "init idle", "-- go", "step fill", "-- done -> idle") },
      { code: "E413", what: "A bad I/O address.", fix: "Write a module path: `Local:1:I.Data.0`.", example: L("io", "  start_btn  Local1", "end", "init idle", "-- start_btn -> idle") },
      { code: "E414", what: "A bit address on a non-BOOL tag.", fix: "A bit is BOOL.", example: L("tag n : DINT", "io", "  n  Local:1:I.Data.0", "end", "init idle", "-- n > 1 -> idle") },
      { code: "E415", what: "A name mapped twice.", fix: "Keep one `io` line per name.", example: L("io", "  b  Local:1:I.Data.0", "  b  Local:1:I.Data.1", "end", "init idle", "-- b -> idle") },
      { code: "E416", what: "`after` with no single step before it.", fix: "Use `step.T >= ms` after a parallel `end`.", example: L("init idle", "-- go", "parallel", "  step x", "|", "  step y", "end", "-- after 5s -> idle") },
      { code: "E417", what: "A value that doesn't fit the tag.", fix: "BOOL 0/1, DINT whole, REAL, TIMER a duration.", example: L("tag n : DINT = 1.5", "init idle", "  n := 1;", "-- go -> idle") },
      { code: "E418", what: "A tag at two scopes, or a controller alias of a program tag.", fix: "Keep one scope.", example: L("controller", "  tag x : DINT", "end", "tag x : DINT", "init idle", "  x := 1;", "-- go -> idle") },
      { code: "E419", what: "`sfc tags` lists something that isn't a step or transition.", fix: "List step and transition names.", example: L("controller", "  sfc tags zz", "end", "init idle", "-- go -> idle") },
      { code: "W400", what: "A tag used once, close to another name: a typo?", fix: "Fix the spelling if it is one.", example: L("init idle", "-- start_btn", "step fill", "  valve [:=] 1;", "-- start_bnt AND start_btn -> idle") },
      { code: "W401", what: "One tag written two ways.", fix: "Use one spelling.", example: L("init idle", "-- Start AND start -> idle") },
      { code: "W402", what: "An action that doesn't end with `;`.", fix: "End each statement with `;`.", example: L("init idle", "  valve [:=] 1", "-- go -> idle") },
      { code: "W403", what: "`=` in an action compares and does nothing.", fix: "Assign with `:=`.", example: L("init idle", "  valve = 1;", "-- go -> idle") },
      { code: "W404", what: "A declared tag that nothing uses.", fix: "Use it or remove the line.", example: L("tag spare : DINT", "init idle", "-- go -> idle") },
    ],
  },
  {
    title: "Routines and calls",
    items: [
      { code: "E600", what: "A call to a routine that doesn't exist.", fix: "Check the name, or list it on a `uses` line.", example: L("st main", "  call fil_seq;", "", "sfc fill_seq", "init idle", "-- go -> idle") },
      { code: "E601", what: "A malformed `call`.", fix: "`call name;`", example: L("st main", "  call a b;") },
      { code: "E602", what: "`call` in a condition.", fix: "Call from an action.", example: L("st main", "  call seq;", "", "sfc seq", "init idle", "-- call seq -> idle") },
      { code: "E603", what: "SFR / SFP on an ST routine.", fix: "Name an SFC routine.", example: L("st main", "  SFR(calc, idle);", "", "st calc", "  x := 1;") },
      { code: "E604", what: "A wrong second argument of SFR / SFP.", fix: "SFR: a step of that routine; SFP: Execute or Pause.", example: L("st main", "  call seq;", "  SFP(seq, Run);", "", "sfc seq", "init idle", "-- go -> idle") },
      { code: "W600", what: "A routine nothing calls.", fix: "Call it from the main routine or an action.", example: L("st main", "  x := 1;", "", "sfc seq", "init idle", "-- go -> idle") },
      { code: "W601", what: "A routine calling itself.", fix: "Remove the call.", example: L("st main", "  call main;") },
      { code: "W602", what: "A call to the main routine.", fix: "The main routine already runs every scan.", example: L("st main", "  call seq;", "", "sfc seq", "init idle", "  call main;", "-- go -> idle") },
      { code: "W603", what: "An empty ST routine.", fix: "Write its lines, or remove it.", example: L("st main", "  call calc;", "", "st calc") },
    ],
  },
  {
    title: "Chart logic",
    items: [
      { code: "W700", what: "Two legs of a `select` true at the same time.", fix: "Make them exclusive, e.g. write the last one `-- else`.", example: L("init idle", "select", "  -- ok", "  step run", "  -- stop -> idle", "|", "  -- big", "  step slow", "  -- stop -> idle", "end") },
      { code: "W701", what: "A tag written in two parallel legs.", fix: "Write it in one leg only.", example: L("init idle", "-- go", "parallel", "  step fill", "    on valve", "|", "  step heat", "    valve [:=] 0;", "end", "-- done -> idle") },
      { code: "W702", what: "An S action nothing resets.", fix: "Add an R action writing the same tag in a later step.", example: L("init idle", "  S", "    lock := 1;", "-- go", "step run", "-- stop -> idle") },
      { code: "W703", what: "A step that can never be left.", fix: "Check its conditions.", example: L("init idle", "-- go AND NOT go", "step run", "-- stop -> idle") },
      { code: "W704", what: "An `else` leg that can never run.", fix: "Remove one of the legs.", example: L("init idle", "select", "  -- go", "  step run", "  -- stop -> idle", "|", "  -- NOT go", "  step wait", "  -- stop -> idle", "|", "  -- else", "  step never", "  -- stop -> idle", "end") },
    ],
  },
  {
    title: "Export",
    items: [
      { code: "E501", what: "A bad PLC software revision (command line `--version`).", fix: "Like `32.01`.", example: L("init idle", "-- go -> idle"), exportOnly: true },
      { code: "E502", what: "A routine named after the file clashes, or a name the PLC refuses.", fix: "Name the routine: `sfc name`.", example: L("init idle", "-- go -> idle", "", "st example", "  x := 1;"), exportOnly: true },
    ],
  },
];

export function findProblem(code: string): ProblemDoc | undefined {
  for (const g of PROBLEM_GROUPS) for (const p of g.items) if (p.code === code) return p;
  return undefined;
}
