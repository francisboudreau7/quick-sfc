/**
 * Help → Learning qSFC and Reference (Phase 4d+, mockup docs/mockups/help): example-first pages.
 * Text is short; backticks mark code. Every example compiles without problems unless `broken`
 * (test/app/help.test.ts).
 */

export interface Lesson {
  id: string;
  title: string;
  /** One or two sentences. */
  lead: string;
  example: string;
  /** Three or four "code → meaning" lines under the playground. */
  summary: Array<[string, string]>;
  tries: Array<{ prompt: string; solution?: string }>;
  /** The example has problems on purpose (lesson "Reading the problems"). */
  broken?: boolean;
}

export interface RefEntry {
  id: string;
  group: string;
  title: string;
  /** The form, as code. */
  syntax: string;
  example?: string;
  /** At most five short rules. */
  rules: string[];
  /** Problem codes this feature can give (Reference → Problems). */
  problems: string[];
  /** Other entries (ids). */
  see: string[];
}

const L = (...lines: string[]): string => `${lines.join("\n")}\n`;

// ---- Learning ----------------------------------------------------------------------------------

export const LESSONS: readonly Lesson[] = [
  {
    id: "steps",
    title: "Steps and transitions",
    lead: "A chart is steps joined by transitions. A transition (`--`) holds the condition to move on; `init` is the step active at start.",
    example: L("init idle", "-- start_btn", "step running", "-- stop_btn -> idle"),
    summary: [
      ["init idle", "the initial step"],
      ["step running", "a step"],
      ["-- start_btn", "a transition and its condition"],
      ["-> idle", "jump back to a step"],
    ],
    tries: [
      { prompt: "Add a step `cleaning` after `running`, left when `clean_done` is on.", solution: L("init idle", "-- start_btn", "step running", "-- stop_btn", "step cleaning", "-- clean_done -> idle") },
      { prompt: "Name the first transition `go`.", solution: L("-- go: start_btn") },
    ],
  },
  {
    id: "actions",
    title: "Actions: driving outputs",
    lead: "Lines under a step are its action: they run while the step is active.",
    example: L("init idle", "-- start_btn", "step filling", "  on valve, pump", "  speed := 1500;", "-- level_high", "step full", "  set done_lamp", "-- ack_btn", "step reset_lamp", "  reset done_lamp", "-- TRUE -> idle"),
    summary: [
      ["on valve, pump", "on while the step is active"],
      ["set done_lamp", "stays on after the step"],
      ["reset done_lamp", "turns it off"],
      ["speed := 1500;", "any ST statement"],
    ],
    tries: [
      { prompt: "Also run `mixer` while filling.", solution: L("  on valve, pump, mixer") },
      { prompt: "Write `on valve` as plain ST.", solution: L("  valve [:=] 1;   // [:=]: back to 0 when the step ends") },
    ],
  },
  {
    id: "time",
    title: "Time",
    lead: "Every step has its own timer. Give it a preset; `.done` turns on when it runs out.",
    example: L("init idle", "-- start_btn", "step fill 5s", "  on valve", "-- fill.done", "step drain", "  on drain_valve", "-- after 3s -> idle"),
    summary: [
      ["step fill 5s", "preset: 5 s (ms s m h, `1m30s`)"],
      ["fill.done", "the preset has elapsed (`fill.time`: ms active)"],
      ["-- after 3s", "the step above has been active 3 s"],
    ],
    tries: [
      { prompt: "Make filling last 2 minutes.", solution: L("step fill 2m") },
      { prompt: "Stop filling early when `level_high` is on.", solution: L("-- fill.done OR level_high") },
      { prompt: "Light `busy_lamp` while filling or draining.", solution: L("step fill 5s", "  on valve, busy_lamp", "-- fill.done", "step drain", "  on drain_valve, busy_lamp") },
    ],
  },
  {
    id: "select",
    title: "Choosing a path",
    lead: "After a step, `select` offers several transitions. The first true one wins and only its leg runs.",
    example: L("init wait", "-- part_present", "step measure 1s", "select", "  -- measure.done AND big", "  step push_big", "    on pusher_big", "  -- big_out -> wait", "|", "  -- measure.done AND NOT big", "  step push_small", "    on pusher_small", "  -- small_out -> wait", "end"),
    summary: [
      ["select", "opens the choice, after a step"],
      ["|", "separates the legs"],
      ["end", "closes it"],
    ],
    tries: [
      { prompt: "Add a third leg: parts that are `bad` go to `reject`.", solution: L("|", "  -- measure.done AND bad", "  step reject", "    on reject_gate", "  -- reject_out -> wait") },
      { prompt: "Instead of jumping back, let both legs meet on a step `count` after `end`.", solution: L("  -- big_out", "|", "  ...", "  -- small_out", "end", "step count", "-- TRUE -> wait") },
    ],
  },
  {
    id: "parallel",
    title: "Doing two things at once",
    lead: "`parallel` starts every leg together. The transition after `end` waits until every leg has reached its last step.",
    example: L("init ready", "-- start_btn", "parallel", "  step fill", "    on fill_valve", "  -- level_high", "  step full", "|", "  step mix 10s", "    on mixer", "  -- mix.done", "  step mixed", "end", "-- outlet_ok", "step drain 5s", "  on drain_valve", "-- drain.done -> ready"),
    summary: [
      ["parallel", "opens the block, after a transition"],
      ["step full / step mixed", "each leg ends with a step"],
      ["-- outlet_ok", "fires when every leg is done and the condition is true"],
    ],
    tries: [
      { prompt: "Add a third leg that heats until `temp_ok`.", solution: L("|", "  step heat", "    on heater", "  -- temp_ok", "  step hot") },
    ],
  },
  {
    id: "jumps",
    title: "Jumps and loops",
    lead: "`->` sends the flow to any step of the chart. A step reached by several paths merges them.",
    example: L("init idle", "-- start_btn", "step try 10s", "  on motor", "select", "  -- part_ok", "  step done", "  -- ack_btn -> idle", "|", "  -- try.done AND try.Count < 3", "  step pause 2s", "  -- pause.done -> try", "|", "  -- try.done AND try.Count >= 3", "  step fault", "    on alarm", "  -- reset_btn -> idle", "end"),
    summary: [
      ["-- pause.done -> try", "loop back to retry"],
      ["try.Count", "how many times `try` became active"],
      ["-- reset_btn -> idle", "several jumps may reach one step"],
    ],
    tries: [
      { prompt: "Allow 5 tries instead of 3.", solution: L("  -- try.done AND try.Count < 5", "  -- try.done AND try.Count >= 5") },
    ],
  },
  {
    id: "tags",
    title: "Tags, types and I/O",
    lead: "Every name you use becomes a tag; its type comes from how you use it. `io` and `tag` lines say more.",
    example: L("io", '  start_btn  Local:1:I.Data.0  "Start push button"', '  motor      Local:1:O.Data.0  "Motor contactor"', "end", 'tag target : DINT = 10 "Parts per batch"', "", "init idle", "-- start_btn", "step run", "  on motor", "-- parts >= target", "step done", "  set done_lamp", "-- ack_btn -> idle"),
    summary: [
      ["io … end", "names for I/O points (a bit is BOOL)"],
      ["tag target : DINT = 10", "type, initial value, description"],
      ["parts >= target", "no line needed: `parts` is a number from its use"],
    ],
    tries: [
      { prompt: "Give `parts` a description.", solution: L('tag parts : DINT "Parts counted"') },
      { prompt: "Map `done_lamp` to output bit 1.", solution: L("  done_lamp  Local:1:O.Data.1") },
    ],
  },
  {
    id: "qualifiers",
    title: "Action qualifiers",
    lead: "A line with only a qualifier starts another action of the step: N while active, S stored until R, L limited, D delayed, P once.",
    example: L("init idle", "-- start_btn", "step heat 20s", "  on heater", "  S", "    door_lock := 1;", "  L 5s", "    buzzer [:=] 1;", "  D 2s", "    light [:=] 1;", "  P", "    cycles := cycles + 1;", "-- heat.done", "step done", "  R", "    door_lock := 0;", "-- ack_btn -> idle"),
    summary: [
      ["S / R", "stored: stays after the step, until reset"],
      ["L 5s / D 2s", "limited to 5 s / starts after 2 s"],
      ["P", "once, when the step becomes active"],
    ],
    tries: [
      { prompt: "Count a cycle when `done` is reached instead.", solution: L("step done", "  P", "    cycles := cycles + 1;") },
    ],
  },
  {
    id: "routines",
    title: "Several routines",
    lead: "A file can hold several routines. The first one runs every scan; the others run when called.",
    example: L("st main", "  call modes;", "  call cycle;", "", "sfc modes", "init manual", "  SFR(cycle, wait);", "  SFP(cycle, Pause);", "-- auto_sw", "step automatic", "  SFP(cycle, Execute);", "-- NOT auto_sw -> manual", "", "sfc cycle", "init wait", "-- start_btn", "step run 4s", "  on conveyor", "-- run.done -> wait"),
    summary: [
      ["st main / sfc cycle", "an ST routine, an SFC routine"],
      ["call cycle;", "runs it"],
      ["SFR(cycle, wait);", "resets a chart to a step"],
      ["SFP(cycle, Pause);", "pauses it (`Execute` resumes)"],
    ],
    tries: [
      { prompt: "Light `run_lamp` from `main` while `cycle` is in `run`.", solution: L("st main", "  call modes;", "  call cycle;", "  run_lamp := run.X;") },
    ],
  },
  {
    id: "problems",
    title: "Reading the problems",
    lead: "Each mistake is listed with its code, its line and a hint. Fix them one by one; the diagram comes back when there are no errors.",
    example: L("init idle", "-- start_btn", "step fill 5", "  valve [:=] 1", "-- fill.done -> idel"),
    broken: true,
    summary: [
      ["E104", "`5` has no unit"],
      ["W402", "the action doesn't end with `;`"],
      ["E303", "`idel` is not a step: did you mean `idle`?"],
    ],
    tries: [{ prompt: "Fix the three problems.", solution: L("init idle", "-- start_btn", "step fill 5s", "  valve [:=] 1;", "-- fill.done -> idle") }],
  },
];

// ---- Reference ---------------------------------------------------------------------------------

export const REFERENCE: readonly RefEntry[] = [
  // Basics
  {
    id: "lines",
    group: "Basics",
    title: "Files and lines",
    syntax: L("program …   uses …   controller … end   io … end   tag …", "sfc name   st name", "init   step   --   select   parallel   |   end", "anything else: an action line"),
    example: L("// A comment line", "init idle        // a step", "-- start_btn     // a transition", "step run", "  on motor       // an action line", "-- stop_btn -> idle"),
    rules: ["One element per line; the first word says what the line is.", "Keywords are case-insensitive.", "Indentation is only for reading."],
    problems: ["E100", "E107"],
    see: ["names", "comments"],
  },
  {
    id: "names",
    group: "Basics",
    title: "Names",
    syntax: L("fill   Pump_2   _spare"),
    example: L("init idle", "-- start_btn", "step fill_tank", "-- level_high -> idle"),
    rules: ["Letters, digits and `_`; start with a letter or `_`; at most 40.", "No `__`, no `_` at the end.", "Steps, transitions, tags and routines share one set of names.", "Keywords and `Step_12`-like names are reserved."],
    problems: ["E101", "E102", "E103", "E108", "E309", "E405"],
    see: ["steps", "tags-auto"],
  },
  {
    id: "comments",
    group: "Basics",
    title: "Comments",
    syntax: L("// to the end of the line", "(* inside ST *)"),
    example: L("// the cycle", "init idle", "-- start_btn   // push button", "step run", "  on motor     // kept in the action", "-- stop_btn -> idle"),
    rules: ["Kept in actions and ST routines; dropped elsewhere."],
    problems: [],
    see: ["lines"],
  },
  {
    id: "durations",
    group: "Basics",
    title: "Durations",
    syntax: L("500ms   5s   2m   1h   1m30s"),
    example: L("init idle", "-- start_btn", "step fill 1m30s", "-- fill.done -> idle"),
    rules: ["A unit is required.", "Up to about 24 days."],
    problems: ["E104", "E105"],
    see: ["steps", "after"],
  },
  // Chart
  {
    id: "steps",
    group: "Chart",
    title: "Steps",
    syntax: L('init name [duration] ["description"]', 'step name [duration] ["description"]'),
    example: L('init idle "Waiting for a part"', "-- start_btn", 'step fill 10s "Fill the tank"', "-- fill.done -> idle"),
    rules: ["One `init` per chart: the step active at start.", "The duration is the step's preset (`fill.done`).", "Two steps in a row need a transition between them."],
    problems: ["E300", "E301", "E202", "E306"],
    see: ["transitions", "members", "actions-st"],
  },
  {
    id: "transitions",
    group: "Chart",
    title: "Transitions",
    syntax: L("-- condition", "-- name: condition", "-- condition -> step"),
    example: L("init idle", "-- go: start_btn AND NOT fault", "step run", "-- stop_btn -> idle"),
    rules: ["Between two steps; the flow moves on when the step above is active and the condition is true.", "Unnamed ones are `T1`, `T2`… in the diagram.", "`TRUE` moves on at once."],
    problems: ["E203", "E307", "E308", "E201"],
    see: ["conditions", "jumps", "after"],
  },
  {
    id: "conditions",
    group: "Chart",
    title: "Conditions",
    syntax: L("a AND NOT b   level > 80   fill.done OR (x XOR y)"),
    example: L("init idle", "-- start_btn AND (auto OR manual_ok)", "step run 5s", "-- run.done OR speed >= 1500 -> idle"),
    rules: ["A Boolean ST expression: `AND` `OR` `XOR` `NOT`, comparisons, step members.", "`=` compares; `:=` is for actions."],
    problems: ["E406", "E407", "E400", "W401"],
    see: ["members", "after"],
  },
  {
    id: "after",
    group: "Chart",
    title: "after",
    syntax: L("-- after 5s", "-- after 2s AND ok"),
    example: L("init idle", "-- start_btn", "step blink", "  on lamp", "-- after 500ms", "step dark", "-- after 500ms -> blink"),
    rules: ["True when the step above the transition has been active that long.", "Needs no preset on the step.", "Not after the `end` of a `parallel`."],
    problems: ["E416"],
    see: ["members", "durations"],
  },
  {
    id: "jumps",
    group: "Chart",
    title: "Jumps",
    syntax: L("-- condition -> step"),
    example: L("init idle", "-- start_btn", "step run", "select", "  -- fault -> alarm", "|", "  -- stop_btn", "  step stopping 2s", "  -- stopping.done", "end", "step park", "-- TRUE -> idle", "", "step alarm", "  on horn", "-- reset_btn -> idle"),
    rules: ["To any step of the same routine.", "Several jumps to one step merge there.", "Inside a branch, a jump ends a `select` leg; never into or out of a `parallel`."],
    problems: ["E303", "E304", "E305", "E220", "W301"],
    see: ["chains", "merge"],
  },
  {
    id: "chains",
    group: "Chart",
    title: "Chains",
    syntax: L("-- x -> a", "step b      // a new chain, reached by a jump"),
    example: L("init idle", "-- start_btn", "step run", "select", "  -- fault -> alarm", "|", "  -- stop_btn", "  step stopping 2s", "  -- stopping.done", "end", "step park", "-- TRUE -> idle", "", "step alarm", "  on horn", "-- reset_btn -> idle"),
    rules: ["After a jump, the next step starts a new chain.", "A chain must be reached by a jump."],
    problems: ["E306", "E201"],
    see: ["jumps"],
  },
  {
    id: "end-of-chart",
    group: "Chart",
    title: "End of a chart",
    syntax: L("step done      // nothing after it: the chart stops here"),
    example: L("init idle", "-- start_btn", "step done", "-- TRUE -> idle"),
    rules: ["A chart usually loops back with a jump.", "Ending on a step is allowed (a warning); ending on a transition is not."],
    problems: ["W300", "E308"],
    see: ["jumps"],
  },
  // Branches
  {
    id: "select",
    group: "Branches",
    title: "select",
    syntax: L("select", "  -- condition", "  …", "|", "  -- condition", "  …", "end"),
    example: L("init wait", "-- part_present", "step measure 1s", "select", "  -- measure.done AND big", "  step push_big", "    on pusher_big", "  -- big_out -> wait", "|", "  -- measure.done AND NOT big", "  step push_small", "    on pusher_small", "  -- small_out -> wait", "end"),
    rules: ["Follows a step; each leg starts with a transition.", "Legs are tested left to right: the first true condition wins.", "A leg ends with a transition: a jump, or one that merges on the step after `end`.", "At least two legs, separated by `|`."],
    problems: ["E211", "E212", "E213", "E214", "E207", "E208"],
    see: ["parallel", "jumps", "merge"],
  },
  {
    id: "parallel",
    group: "Branches",
    title: "parallel",
    syntax: L("parallel", "  step …", "  …", "|", "  step …", "end", "-- condition"),
    example: L("init ready", "-- start_btn", "parallel", "  step fill", "  -- level_high", "  step full", "|", "  step mix 10s", "  -- mix.done", "  step mixed", "end", "-- TRUE -> ready"),
    rules: ["Follows a transition; each leg starts and ends with a step.", "Every leg starts together.", "The transition after `end` waits for every leg's last step.", "No jumps in or out."],
    problems: ["E215", "E216", "E217", "E218", "E305", "E302"],
    see: ["select", "nesting"],
  },
  {
    id: "nesting",
    group: "Branches",
    title: "Nesting",
    syntax: L("parallel", "  step a", "  select", "    …", "  end", "  step b", "|", "  …", "end"),
    example: L("init idle", "-- start_btn", "parallel", "  step check", "  select", "    -- ok", "    step good", "    -- TRUE", "  |", "    -- NOT ok", "    step bad", "    -- TRUE", "  end", "  step checked", "|", "  step move", "  -- in_place", "  step moved", "end", "-- TRUE -> idle"),
    rules: ["Branches can hold branches.", "Inside a `parallel`, a `select` must let one leg continue."],
    problems: ["E221"],
    see: ["select", "parallel"],
  },
  {
    id: "merge",
    group: "Branches",
    title: "Merging legs",
    syntax: L("-- a -> next", "…", "-- b -> next     // both reach the step `next`"),
    example: L("init idle", "select", "  -- auto_sw", "  step auto_run", "  -- stop_btn -> park", "|", "  -- NOT auto_sw", "  step manual", "  -- stop_btn -> park", "end", "", "step park", "-- TRUE -> idle"),
    rules: ["A step reached by several paths merges them: no extra line needed.", "Legs that don't jump merge on the step after `end`."],
    problems: ["E214"],
    see: ["jumps", "select"],
  },
  // Actions
  {
    id: "actions-st",
    group: "Actions",
    title: "Action lines (ST)",
    syntax: L("step fill", "  valve [:=] 1;     // back to 0 when the step ends", "  count := 0;       // stays"),
    example: L("init idle", "-- start_btn", "step fill", "  valve [:=] 1;", "  IF level > 80 THEN", "    alarm [:=] 1;", "  END_IF;", "-- level_high -> idle"),
    rules: ["The lines under a step; they run every scan while it is active.", "`[:=]` is reset when the step ends; `:=` keeps its value.", "End each statement with `;`."],
    problems: ["E209", "W402", "W403"],
    see: ["sugar", "qualifiers"],
  },
  {
    id: "sugar",
    group: "Actions",
    title: "on, set, reset",
    syntax: L("  on a, b       // a [:=] 1;  b [:=] 1;", "  set alarm      // alarm := 1;", "  reset alarm    // alarm := 0;"),
    example: L("init idle", "  reset done_lamp", "-- start_btn", "step run", "  on motor, run_lamp", "-- stop_btn", "step done", "  set done_lamp", "-- TRUE -> idle"),
    rules: ["Short forms of the usual BOOL outputs.", "The names are BOOL tags."],
    problems: [],
    see: ["actions-st", "qualifiers"],
  },
  {
    id: "qualifiers",
    group: "Actions",
    title: "Qualifiers N S R L D P",
    syntax: L("  N            // default: while active", "  S            // stored", "  R            // resets a stored action", "  L 5s         // limited", "  D 2s         // delayed", "  P            // once"),
    example: L("init idle", "-- start_btn", "step heat 20s", "  on heater", "  S", "    door_lock := 1;", "  L 5s", "    buzzer [:=] 1;", "  P", "    cycles := cycles + 1;", "-- heat.done", "step done", "  R", "    door_lock := 0;", "-- ack_btn -> idle"),
    rules: ["A line with only a qualifier starts an action; its lines follow, indented.", "L and D take a duration; the others don't.", "The lines before the first qualifier are an N action."],
    problems: ["E110", "E111", "E112"],
    see: ["actions-st", "sugar"],
  },
  // Tags
  {
    id: "tags-auto",
    group: "Tags",
    title: "Automatic tags and types",
    syntax: L("a AND b        // BOOL", "n := n + 1;    // DINT", "t := 1.5;      // REAL"),
    example: L("init idle", "-- start_btn", "step run", "  speed := 1500;", "  ratio := 0.5;", "-- speed > 1000 AND sensor -> idle"),
    rules: ["Every name in conditions and actions is a tag.", "Its type comes from its use; BOOL when nothing says otherwise.", "The Tags panel lists them with their type and uses."],
    problems: ["E404", "W400", "W401"],
    see: ["tag-lines"],
  },
  {
    id: "tag-lines",
    group: "Tags",
    title: "tag lines and values",
    syntax: L('tag name [: TYPE [value]] ["description"]'),
    example: L('tag target : DINT = 10 "Parts per batch"', "tag t_cool : TIMER 3s", "tag ready : BOOL = 1", "", "init idle", "-- ready AND parts >= target", "step cool", "  TON(t_cool, 1, 0);", "-- t_cool.DN -> idle"),
    rules: ["Types: BOOL, DINT, REAL, TIMER.", "Value after the type: `= 1`, `= 2.5`; a TIMER's preset as a duration.", "A tag line may appear anywhere."],
    problems: ["E408", "E409", "E417", "W404"],
    see: ["tags-auto", "io"],
  },
  {
    id: "members",
    group: "Tags",
    title: "Step members",
    syntax: L("fill.active   fill.X     step active", "fill.done     fill.DN    preset elapsed", "fill.time     fill.T     ms active", "fill.first    fill.FS    first scan", "fill.Count               times activated"),
    example: L("init idle", "-- start_btn", "step fill 5s", "  on valve", "-- fill.done OR fill.time > 4000 -> idle"),
    rules: ["Every step has these members; use them anywhere.", "A step name alone is not a value: write `fill.X`."],
    problems: ["E400", "E401", "W302"],
    see: ["after", "steps"],
  },
  {
    id: "io",
    group: "Tags",
    title: "io block",
    syntax: L("io", '  name  Local:1:I.Data.0  ["description"]', "  name  other_tag.member", "end"),
    example: L("io", '  start_btn  Local:1:I.Data.0  "Start"', "  motor      Local:1:O.Data.0", "  level      Local:3:I.Ch0Data", "end", "", "init idle", "-- start_btn AND level > 10", "step run", "  on motor", "-- NOT start_btn -> idle"),
    rules: ["Each line is an alias: a name for an I/O point or a tag member.", "An address ending in `.digits` is a bit: BOOL.", "Every I/O point is a tag, even unused."],
    problems: ["E413", "E414", "E415"],
    see: ["tag-lines", "controller"],
  },
  {
    id: "controller",
    group: "Tags",
    title: "controller block",
    syntax: L("controller", "  tag …", "  io … end", "  sfc tags step, transition", "end"),
    example: L("controller", '  tag stop_req : BOOL = 1 "Stop at end of cycle"', "  io", "    e_stop  Local:1:I.Data.15", "  end", "  sfc tags idle", "end", "", "init idle", "-- e_stop AND NOT stop_req", "step run", "-- stop_req -> idle"),
    rules: ["Tags shared by every program of the controller.", "`sfc tags`: steps and transitions whose own tags are shared too.", "Before the first routine; a tag lives at one place only."],
    problems: ["E223", "E418", "E419"],
    see: ["io", "uses"],
  },
  // Program
  {
    id: "header",
    group: "Program",
    title: "program, course, author",
    syntax: L('program name ["Title"]', 'course "…"', 'author "…"'),
    example: L('program tank "Tank filling"', 'course "Automation 101"', 'author "Your name"', "", "init idle", "-- start_btn -> idle"),
    rules: ["Before the first routine, once each.", "`course` and `author` are printed only."],
    problems: ["E210"],
    see: ["routines"],
  },
  {
    id: "routines",
    group: "Program",
    title: "Routines",
    syntax: L("sfc name      // a chart", "st name       // ST lines"),
    example: L("st main", "  call fill;", "  busy := fill_run.X;", "", "sfc fill", "init fill_idle", "-- start_btn", "step fill_run 5s", "-- fill_run.done -> fill_idle"),
    rules: ["The first routine is the main one: it runs every scan.", "The others run when called.", "Names are shared by the whole file."],
    problems: ["E222", "W600", "W603"],
    see: ["call", "sfr-sfp", "uses"],
  },
  {
    id: "call",
    group: "Program",
    title: "call",
    syntax: L("call name;", "JSR(name, 0);"),
    example: L("st main", "  call cycle;", "", "sfc cycle", "init wait", "-- start_btn", "step run", "-- stop_btn -> wait"),
    rules: ["A statement: in an action or an ST routine, not in a condition.", "Called from an SFC action, the routine runs while the step is active."],
    problems: ["E600", "E601", "E602", "W601", "W602"],
    see: ["routines", "uses"],
  },
  {
    id: "sfr-sfp",
    group: "Program",
    title: "SFR and SFP",
    syntax: L("SFR(routine, step);       // reset a chart to a step", "SFP(routine, Pause);      // pause it", "SFP(routine, Execute);    // resume it"),
    example: L("st main", "  call modes;", "  call cycle;", "", "sfc modes", "init manual", "  SFR(cycle, wait);", "  SFP(cycle, Pause);", "-- auto_sw", "step automatic", "  SFP(cycle, Execute);", "-- NOT auto_sw -> manual", "", "sfc cycle", "init wait", "-- start_btn", "step run", "-- stop_btn -> wait"),
    rules: ["The routine is an SFC routine.", "SFR's step: a step of that routine."],
    problems: ["E603", "E604"],
    see: ["call", "routines"],
  },
  {
    id: "uses",
    group: "Program",
    title: "uses",
    syntax: L("uses name, name (main)"),
    example: L("uses INIT, MainRoutine (main)", "", "sfc cycle", "init idle", "  JSR(INIT);", "-- start_btn", "step run", "-- stop_btn -> idle"),
    rules: ["Routines of the program that are not in this file.", "`call`, `JSR`, `SFR`, `SFP` may name them.", "`(main)`: that routine is the main one."],
    problems: ["E600", "E309"],
    see: ["routines", "outside"],
  },
  {
    id: "outside",
    group: "Program",
    title: "Elements of other routines",
    syntax: L("Step_017.DN   Tran_005   Action_002.Q", "tag Step_016 : SFC_STEP"),
    example: L("uses Sorting", "", "init idle", "-- start_btn AND Step_017.X", "step run", "  Step_016.Count := 0;", "-- stop_btn -> idle"),
    rules: ["A step, transition or action of a routine not in this file, by its tag name.", "Its number is never given to this file's elements.", "Declare it to create it: `tag Step_016 : SFC_STEP`."],
    problems: ["E405", "E401"],
    see: ["uses", "controller"],
  },
  {
    id: "files",
    group: "Program",
    title: "Export and import",
    syntax: L("File → Export L5X        File → Open an L5X…        File → Tidy an L5X…"),
    rules: ["Export writes the chart as an L5X project file, with its tags.", "Open an L5X reads one back into qSFC.", "Tidy only rearranges an L5X chart's layout.", "A step named `s3` keeps the number 3 (`tr3` for a transition)."],
    problems: ["E501", "E502"],
    see: ["routines"],
  },
  {
    id: "app",
    group: "Program",
    title: "In the app",
    syntax: L("F1 cheat sheet   Ctrl+F find   Ctrl+P print   F12 go to definition"),
    rules: ["Click a problem to go to its line; Ctrl+C copies it.", "Click a tag in the Tags panel to see where it is used.", "Insert → Snippet, or type at the start of a line for completion.", "Help → Examples opens ready charts.", "View → Colors: by role (default), color-blind safe, or classic; View → Structure column shows S and T beside each step and transition."],
    problems: [],
    see: ["lines"],
  },
];

export const REFERENCE_GROUPS = ["Basics", "Chart", "Branches", "Actions", "Tags", "Program"] as const;

export function findLesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

export function findEntry(id: string): RefEntry | undefined {
  return REFERENCE.find((e) => e.id === id);
}

/** Entries matching a search: in the title first, then the syntax, the rules and the codes. */
export function searchReference(query: string): RefEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...REFERENCE];
  const score = (e: RefEntry): number =>
    e.title.toLowerCase().includes(q)
      ? 3
      : e.syntax.toLowerCase().includes(q)
        ? 2
        : e.rules.some((r) => r.toLowerCase().includes(q)) || e.problems.some((c) => c.toLowerCase() === q)
          ? 1
          : 0;
  return REFERENCE.filter((e) => score(e) > 0).sort((a, b) => score(b) - score(a));
}
