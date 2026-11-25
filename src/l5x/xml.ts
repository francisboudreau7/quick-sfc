/**
 * Small dependency-free XML reader, good enough for Studio 5000 L5X exports.
 * Supports: XML declaration, processing instructions, comments, DOCTYPE (skipped),
 * elements, attributes (with entities), text, CDATA. CRLF/CR are normalized to LF
 * in text and attribute values, as the XML spec requires.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  /** Child nodes in document order: elements and text (text/CDATA, entities decoded). */
  children: Array<XmlElement | string>;
}

export class XmlError extends Error {
  constructor(message: string, public readonly offset: number) {
    super(message);
    this.name = "XmlError";
  }
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string, at: number): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (_m, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    const v = NAMED[body];
    if (v === undefined) throw new XmlError(`unknown entity &${body};`, at);
    return v;
  });
}

const NAME_START = /[A-Za-z_:À-￿]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-·À-￿]/;

/** Parses a document and returns its root element. Throws XmlError. */
export function parseXml(input: string): XmlElement {
  let text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  text = text.replace(/\r\n?/g, "\n");
  let i = 0;
  const n = text.length;
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;

  const fail = (msg: string, at = i): never => {
    throw new XmlError(`${msg} (offset ${at})`, at);
  };
  const skipWs = () => {
    while (i < n && /\s/.test(text[i]!)) i++;
  };
  const readName = (): string => {
    const start = i;
    if (i >= n || !NAME_START.test(text[i]!)) fail("name expected");
    i++;
    while (i < n && NAME_CHAR.test(text[i]!)) i++;
    return text.slice(start, i);
  };
  const addText = (s: string) => {
    if (s === "") return;
    const top = stack[stack.length - 1];
    if (!top) {
      if (s.trim() !== "") fail("text outside the root element");
      return;
    }
    const last = top.children[top.children.length - 1];
    if (typeof last === "string") top.children[top.children.length - 1] = last + s;
    else top.children.push(s);
  };

  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt < 0) {
      addText(decodeEntities(text.slice(i), i));
      i = n;
      break;
    }
    if (lt > i) addText(decodeEntities(text.slice(i, lt), i));
    i = lt;
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end < 0) fail("unterminated comment");
      i = end + 3;
    } else if (text.startsWith("<![CDATA[", i)) {
      const end = text.indexOf("]]>", i + 9);
      if (end < 0) fail("unterminated CDATA");
      if (!stack.length) fail("CDATA outside the root element");
      addText(text.slice(i + 9, end));
      i = end + 3;
    } else if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i + 2);
      if (end < 0) fail("unterminated processing instruction");
      i = end + 2;
    } else if (text.startsWith("<!", i)) {
      // DOCTYPE: skip, honouring an internal subset in [...]
      let depth = 0;
      i += 2;
      while (i < n && !(text[i] === ">" && depth === 0)) {
        if (text[i] === "[") depth++;
        else if (text[i] === "]") depth--;
        i++;
      }
      if (i >= n) fail("unterminated declaration");
      i++;
    } else if (text.startsWith("</", i)) {
      i += 2;
      const name = readName();
      skipWs();
      if (text[i] !== ">") fail("'>' expected in closing tag");
      i++;
      const top = stack.pop();
      if (!top || top.name !== name) {
        fail(`closing tag </${name}> does not match ${top ? `<${top.name}>` : "any open element"}`);
      }
    } else {
      i++;
      const name = readName();
      const attrs: Record<string, string> = {};
      for (;;) {
        skipWs();
        if (i >= n) fail("unterminated tag");
        const c = text[i]!;
        if (c === ">" || c === "/") break;
        const an = readName();
        skipWs();
        if (text[i] !== "=") fail(`'=' expected after attribute ${an}`);
        i++;
        skipWs();
        const q = text[i];
        if (q !== '"' && q !== "'") fail("quoted attribute value expected");
        const end = text.indexOf(q as string, i + 1);
        if (end < 0) fail("unterminated attribute value");
        if (an in attrs) fail(`duplicate attribute ${an}`);
        attrs[an] = decodeEntities(text.slice(i + 1, end), i).replace(/[\t\n]/g, " ");
        i = end + 1;
      }
      const el: XmlElement = { name, attrs, children: [] };
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(el);
      else if (root) fail("more than one root element");
      else root = el;
      if (text[i] === "/") {
        i++;
        if (text[i] !== ">") fail("'>' expected after '/'");
        i++;
      } else {
        i++;
        stack.push(el);
      }
    }
  }
  if (stack.length) fail(`unclosed element <${stack[stack.length - 1]!.name}>`);
  if (!root) fail("no root element");
  return root!;
}

/** Child elements, optionally filtered by name. */
export function childElements(el: XmlElement, name?: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => typeof c !== "string" && (name === undefined || c.name === name));
}

/** First child element with this name. */
export function firstChild(el: XmlElement, name: string): XmlElement | undefined {
  return childElements(el, name)[0];
}

/** All descendant elements (depth first, document order), optionally by name. */
export function descendants(el: XmlElement, name?: string): XmlElement[] {
  const out: XmlElement[] = [];
  const visit = (e: XmlElement) => {
    for (const c of e.children) {
      if (typeof c === "string") continue;
      if (name === undefined || c.name === name) out.push(c);
      visit(c);
    }
  };
  visit(el);
  return out;
}

/** Concatenated text of the element and its descendants. */
export function textOf(el: XmlElement): string {
  return el.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
}

/**
 * Text of an element written on its own lines, as in L5X (`<Line>` / `<Description>` /
 * CDATA): the single line break after the opening tag and before the closing tag is layout,
 * not content.
 */
export function blockText(el: XmlElement): string {
  let t = textOf(el);
  if (t.startsWith("\n")) t = t.slice(1);
  if (t.endsWith("\n")) t = t.slice(0, -1);
  return t;
}
