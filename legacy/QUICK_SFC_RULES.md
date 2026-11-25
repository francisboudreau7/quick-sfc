# Quick SFC Language

Quick SFC is a simple text format for drafting Sequential Function Charts. It's designed to be fast to write and easy to export to Allen-Bradley Studio 5000.

The idea is simple: sketch out your SFC structure quickly using named steps and transitions, then do the detailed logic work in the PLC editor where you have proper tools.

## Basic Syntax

Everything is named with an `@` symbol:

```
SI@init(reset)              // Initial step
S@running(motor_on)         // Regular step
T@timeout(Timer.DN)         // Transition
T@loop() -> @init           // Transition that jumps somewhere
END                         // Marks the end of file
```
the first argument of both steps and transition is respectively an action and condition. It can be structured text or just a string to leave a comment. if there is no semicolon, it will treat it as a comment, if there is at least one semicolon, it will be treated as structured text.

Steps can also have optional presets in milliseconds:

```
S@delay(wait, 5000)         // Wait 5 seconds
```

Comments start with `#`:
```
SI@init(reset)  # This resets everything
```
The comments will not be exported into the L5X.

The parameters can also be left empty.

## Simple Example

Here's a basic cycle:

```
SI@idle(motor_off)
T@start(start_button)
S@running(motor_on, 2000)
T@done(running.DN) -> @idle
END
```

Visual representation:

```
    ┌─────────────┐
    │  SI@idle    │ ◄─────┐
    │ (motor_off) │       │
    └──────┬──────┘       │
           │              │
        ───┼─── T@start   │
           │              │
    ┌──────▼──────┐       │
    │ S@running   │       │
    │ (motor_on)  │       │
    └──────┬──────┘       │
           │              │
        ───┼─── T@done    │
           └──────────────┘

```

## Branches

### Selection Branches (pick one path)

Use `/\` to split and `\/` to merge back:

SI@init()
T@ready()
S@check()
/\
T@good()
│
T@bad(defect)
S@reject()
T@rejected()
\/ S@next()
T@moved() -> @check
END

    ┌─────────────┐
    │   SI@init   │       
    └──────┬──────┘                                     
           │                                          
        ───┼─── T@ready                                
           │                                            
      ┌────┴──────┐                                     
      │  S@check  │◄────────────────────────────────────┐                                     │
      └─────┬─────┘                                     │
            │                                           │
            ├─────────────────────────┐                 │
            │                         │                 │
            │                      ───┼─── T@bad        │
            │                         │                 │
            │                   ┌─────┴─────┐           │
         ───┼─── T@good         │ S@reject  │           │
            │                   └─────┬─────┘           │
            │                         │                 │
            │                      ───┼─── T@rejected   │
            │                         │                 │
            ├─────────────────────────┘                 │
            │                                           │
      ┌─────┴─────┐                                     │ 
      │  S@next   │                                     │
      └─────┬─────┘                                     |
         ───┼─── T@next_is_ready                        │
```         └───────────────────────────────────────────┘

```

### Parallel Branches (Simultaneous Execution)

Use `//\\` to split and `\\//` to merge:

SI@init()
T@ready()
S@move_to_next()
T@start()
//\\
    S@fill_left(pump1_on)
    |
    S@fill_right(pump2_on)
\\//
T@both_filled() -> @move_to_next()
END
```

Visual representation:
             ┌─────────────┐
             │  SI@init    │    
             └──────┬──────┘       
                    │              
                 ───┼─── T@ready  
                    │              
           ┌────────▼──────────┐             
           │ S@move_to_next()  │◄─────────────────────┐       
           └────────┬──────────┘                      │
                    │                                 │
                 ───┼─── T@done                       │
           ═════════╪══════════                       │
           │                   │                      │
    ┌──────▼──────┐     ┌──────▼──────┐               │
    │S@fill_left  │     │S@fill_right │               │
    │ (pump1_on)  │     │ (pump2_on)  │               │
    └──────┬──────┘     └──────┬──────┘               │
           │                   │                      │
           │                   │                      │
           ══════════╤═══════════                     │
                     │                                │
                     │                                │
                ─────┼─────  T@both_filled()          │
                     │                                │
                     └────────────────────────────────┘

```


## Full Example

```
# Simple production line
SI@init(reset_all)
T@start(start_btn AND safety_ok)

# Load both sides at once
S@ready()
T@begin_load() //\\
    S@load_A(conveyor_A_start)
    |
    S@load_B(conveyor_B_start)
\\// T@both_loaded(load_sensor_A AND load_sensor_B)

# Pick operating mode
S@select_mode()
/\
    T@auto(auto_mode) -> S@run_auto(program_1)
    |
    T@manual(manual_mode) -> S@run_manual(wait_for_commands)
\/ S@done()

T@cycle_complete() -> @init
END
```

Visual representation:

```
    ┌──────────────┐
    │   SI@init    │ ◄─────────────────────┐
    │ (reset_all)  │                       │
    └──────┬───────┘                       │
           │                               │
      ─────┴─────                          │
       T@start                             │
   (start_btn AND                          │
      safety_ok)                           │
      ─────┬─────                          │
           │                               │
    ┌──────▼───────┐                       │
    │   S@ready    │                       │
    └──────┬───────┘                       │
           │                               │
      ─────┴─────                          │
     T@begin_load                          │
     ══════╪══════  ◄── AND parallel       │
           ╞════════════════╗              │
           ║                ║              │
    ┌──────▼──────┐  ┌──────▼──────┐       │
    │  S@load_A   │  │  S@load_B   │       │
    └──────┬──────┘  └──────┬──────┘       │
           │                │              │            
           ╞════════════════╝              │     
           │                               │
      ─────┴─────                          │
     T@both_loaded                         │
      ─────┬─────                          │
           │                               │
    ┌──────▼───────┐                       │
    │S@select_mode │                       │
    └─────┬────────┘                       │
          │                                │            
          ├──────────────────┐             │
          │                  │             │
     ─────┴─────        ─────┴─────        │
       T@auto            T@manual          │
     ─────┬─────        ─────┬─────        │
          │                  │             │
    ┌─────▼──────┐    ┌──────▼───────┐     │
    │S@run_auto  │    │S@run_manual  │     │
    └─────┬──────┘    └──────┬───────┘     │
          │                  │             │
          ├──────────────────┘             │
          │                                │
          │                                │
    ┌─────▼──────┐                         │
    │   S@done   │                         │
    └─────┬──────┘                         │
          │                                │
     ─────┴─────                           │
   T@cycle_complete                        │
     ─────┴────────────────────────────────┘
```

## Reference

| What          | Syntax         | Notes                   |
| ------------- | -------------- | ----------------------- | -------------------- |
| Initial step  | `SI@name(...)` | Required, only one      |
| Step          | `S@name(...)`  | S@name(action,preset)   |
| Transition    | `T@name(...)`  | T@name(condition)       |
| Jump          | `-> @target`   | Go to specific step     |
| OR split      | `/\`           | Choose one path         |
| OR merge      | `\/`           | Paths come together     |
| AND split     | `//\\`         | All paths run           |
| AND merge     | `\\//`         | Wait for all paths      |
| Leg separator | `| `           | Divides branch paths    |
| Comment       | `#`            | Rest of line ignored    |
| End marker    | `END`          | Required at end of file |

## Rules to Remember

- Every step and transition needs a unique `@name`
- Names can use letters, numbers, underscores but need to start with a letter
- You must have exactly one `SI` initial step, which need to be the first line
- File must end with `END`
- Actions and conditions use Structured Text syntax

File extension is `.qsfc`
