import { describe, expect, it } from "vitest";
import { CONDITION_WRAP, wrapCondition } from "../../src/l5x/wrap.js";

describe("wrapCondition (long conditions in Studio)", () => {
  const station2 = "(gros or moyen) and Step_011.DN and (auto or (man and start_edge))";

  it("keeps a short condition on one line", () => {
    expect(wrapCondition("start_btn AND NOT fault")).toEqual(["start_btn AND NOT fault"]);
  });

  it("breaks before and / or, each line at most the limit where it can", () => {
    const lines = wrapCondition(station2);
    expect(lines).toEqual(["(gros or moyen) and Step_011.DN", "and (auto or (man and start_edge))"]);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(CONDITION_WRAP);
  });

  it("joining the lines with a space gives the text back (the import does that)", () => {
    for (const t of [
      station2,
      "a1 AND b1 AND c1 AND d1 AND e1 AND f1 AND g1 AND h1 AND i1 AND j1 AND k1",
      "x & y & zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz & w",
      "count >= 3 OR level_high_alarm_from_sensor_two XOR reset_request",
    ]) {
      expect(wrapCondition(t).join(" ")).toBe(t);
    }
  });

  it("never breaks inside a string or a comment, nor before an operator after two spaces", () => {
    const s = "msg = 'a and b and c and d and e and f and g' and ok";
    expect(wrapCondition(s)).toEqual(["msg = 'a and b and c and d and e and f and g'", "and ok"]);
    expect(wrapCondition("short and x // a comment and more and more and more")).toEqual(["short", "and x // a comment and more and more and more"]);
    expect(wrapCondition("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  and b")).toEqual(["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  and b"]);
  });

  it("an identifier that starts with and / or is not an operator", () => {
    expect(wrapCondition("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa := order_ready_now_ok")).toEqual(["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa := order_ready_now_ok"]);
  });
});

describe("long conditions: export lines, column width, row height", () => {
  const xOf = (xml: string, op: string) => Number(new RegExp(`<\\w+ ID="\\d+" X="(\\d+)" Y="\\d+" Operand="${op}"`).exec(xml)![1]);
  const yOf = (xml: string, op: string) => Number(new RegExp(`<\\w+ ID="\\d+" X="\\d+" Y="(\\d+)" Operand="${op}"`).exec(xml)![1]);
  const src = (cond: string) =>
    `init a\nselect\n  -- ${cond}\n  step b\n  -- x -> a\n|\n  -- y\n  step c\n  -- z -> a\nend\n`;

  it("writes a long condition on several Studio lines", async () => {
    const { exportL5X } = await import("../../src/compile.js");
    const out = exportL5X(src("(gros or moyen) and big_part_present and (auto or (man and start_edge))"), { fileName: "t.qsfc" }).text!;
    expect(out).toMatch(/<!\[CDATA\[\(gros or moyen\) and big_part_present\]\]>\s*<\/Line>\s*<Line Number="1">\s*<!\[CDATA\[and \(auto or \(man and start_edge\)\)\]\]>/);
  });

  it("widens the column for a line that can't be broken, and makes the row taller for each extra line", async () => {
    const { exportL5X } = await import("../../src/compile.js");
    const short = exportL5X(src("p"), { fileName: "t.qsfc" }).text!;
    const unbreakable = exportL5X(src("part_count_station2 + reject_count_station2 > 1000"), { fileName: "t.qsfc" }).text!;
    const twoLines = exportL5X(src("(gros or moyen) and big_part_present and (auto or (man and start_edge))"), { fileName: "t.qsfc" }).text!;
    // the second leg (step c = Step_002) moves right only when the first leg's condition is too wide
    expect(xOf(unbreakable, "Step_002") - xOf(unbreakable, "Step_001")).toBeGreaterThan(xOf(short, "Step_002") - xOf(short, "Step_001"));
    expect(xOf(twoLines, "Step_002") - xOf(twoLines, "Step_001")).toBe(xOf(short, "Step_002") - xOf(short, "Step_001"));
    // the steps under the two-line condition come lower by one line
    expect(yOf(twoLines, "Step_001") - yOf(short, "Step_001")).toBe(20);
  });
});
