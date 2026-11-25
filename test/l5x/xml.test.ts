import { describe, expect, it } from "vitest";
import { childElements, descendants, parseXml, textOf, XmlError } from "../../src/l5x/xml.js";

describe("xml reader", () => {
  it("parses declaration, comments, attributes, entities, CDATA, self-closing", () => {
    const root = parseXml(
      '﻿<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<!-- hi -->\r\n<a x="1 &amp; 2" y=\'&lt;&#65;&#x42;\'>\r\n<b/>\r\n<c><![CDATA[a<b]]>&gt;</c>\r\n</a>',
    );
    expect(root.name).toBe("a");
    expect(root.attrs).toEqual({ x: "1 & 2", y: "<AB" });
    expect(childElements(root).map((e) => e.name)).toEqual(["b", "c"]);
    expect(textOf(childElements(root, "c")[0]!)).toBe("a<b>");
    expect(descendants(root, "b")).toHaveLength(1);
  });

  it("normalizes CRLF in CDATA to LF", () => {
    expect(textOf(parseXml("<a><![CDATA[x\r\ny]]></a>"))).toBe("x\ny");
  });

  it("skips a DOCTYPE", () => {
    expect(parseXml("<!DOCTYPE a [<!ELEMENT a ANY>]><a/>").name).toBe("a");
  });

  it("rejects malformed input", () => {
    for (const bad of ["<a>", "<a></b>", "<a x=1/>", "<a>&nope;</a>", "", "<a/><b/>", "<a><![CDATA[x</a>", "<a x='1' x='2'/>"]) {
      expect(() => parseXml(bad), bad).toThrow(XmlError);
    }
  });
});
