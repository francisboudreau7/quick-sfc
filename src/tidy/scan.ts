/**
 * Offset-keeping XML scan for Tidy: elements with the exact text range of every attribute value,
 * so Tidy can rewrite a few values and keep every other byte (BOM, CRLF, Studio's line wraps
 * inside start tags, CDATA). Only for a document that parseXml (src/l5x/xml.ts) accepted.
 */

export interface ScanAttr {
  name: string;
  /** Raw value (entities not decoded; L5X numbers and IDs have none). */
  value: string;
  /** Offsets of the value, inside the quotes. */
  start: number;
  end: number;
}

export interface ScanElement {
  name: string;
  attrs: ScanAttr[];
  children: ScanElement[];
  /** Text and CDATA content directly inside the element (CDATA as is, other text decoded). */
  text: string;
  /** Offset of `<` of the start tag, and of the character after `>` of the start tag. */
  start: number;
  tagEnd: number;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);/g, (m, b: string) => {
    if (b.startsWith("#x")) return String.fromCodePoint(parseInt(b.slice(2), 16));
    if (b.startsWith("#")) return String.fromCodePoint(parseInt(b.slice(1), 10));
    return NAMED[b] ?? m;
  });
}

/** Returns the root element. Throws on malformed input (callers check with parseXml first). */
export function scanXml(text: string): ScanElement {
  const root: ScanElement = { name: "#document", attrs: [], children: [], text: "", start: 0, tagEnd: 0 };
  const stack: ScanElement[] = [root];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf("<", i);
    const top = stack[stack.length - 1]!;
    if (lt < 0) break;
    if (lt > i) top.text += decode(text.slice(i, lt));
    i = lt;
    if (text.startsWith("<!--", i)) {
      i = text.indexOf("-->", i + 4) + 3;
    } else if (text.startsWith("<![CDATA[", i)) {
      const end = text.indexOf("]]>", i + 9);
      top.text += text.slice(i + 9, end);
      i = end + 3;
    } else if (text.startsWith("<?", i)) {
      i = text.indexOf("?>", i + 2) + 2;
    } else if (text.startsWith("<!", i)) {
      let depth = 0;
      i += 2;
      while (i < n && !(text[i] === ">" && depth === 0)) {
        if (text[i] === "[") depth++;
        else if (text[i] === "]") depth--;
        i++;
      }
      i++;
    } else if (text.startsWith("</", i)) {
      i = text.indexOf(">", i) + 1;
      if (stack.length > 1) stack.pop();
    } else {
      const start = i;
      i++;
      const m = /^[^\s/>]+/.exec(text.slice(i, i + 200));
      if (!m) throw new Error(`XML scan: name expected at ${i}`);
      const el: ScanElement = { name: m[0], attrs: [], children: [], text: "", start, tagEnd: 0 };
      i += m[0].length;
      for (;;) {
        while (i < n && /\s/.test(text[i]!)) i++;
        if (i >= n) throw new Error("XML scan: unterminated tag");
        const c = text[i]!;
        if (c === ">" || c === "/") break;
        const eq = text.indexOf("=", i);
        const name = text.slice(i, eq).trim();
        i = eq + 1;
        while (/\s/.test(text[i]!)) i++;
        const q = text[i]!;
        const end = text.indexOf(q, i + 1);
        el.attrs.push({ name, value: text.slice(i + 1, end), start: i + 1, end });
        i = end + 1;
      }
      top.children.push(el);
      if (text[i] === "/") {
        i += 2;
        el.tagEnd = i;
      } else {
        i++;
        el.tagEnd = i;
        stack.push(el);
      }
    }
  }
  return root;
}

export function attr(el: ScanElement, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

export function attrRef(el: ScanElement, name: string): ScanAttr | undefined {
  return el.attrs.find((a) => a.name === name);
}

/** Descendants in document order, optionally by name. */
export function scanDescendants(el: ScanElement, name?: string): ScanElement[] {
  const out: ScanElement[] = [];
  const visit = (e: ScanElement): void => {
    for (const c of e.children) {
      if (name === undefined || c.name === name) out.push(c);
      visit(c);
    }
  };
  visit(el);
  return out;
}
