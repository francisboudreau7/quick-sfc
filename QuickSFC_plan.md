# Quick SFC Enhancement Plan - Studio 5000 Export Focus

## Overview

Quick Grafcet (better named **Quick SFC**) is a **drafting tool** for rapidly describing Sequential Function Chart structure that will be imported into Allen-Bradley Studio 5000 or similar PLC editors for production refinement.

**Primary Use Case:**
1. Engineer writes SFC structure draft in Quick SFC (.qg file)
2. Parser generates L5X format suitable for Studio 5000 import
3. Engineer completes the implementation in Studio 5000 (adds full ST code, I/O mapping, HMI integration, safety logic, etc.)

**Design Philosophy:**
- **Fast drafting** over execution precision
- **Structural clarity** over semantic correctness
- **Export compatibility** over runtime validation
- **Skeleton generation** over complete implementation

## Current Quick Grafcet Capabilities

**Supported:**
- Sequential step-transition flow
- Initial step (SI) and regular steps (S)
- Transitions with boolean conditions
- Timer presets on steps (milliseconds)
- Forward and backward jumps via line references
- Simple actions (Structured Text strings)
- Bidirectional step↔transition relationships

**Not Supported (from IEC 60848):**
- Parallel divergence/convergence (AND splits/joins)
- Selection divergence/convergence (OR splits/joins)
- Action qualifiers (N, S, R, D, L, P, SD, DS, SL)
- Named steps and transitions
- Macro-steps (encapsulation)
- Forcing orders
- Comments and documentation
- Event-based transitions
- Stored actions

---

## Re-Prioritized Features for Drafting/Export Use Case

### **TIER 1: Essential for Studio 5000 Export** (Implement First)

These features are critical for generating SFC structures that Studio 5000 can import and that engineers expect to see.

#### 1.1 Parallel Divergence/Convergence (AND)
**Priority: CRITICAL**

**Why (for export to Studio 5000):**
- **Studio 5000 SFC supports parallel branches** - engineers expect to draft these structures
- Cannot express simultaneous operations without parallel splits/joins
- Extremely common in industrial automation (e.g., "open valve A AND valve B simultaneously")
- Missing this makes Quick SFC unusable for ~70% of real SFC diagrams

**Studio 5000 L5X Mapping:**
- Parallel divergence → `<SFCBranch>` with `<BranchType>Diverge</BranchType>` and `<BranchFlow>AND</BranchFlow>`
- Parallel convergence → `<SFCBranch>` with `<BranchType>Converge</BranchType>` and `<BranchFlow>AND</BranchFlow>`
- Each parallel path → `<SFCLeg>` within the branch
- Already have parser reference in `/l5x/branch.py` and `/l5x/sfc_parser.py`

**Proposed Syntax:**
```
S(main_action)
T(start_parallel)
  SPLIT
    S(parallel_task_1)
    T(task1_done)
  AND
    S(parallel_task_2)
    T(task2_done)
  JOIN
S(continue_after_both)
```

**Recommended Compact Syntax (Quick to type):**
```
S(main_action)
T(start) >> [2,3]    # Diverge to lines 2 and 3
S(parallel_1)        # Line 2
T(done1)
S(parallel_2)        # Line 3
T(done2)
T(both_done) << [4,5]  # Converge from transitions at lines 4 and 5
S(continue)
```

**Rationale:** Matches Quick SFC philosophy - minimal keystrokes, clear structure, easy to parse for L5X generation

**Export Impact:**
- Can generate L5X with proper `<SFCBranch>` and `<SFCLeg>` structures
- Studio 5000 will render graphically as parallel paths
- Engineer can then add detailed logic to each branch

---

#### 1.2 Comments and Documentation
**Priority: HIGH**

**Why (for drafting):**
- Engineers need to annotate **intent** in the draft before refining in Studio 5000
- Essential for team communication ("TODO: add safety check here")
- Standard practice in all code/config drafting tools
- Currently zero inline documentation capability

**Proposed Syntax:**
```
# Main sequence start
SI(Init;)  # Initialize counters and flags
T(start_button)  # TODO: add E-stop check in Studio 5000
S(Running;)
```

**Export to L5X:**
- Comments could be embedded in `<Description>` tags
- Or preserved in a separate documentation file
- Engineer sees notes when importing to Studio 5000

**Impact:**
- Faster drafting (engineers can leave notes for themselves)
- Better collaboration (team members understand intent)
- Reduces Studio 5000 editing time (notes guide completion)

---

#### 1.3 Selection Divergence (OR)
**Priority: MEDIUM-HIGH**

**Why (for Studio 5000 export):**
- **Studio 5000 supports OR branches** for mode selection
- Common pattern: "if auto mode → sequence A, if manual mode → sequence B"
- Currently forces awkward sequential transition modeling
- Needed for clean state machine exports

**Studio 5000 L5X Mapping:**
- OR divergence → `<SFCBranch>` with `<BranchFlow>OR</BranchFlow>`
- Already supported in L5X schema

**Compact Syntax:**
```
S(mode_select)
T(auto) |> S(auto_sequence)    # OR branch option 1
T(manual) |> S(manual_sequence) # OR branch option 2
T(exit) <|                      # OR convergence marker
S(continue)
```

**Export Impact:**
- Generates proper OR branch structure in L5X
- Studio 5000 renders as selection diamond
- Engineer completes transition logic in Studio 5000

---

### **TIER 2: Helpful for Drafting Quality** (Implement Second)

#### 2.1 Step and Transition Names
**Priority: MEDIUM**

**Why (for drafting):**
- **Line numbers are fragile** - inserting a step breaks all downstream references
- Named steps export cleaner to L5X (`<Operand>` tags)
- Self-documenting: `T(timeout, EmergencyStop)` vs `T(timeout, 47)`
- Studio 5000 displays step names in SFC editor

**Proposed Syntax (optional names):**
```
SI(Init, T:=0;)         # Optional name "Init"
T(start, Running)       # Jump to named step "Running"
S(Running, Motor:=ON;)
```

**Export Impact:**
- Step names → L5X `<Name>` attribute
- Improves Studio 5000 readability
- Engineer can rename in Studio 5000 if needed

---

#### 2.2 Action Qualifiers (Simplified)
**Priority: LOW-MEDIUM**

**Why (for drafting, NOT execution):**
- Quick SFC is a **drafting tool** - actions will be completed in Studio 5000
- Most useful qualifiers for draft stage:
  - **P (Pulse):** "Increment counter on step entry"
  - **S (Set):** "Latch alarm on step entry"
  - **R (Reset):** "Clear flag on step entry"
- N (default) rarely needs explicit notation
- Time-based qualifiers (L, D, SD, etc.) are overkill for drafting

**Minimal Syntax:**
```
S(P:counter++; S:alarm_latched; R:error_flag;, 2000)
```

**Export Impact:**
- Qualifier hints export to L5X action descriptions
- Engineer implements full logic in Studio 5000
- **Optional feature** - not critical for drafting

---

### **TIER 3: Nice-to-Have / Future** (Low Priority for Drafting Tool)

#### 3.1 Macro-Steps (Encapsulation)
**Priority: LOW**

**Why (for drafting):**
- **Studio 5000 will handle complexity** - macro-steps add overhead to drafting
- Can express hierarchy with nested .qg files if needed
- Most engineers draft flat structures, add hierarchy in Studio 5000

**Impact:**
- Not critical for rapid SFC skeleton generation
- Consider only if user workflows demand it

---

#### 3.2 Forcing Orders
**Priority: VERY LOW**

**Why (for drafting):**
- **Too advanced for skeleton drafting** - engineer will implement in Studio 5000
- Safety logic should be validated in full PLC environment, not draft tool

**Impact:**
- Out of scope for Quick SFC as drafting tool

---

#### 3.3 Event-Based Transitions (Edge Triggers)
**Priority: VERY LOW**

**Why (for drafting):**
- **Execution details handled in Studio 5000** - edge detection is runtime concern
- Draft stage focuses on structure, not transition nuances

**Impact:**
- Not needed for SFC skeleton generation

---

#### 3.4 Variable Scoping
**Priority: VERY LOW**

**Why (for drafting):**
- **Studio 5000 manages tag databases** - no need to declare in draft
- Quick SFC is structural, not data-definition tool

**Impact:**
- Out of scope

---

## Recommended Implementation Order (for Studio 5000 Export)

### Phase 1: Parallel AND Branches (CRITICAL) - 2-3 weeks
**Goal:** Enable drafting parallel sequences that export to L5X
1. Design compact syntax: `T() >> [line1, line2]` for diverge, `T() << [line1, line2]` for converge
2. Extend tokenizer for `>>`, `<<`, `[`, `]`, `,` operators
3. Add `QGBranch` and `QGLeg` classes to qg_sfc.py (mirror existing `/l5x/branch.py` structure)
4. Update parser to build branch/leg objects when `>>` or `<<` detected
5. **L5X Export:** Generate `<SFCBranch>` elements with proper `<BranchFlow>` and legs
6. Test with simple parallel examples

### Phase 2: Comments (HIGH) - 1 week
**Goal:** Let engineers annotate drafts with TODOs and intent
1. Tokenizer recognizes `#` for line comments
2. Comments ignored during parsing (or preserved in metadata)
3. Optional: Export comments to L5X `<Description>` tags
4. Test with annotated .qg files

### Phase 3: Selection OR Branches (MEDIUM-HIGH) - 2 weeks
**Goal:** Draft mode selection logic
1. Design compact syntax: `T() |>` for OR branch options, `<|` for merge
2. Extend tokenizer for `|>`, `<|` operators
3. Update parser to build OR branches (similar to AND but different L5X flow type)
4. **L5X Export:** Generate OR-flow `<SFCBranch>` elements
5. Test with mode selection examples

### Phase 4: Optional Step Names (MEDIUM) - 1 week
**Goal:** Replace fragile line number references with names
1. Add optional `name` parameter to S() and SI(): `S(name, action, preset)`
2. Parser builds name→step lookup table
3. T() can reference by name instead of line number: `T(condition, target_name)`
4. **L5X Export:** Names become step `<Operand>` values
5. Maintain backward compatibility with line numbers

### Phase 5: L5X Export Refinement (ONGOING)
**Goal:** Ensure generated L5X imports cleanly to Studio 5000
1. Test import to actual Studio 5000 installation
2. Fix any schema incompatibilities
3. Optimize tag naming and structure defaults
4. Add export options (e.g., target controller type)

---

## Syntax Design Principles (Drafting Tool Focus)

1. **Speed:** Minimal keystrokes to express common SFC patterns
2. **Backward Compatibility:** Existing .qg files must continue to work
3. **Readability:** Engineer should understand structure at a glance
4. **L5X Export Quality:** Generated L5X must import cleanly to Studio 5000
5. **Parsability:** Unambiguous grammar for reliable tooling
6. **Structural Focus:** Express flow/branches, defer detailed logic to Studio 5000

---

## Open Questions for User

Before proceeding with implementation, please confirm:

1. **Studio 5000 Integration:**
   - Do you already have L5X export working? (Yes - `/l5x/` folder exists)
   - Have you tested importing generated L5X into Studio 5000?
   - Any specific controller targets (ControlLogix, CompactLogix)?

2. **Parallel Syntax:**
   - Compact operators (`>>` / `<<`) acceptable?
   - Or prefer verbose keywords (`SPLIT` / `JOIN`)?

3. **Current Workflow:**
   - What's most painful in current Quick Grafcet?
   - What pattern do you draft most often (parallel? selection? loops)?
   - Example .qg file you wish worked but doesn't?

4. **Immediate Need:**
   - Which Phase 1-4 feature do you need ASAP?
   - Working on specific project now?

---

## References

- [IEC 60848:2013 Standard](https://cdn.standards.iteh.ai/samples/19077/a0175aea9c504229beb0d6b01861b5d0/IEC-60848-2013.pdf)
- [Unambiguous Interpretation of IEC 60848 GRAFCET](https://arxiv.org/html/2307.11556v2)
- [IEC 60848 - GRAFCET Specification Language](https://standards.globalspec.com/std/271015/iec-60848)
- [Grafcet avec séquences simultanées](https://www.maxicours.com/se/cours/grafcet-avec-sequences-simultanees-1/)

---

## Summary Table: Priority Matrix (for Studio 5000 Drafting Tool)

| Feature | Priority | Complexity | Export Value | Implement? |
|---------|----------|-----------|--------------|-----------|
| **Parallel AND** | **CRITICAL** | Medium | Essential | ✓ Phase 1 |
| **Comments** | **High** | Low | High | ✓ Phase 2 |
| **Selection OR** | **Medium-High** | Medium | High | ✓ Phase 3 |
| **Named Steps** | **Medium** | Low | Medium | ✓ Phase 4 |
| Action Qualifiers | Low-Med | Medium | Low | Optional |
| Macro-Steps | Low | High | Low | Future |
| Forcing Orders | Very Low | High | None | Out of scope |
| Event Triggers | Very Low | Low | None | Out of scope |
| Variable Scoping | Very Low | Medium | None | Out of scope |

**Key Insight:** Quick SFC is a **structural drafting tool**, not an execution engine. Prioritize features that:
1. Express SFC topology (parallel/selection branches)
2. Document engineer intent (comments, names)
3. Export cleanly to L5X for Studio 5000

Defer execution semantics (action qualifiers, forcing, events) to the full PLC environment.
