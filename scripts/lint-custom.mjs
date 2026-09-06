#!/usr/bin/env node
// Runs project-specific static guards over the given files.
// Usage: node scripts/lint-custom.mjs <file...>
// Exits 1 if any finding, 0 otherwise.
//
// Rules are small regex/scanner functions — no parsing library. Each rule
// receives a context object { file, source, htmlText, scriptText, scriptBlocks,
// helpers... } and returns [{ index, message }] (absolute offsets into source);
// scriptBlocks is [{ text, base }] per non-empty inline <script>, so rules map
// block-relative match offsets to absolute source offsets via block.base; the
// runner converts offsets to 1-based line/col and aggregates output.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lineColAt(source, index) {
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      lastNl = i;
    }
  }
  return { line, col: index - lastNl };
}

function findAll(source, re) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(source)) !== null) {
    out.push({ index: m.index, match: m });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Backtick template literals (with offsets). Nested backticks inside
// ${...} are not handled — none occur in this codebase.
function templateLiterals(source) {
  const out = [];
  let i = 0;
  while (i < source.length) {
    const start = source.indexOf("`", i);
    if (start === -1) break;
    let j = start + 1;
    while (j < source.length && source[j] !== "`") {
      if (source[j] === "\\") j++;
      j++;
    }
    out.push({ start, text: source.slice(start, j + 1) });
    i = j + 1;
  }
  return out;
}

// Split a file into HTML (script inners blanked, offsets preserved) and the
// inline-script blocks. A file with no <script> tags (plain .js) is treated as
// one big script block. Supports multiple inline <script> blocks: each
// non-empty one is returned separately as { text, base } so rules can map
// block-relative match offsets to absolute source offsets; scriptText is the
// blocks concatenated with "\n" (existence checks only — never for offset
// mapping).
function splitSources(source) {
  const tags = findAll(source, /<script\b[^>]*>([\s\S]*?)<\/script>/gi);
  if (tags.length === 0) {
    // No <script> tags. Plain JS files become one big script block; markup
    // (e.g. an Alpine snippet passed to runSource) is treated as pure HTML.
    if (/<[a-zA-Z]/.test(source)) {
      return { htmlText: source, scriptText: "", scriptBlocks: [] };
    }
    return { htmlText: "", scriptText: source, scriptBlocks: [{ text: source, base: 0 }] };
  }
  let htmlText = source;
  const scriptBlocks = [];
  for (const { index, match } of tags) {
    const inner = match[1];
    const innerStart = index + match[0].indexOf(">") + 1;
    if (inner.trim()) scriptBlocks.push({ text: inner, base: innerStart });
    htmlText =
      htmlText.slice(0, innerStart) +
      " ".repeat(inner.length) +
      htmlText.slice(innerStart + inner.length);
  }
  const scriptText = scriptBlocks.map((b) => b.text).join("\n");
  return { htmlText, scriptText, scriptBlocks };
}

// Comment spans: // line comments, /* */ blocks, <!-- --> HTML comments.
// String-aware so URLs ("https://...") and template literals are not
// mistaken for comments.
function commentSpans(source) {
  const spans = [];
  let i = 0;
  let inString = false;
  let quote = "";
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (inString) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) inString = false;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      const start = i;
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      spans.push([start, i]);
      continue;
    }
    if (ch === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i = Math.min(i + 2, source.length);
      spans.push([start, i]);
      continue;
    }
    if (ch === "<" && next === "!") {
      const start = i;
      i += 2;
      while (i < source.length && !(source[i] === "-" && source[i + 1] === "-" && source[i + 2] === ">")) i++;
      i = Math.min(i + 3, source.length);
      spans.push([start, i]);
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      quote = ch;
    }
    i++;
  }
  return spans;
}

function inSpans(index, spans) {
  for (const [a, b] of spans) {
    if (index >= a && index < b) return true;
  }
  return false;
}

// Tokenize identifiers in an Alpine expression, skipping string literals and
// property accesses after '.' (e.g. foo.bar -> only foo is a candidate).
function exprIdentifiers(expr) {
  const ids = [];
  let i = 0;
  let prevNonSpace = "";
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === "\\") i++;
        i++;
      }
      i++;
      prevNonSpace = quote;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[\w$]/.test(expr[j])) j++;
      const word = expr.slice(i, j);
      if (prevNonSpace !== ".") ids.push({ word, index: i });
      prevNonSpace = expr[j - 1];
      i = j;
      continue;
    }
    if (!/\s/.test(ch)) prevNonSpace = ch;
    i++;
  }
  return ids;
}

// Keys declared in an x-data object literal like { count: 1, foo }.
function xDataKeys(expr) {
  const keys = new Set();
  const open = expr.indexOf("{");
  if (open === -1) return keys;
  const close = expr.lastIndexOf("}");
  const inner = expr.slice(open + 1, close === -1 ? expr.length : close);
  for (const m of findAll(inner, /([A-Za-z_$][\w$]*)\s*:/g)) keys.add(m.match[1]);
  for (const m of findAll(inner, /(?:^|,|\{)([A-Za-z_$][\w$]*)\s*(?=,|\})/g)) keys.add(m.match[1]);
  return keys;
}

// Index of the matching close brace for the '{' at openIdx (string-aware).
function balancedBraceEnd(text, openIdx) {
    let depth = 0;
    let inStr = null;
    for (let i = openIdx; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (ch === "\\") { i++; continue; }
            if (ch === inStr) inStr = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
        if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (depth === 0) return i; }
    }
    return -1;
}

// Top-level property/method/getter names of a balanced object literal
// (must begin with '{'). Handles `key: v`, shorthand `key`, `key() {}`,
// `get key() {}`, `set key() {}`, `async key() {}`.
function objectKeys(literal) {
    const keys = new Set();
    let depth = 0;
    let inStr = null;
    let i = 0;
    while (i < literal.length) {
        const ch = literal[i];
        if (inStr) {
            if (ch === "\\") { i += 2; continue; }
            if (ch === inStr) inStr = null;
            i++;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; i++; continue; }
        if (ch === "{") { depth++; i++; continue; }
        if (ch === "}") { depth--; i++; continue; }
        if (depth === 1) {
            const m = /^\s*(?:(?:get|set|async)\s+)?([A-Za-z_$][\w$]*)\s*([:(,}])/.exec(literal.slice(i));
            if (m) {
                keys.add(m[1]);
                i += m[0].length;
                continue;
            }
        }
        i++;
    }
    return keys;
}

// Loop-variable names bound by an x-for expression (`item in items`,
// `(item, index) in items`).
function xForVars(expr) {
    const vars = new Set();
    if (!expr) return vars;
    const m = expr.match(/^\s*(?:\(\s*([^)]*)\s*\)|([A-Za-z_$][\w$]*))\s*in\b/);
    const lhs = m ? (m[1] ?? m[2] ?? "").trim() : "";
    if (!lhs) return vars;
    for (const part of lhs.split(",")) {
        const name = part.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) vars.add(name);
    }
    return vars;
}

// Content byte-ranges of every <template x-for="...">...</template>, with the
// loop variables it binds (so those vars count as in-scope inside).
function collectXForScopes(htmlText) {
    const scopes = [];
    const tagRe = /<\/?template\b[^>]*>/gi;
    const stack = [];
    for (const m of findAll(htmlText, tagRe)) {
        const full = m.match[0];
        if (full.startsWith("</")) {
            const t = stack.pop();
            if (t && t.vars.size) scopes.push({ vars: t.vars, start: t.start, end: m.index });
            continue;
        }
        const xf = /x-for\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/.exec(full);
        const vars = xf ? xForVars(xf[1] ?? xf[2] ?? xf[3]) : new Set();
        stack.push({ vars, start: m.index });
    }
    return scopes;
}

function inXForScope(scopes, pos, word) {
    for (const s of scopes) {
        if (pos >= s.start && pos < s.end && s.vars.has(word)) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Builtin identifiers for alpine-unresolved-identifier
// ---------------------------------------------------------------------------

const BUILTINS = new Set([
  // JS keywords
  "if", "else", "for", "while", "do", "switch", "case", "default", "break",
  "continue", "return", "function", "var", "let", "const", "true", "false",
  "null", "undefined", "new", "typeof", "in", "of", "this", "instanceof",
  "class", "extends", "super", "import", "export", "delete", "void", "yield",
  "async", "await", "static", "get", "set", "from", "as", "try", "catch",
  "finally", "throw", "debugger",
  // core builtins
  "Object", "Array", "String", "Number", "Boolean", "BigInt", "Symbol",
  "Function", "Math", "JSON", "Date", "RegExp", "Error", "TypeError",
  "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError",
  "AggregateError", "Map", "Set", "WeakMap", "WeakSet", "Promise", "Proxy",
  "Reflect", "globalThis", "NaN", "Infinity", "parseInt", "parseFloat",
  "isNaN", "isFinite", "encodeURI", "encodeURIComponent", "decodeURI",
  "decodeURIComponent", "escape", "unescape", "eval", "Intl", "Atomics",
  "WebAssembly", "SharedArrayBuffer", "ArrayBuffer", "DataView", "Int8Array",
  "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array",
  "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array",
  "BigUint64Array", "structuredClone", "queueMicrotask", "setTimeout",
  "setInterval", "clearTimeout", "clearInterval", "requestAnimationFrame",
  "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback",
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Worker",
  "MessageChannel", "MessagePort", "BroadcastChannel", "AbortController",
  "AbortSignal", "FormData", "Blob", "File", "FileReader", "Image",
  "ImageData", "Audio", "TextEncoder", "TextDecoder", "URL", "URLSearchParams",
  "Headers", "Request", "Response", "ReadableStream", "WritableStream",
  "TransformStream", "DOMParser", "MutationObserver", "IntersectionObserver",
  "ResizeObserver", "PerformanceObserver", "Event", "EventTarget",
  "CustomEvent", "MouseEvent", "KeyboardEvent", "PointerEvent", "TouchEvent",
  "WheelEvent", "FocusEvent", "InputEvent", "DragEvent", "ClipboardEvent",
  "ProgressEvent", "MessageEvent", "StorageEvent", "ErrorEvent", "HTMLElement",
  "HTMLDivElement", "HTMLInputElement", "HTMLButtonElement",
  "HTMLSelectElement", "HTMLSpanElement", "HTMLUListElement", "HTMLLIElement",
  "HTMLAnchorElement", "HTMLImageElement", "HTMLTableElement",
  "HTMLFormElement", "HTMLOptionElement", "Element", "Node", "Document",
  "Text", "Comment", "DocumentFragment", "NodeList", "HTMLCollection",
  "NamedNodeMap", "CSSStyleDeclaration", "DOMRect", "DOMTokenList", "Attr",
  "CharacterData", "SVGElement",
  // browser globals
  "window", "document", "localStorage", "sessionStorage", "console",
  "history", "location", "screen", "frames", "self", "top", "parent",
  "customElements", "crypto", "performance", "visualViewport",
  "devicePixelRatio", "innerWidth", "innerHeight", "outerWidth",
  "outerHeight", "pageXOffset", "pageYOffset", "scrollX", "scrollY",
  "screenX", "screenY", "alert", "confirm", "prompt", "open", "close",
  "focus", "blur", "print", "scroll", "scrollTo", "scrollBy",
  "scrollIntoView", "getComputedStyle", "matchMedia", "getSelection",
  "addEventListener", "removeEventListener", "dispatchEvent", "postMessage",
  "atob", "btoa",
  // project CDN globals
  "Fuse", "Sortable", "Alpine", "deepdash", "ionicons",
  // Alpine magics
  "$data", "$el", "$refs", "$root", "$store", "$watch", "$nextTick",
  "$dispatch", "$id", "$event", "$name", "$attrs", "$props", "$slots",
  "$host", "$css", "$x",
]);

// ---------------------------------------------------------------------------
// The 20 rules
// ---------------------------------------------------------------------------

const rules = [
  {
    id: "alpine-orphan-directive",
    description: "Alpine directive (x-* or @*) whose element has no x-data ancestor is inert",
    run(ctx) {
      const out = [];
      const VOID = new Set([
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr",
      ]);
      const ATTR_RE = /(?:^|\s)(@[\w:.-]+|x-[\w:.-]+)(?=\s|=|>)/g;
      const stack = [];
      for (const m of findAll(ctx.htmlText, /<\/?([a-zA-Z][\w-]*)([^>]*)>/g)) {
        const tag = m.match[0];
        const name = m.match[1].toLowerCase();
        const rest = m.match[2] ?? "";
        if (tag.startsWith("</")) {
          for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].name === name) {
              stack.length = i;
              break;
            }
          }
          continue;
        }
        const selfClosing = /\/\s*>$/.test(tag) || VOID.has(name);
        const attrs = [];
        ATTR_RE.lastIndex = 0;
        let a;
        while ((a = ATTR_RE.exec(rest)) !== null) {
          if (a[0].length === 0) {
            ATTR_RE.lastIndex++;
            continue;
          }
          attrs.push({ name: a[1], index: m.index + a.index + a[0].indexOf(a[1]) });
        }
        const hasXData = attrs.some((x) => x.name === "x-data");
        const ancestorHasXData = stack.some((s) => s.hasXData);
        // An element's own x-data puts its other directives in scope too.
        const inScope = ancestorHasXData || hasXData;
        if (!selfClosing) stack.push({ name, hasXData });
        for (const attr of attrs) {
          if (attr.name === "x-data" || attr.name === "x-init") continue;
          if (!inScope) {
            out.push({
              index: attr.index,
              message: `Alpine directive '${attr.name}' has no x-data ancestor — it will never initialize`,
            });
          }
        }
      }
      return out;
    },
  },

  {
    id: "alpine-unresolved-identifier",
    description: "Alpine expression identifier that resolves to no x-data key, script declaration, or known global",
    run(ctx) {
      const out = [];
      const keys = new Set();
      for (const m of findAll(ctx.htmlText, /x-data\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        for (const k of xDataKeys(m.match[1] ?? m.match[2])) keys.add(k);
      }
      for (const m of findAll(ctx.scriptText, /setAttribute\(\s*["']x-data["']\s*,\s*["']([^"']*)["']\s*\)/g)) {
        for (const k of xDataKeys(m.match[1])) keys.add(k);
      }
      const decls = new Set();
      for (const m of findAll(ctx.scriptText, /function\s+([A-Za-z_$][\w$]*)\s*\(/g)) decls.add(m.match[1]);
      for (const m of findAll(ctx.scriptText, /(?:^|[;{}()])\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) decls.add(m.match[1]);
      // Alpine.data('name', () => ({ ... })) component registrations: the
      // component name and its top-level keys are resolvable via x-data="name".
      const components = new Set();
      for (const m of findAll(ctx.scriptText, /Alpine\.data\(\s*["']([^"']+)["']\s*,/g)) {
        components.add(m.match[1]);
        const after = ctx.scriptText.slice(m.index + m.match[0].length);
        const objOpen = after.indexOf("{");
        if (objOpen === -1) continue;
        const objEnd = balancedBraceEnd(after, objOpen);
        if (objEnd === -1) continue;
        for (const k of objectKeys(after.slice(objOpen, objEnd + 1))) keys.add(k);
      }

      // x-for loop-variable scopes.
      const xForScopes = collectXForScopes(ctx.htmlText);
      const exprRe = /(@[\w:.-]+|x-[\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
      const exprs = [];
      for (const m of findAll(ctx.htmlText, exprRe)) {
        const value = m.match[2] ?? m.match[3] ?? m.match[4];
        if (value === undefined) continue;
        exprs.push({ value, base: m.index + m.match[0].indexOf(value) });
      }
      for (const block of ctx.scriptBlocks) {
        for (const m of findAll(block.text, /setAttribute\(\s*["'](@?[\w:.-]+)["']\s*,\s*["']([^"']*)["']\s*\)/g)) {
          if (!/^(@|x-)/.test(m.match[1])) continue;
          exprs.push({ value: m.match[2], base: block.base + m.index + m.match[0].indexOf(m.match[2]) });
        }
      }
      for (const e of exprs) {
        for (const id of exprIdentifiers(e.value)) {
          if (keys.has(id.word) || decls.has(id.word) || components.has(id.word) || BUILTINS.has(id.word)) continue;
          if (new RegExp(`window\\.${escapeRe(id.word)}\\b`).test(ctx.source)) continue;
          if (inXForScope(xForScopes, e.base + id.index, id.word)) continue;
          out.push({
            index: e.base + id.index,
            message: `unresolved identifier '${id.word}' in Alpine expression — declare it in x-data or the script, or use a known global`,
          });
        }
      }
      return out;
    },
  },

  {
    id: "unquoted-attr-interpolation",
    description: "HTML attribute with an unquoted ${...} interpolation in a template string",
    run(ctx) {
      const out = [];
      for (const t of templateLiterals(ctx.source)) {
        if (!t.text.includes("<")) continue;
        for (const m of findAll(t.text, /\s([a-zA-Z][\w-]*)=\$\{/g)) {
          out.push({
            index: t.start + m.index + 1,
            message: `attribute '${m.match[1]}' value is an unquoted interpolation — wrap it in quotes`,
          });
        }
      }
      return out;
    },
  },

  {
    id: "fuse-mixed-property-path",
    description: "Template literal mixes ${item.item.X} and bare ${item.X} reads — bare ones are wrong",
    run(ctx) {
      const out = [];
      for (const t of templateLiterals(ctx.source)) {
        if (!t.text.includes("<")) continue;
        const bare = [];
        let hasNested = false;
        for (const m of findAll(t.text, /\$\{([^}]*)\}/g)) {
          const body = m.match[1].trim();
          if (/^item\.item\.[A-Za-z_$][\w$]*$/.test(body)) {
            hasNested = true;
          } else {
            const mm = body.match(/^item\.([A-Za-z_$][\w$]*)$/);
            if (mm && mm[1] !== "item") bare.push({ m, prop: mm[1] });
          }
        }
        if (hasNested && bare.length > 0) {
          for (const { m, prop } of bare) {
            out.push({
              index: t.start + m.index,
              message: `'item.${prop}' is likely the wrong path; Fuse results are { item, refIndex, score } — use item.item.${prop}`,
            });
          }
        }
      }
      return out;
    },
  },

  {
    id: "duplicate-function-declaration",
    description: "Same top-level function name declared more than once",
    run(ctx) {
      const out = [];
      const decls = [];
      for (const block of ctx.scriptBlocks) {
        for (const m of findAll(block.text, /function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
          decls.push({ name: m.match[1], index: block.base + m.index });
        }
      }
      const counts = new Map();
      for (const d of decls) counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
      const seen = new Set();
      for (const d of decls) {
        if ((counts.get(d.name) ?? 0) > 1 && !seen.has(d.name)) {
          out.push({
            index: d.index,
            message: `duplicate top-level function declaration '${d.name}' (declared ${counts.get(d.name)} times)`,
          });
          seen.add(d.name);
        }
      }
      return out;
    },
  },

  {
    id: "classlist-assignment",
    description: "Assignment of a string to .classList (read-only) instead of .className",
    run(ctx) {
      const out = [];
      for (const block of ctx.scriptBlocks) {
        for (const m of findAll(block.text, /\.classList\s*=\s*["'`]/g)) {
          out.push({
            index: block.base + m.index,
            message: "classList is read-only; use className",
          });
        }
      }
      return out;
    },
  },

  {
    id: "sortable-handle-never-mounted",
    description: "Sortable handle selector that never appears as a class name on any element",
    run(ctx) {
      const out = [];
      for (const block of ctx.scriptBlocks) {
        for (const m of findAll(block.text, /Sortable\.create\s*\(/g)) {
          const tail = block.text.slice(m.index, m.index + 500);
          const hm = tail.match(/handle\s*:\s*["']([^"']+)["']/);
          if (!hm) continue;
          const sel = hm[1];
          const token = sel.replace(/^[.#]/, "");
          if (!token) continue;
          const wordRe = new RegExp(`(?<![\\w$-])${escapeRe(token)}(?![\\w$-])`, "g");
          const occurrences = findAll(ctx.source, wordRe);
          const handleStart = block.base + m.index + hm.index + hm[0].indexOf(hm[1]);
          const elsewhere = occurrences.filter(
            (o) => !(o.index >= handleStart && o.index < handleStart + sel.length)
          );
          if (elsewhere.length === 0) {
            out.push({
              index: block.base + m.index,
              message: `handle '${sel}' is never mounted: no element carries class '${token}'`,
            });
          }
        }
      }
      return out;
    },
  },

  {
    id: "sortable-create-id-as-global",
    description: "Sortable.create(IDENTIFIER) where the identifier is an undeclared global id binding",
    run(ctx) {
      const out = [];
      for (const block of ctx.scriptBlocks) {
        for (const m of findAll(block.text, /Sortable\.create\(\s*([A-Za-z_$][\w$]*)\s*,/g)) {
          const id = m.match[1];
          const declRe = new RegExp(`(?:^|[;{}()])\\s*(?:var|let|const|function)\\s+${escapeRe(id)}\\b`);
          if (!declRe.test(ctx.scriptText)) {
            out.push({
              index: block.base + m.index + m.match[0].indexOf(id),
              message: `'${id}' references a global id→window binding; use document.getElementById('${id}')`,
            });
          }
        }
      }
      return out;
    },
  },

  {
    id: "json-parse-localstorage-then-deref",
    description: "JSON.parse(localStorage.getItem(...)) result dereferenced without a truthiness check",
    run(ctx) {
      const out = [];
      for (const block of ctx.scriptBlocks) {
        for (const m of findAll(
          block.text,
          /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*JSON\.parse\(\s*localStorage\.getItem\(\s*["']([^"']+)["']\s*\)\s*\)/g
        )) {
          const name = m.match[1];
          const key = m.match[2];
          const after = block.text.slice(m.index + m.match[0].length);
          // A `?? <default>` / `|| <default>` immediately after the JSON.parse(...)
          // is a guard against a null/undefined result.
          if (/^\s*(?:\?\?|\|\|)/.test(after)) continue;
          const windowText = after.split("\n").slice(0, 5).join("\n");
          const derefRe = new RegExp(`\\b${escapeRe(name)}\\.([A-Za-z_$][\\w$]*)`);
          let dm;
          derefRe.lastIndex = 0;
          while ((dm = derefRe.exec(windowText)) !== null) {
            const before = windowText.slice(0, dm.index);
            const guard = new RegExp(`if\\s*\\(\\s*!?\\s*${escapeRe(name)}\\b`);
            if (guard.test(before)) break;
            out.push({
              index: block.base + m.index + m.match[0].length + dm.index + name.length,
              message: `'${name}' from JSON.parse(localStorage.getItem('${key}')) may be null — dereferenced '.${dm[1]}' without a truthiness check`,
            });
            break;
          }
        }
      }
      return out;
    },
  },

  {
    id: "css-id-no-element",
    description: "CSS #id selector in <style> with no matching id=\"...\" element in the HTML",
    run(ctx) {
      const out = [];
      const HEX = /^[0-9a-fA-F]{3,8}$/;
      for (const sb of findAll(ctx.htmlText, /<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
        const css = sb.match[1];
        for (const m of findAll(css, /#([A-Za-z_][\w-]*)/g)) {
          const id = m.match[1];
          if (HEX.test(id)) continue;
          const idRe = new RegExp(`\\bid\\s*=\\s*["']${escapeRe(id)}["']`);
          if (!idRe.test(ctx.htmlText)) {
            out.push({
              index: sb.index + sb.match[0].indexOf(m.match[0]),
              message: `CSS id selector '#${id}' has no matching element (id="${id}")`,
            });
          }
        }
      }
      return out;
    },
  },

  {
    id: "dead-function-no-html-attr-ref",
    description: "Top-level function/var never referenced outside its own declaration (HTML attrs count as references)",
    run(ctx) {
      const out = [];
      const comments = commentSpans(ctx.source);
      const decls = [];
      for (const block of ctx.scriptBlocks) {
        for (const m of findAll(block.text, /function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
          const abs = block.base + m.index;
          if (!inSpans(abs, comments)) decls.push({ name: m.match[1], index: abs, declSpan: [abs, abs + m.match[1].length] });
        }
        for (const m of findAll(block.text, /(?:^|[;{}()])\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) {
          const nameOffset = m.match[0].indexOf(m.match[1]);
          const abs = block.base + m.index + nameOffset;
          if (!inSpans(abs, comments)) decls.push({ name: m.match[1], index: abs, declSpan: [abs, abs + m.match[1].length] });
        }
      }
      for (const d of decls) {
        const wordRe = new RegExp(`(?<![\\w$-])${escapeRe(d.name)}(?![\\w$-])`, "g");
        let refs = 0;
        for (const o of findAll(ctx.source, wordRe)) {
          if (o.index >= d.declSpan[0] && o.index < d.declSpan[1]) continue;
          if (inSpans(o.index, comments)) continue;
          refs++;
        }
        if (refs === 0) {
          out.push({
            index: d.index,
            message: `'${d.name}' is never referenced outside its declaration — dead code (no call, no HTML-attribute hook)`,
          });
        }
      }
      return out;
    },
  },

  {
    id: "getelementbyid-id-exists",
    description: "document.getElementById('X') where no element has id=\"X\"",
    run(ctx) {
      const out = [];
      for (const block of ctx.scriptBlocks) {
        for (const m of findAll(block.text, /document\.getElementById\(\s*["']([^"']+)["']\s*\)/g)) {
          const id = m.match[1];
          const idRe = new RegExp(`\\bid\\s*=\\s*["']${escapeRe(id)}["']`);
          if (!idRe.test(ctx.htmlText)) {
            out.push({
              index: block.base + m.index,
              message: `getElementById('${id}') — no element has id="${id}"`,
            });
          }
        }
      }
      return out;
    },
  },

  {
    id: "script-src-whitespace",
    description: "Whitespace inside a <script src=\"...\"> URL",
    run(ctx) {
      const out = [];
      for (const m of findAll(ctx.htmlText, /<script\b[^>]*?\bsrc\s*=\s*"([^"]*)"/gi)) {
        const v = m.match[1];
        if (/^\s|\s$/.test(v)) {
          out.push({
            index: m.index + m.match[0].indexOf("src"),
            message: `whitespace inside src="${v}" — trim it`,
          });
        }
      }
      return out;
    },
  },

  {
    id: "inline-event-handler-in-html-string",
    description: "Inline on* handler with an unquoted value inside a template-literal HTML string",
    run(ctx) {
      const out = [];
      for (const t of templateLiterals(ctx.source)) {
        if (!t.text.includes("<")) continue;
        for (const m of findAll(t.text, /\son[a-z]+\s*=\s*(?!["'])/g)) {
          out.push({
            index: t.start + m.index + 1,
            message: "inline event handler with unquoted value — add quotes or use addEventListener / Alpine @event (CSP-safe)",
          });
        }
      }
      return out;
    },
  },

  {
    id: "alpine-directive-trailing-colon",
    description: "Value-form Alpine directive with a trailing colon (typo) — only x-on:/x-bind:/x-model:/x-transition: take colons",
    run(ctx) {
      const out = [];
      const VALUE_DIRS = ["text", "data", "html", "show", "if", "for", "effect", "init", "cloak", "ref", "id", "ignore", "teleport"];
      const re = new RegExp(`\\bx-(${VALUE_DIRS.join("|")})\\s*:`, "g");
      for (const m of findAll(ctx.htmlText, re)) {
        out.push({
          index: m.index,
          message: `value-form Alpine directive 'x-${m.match[1]}:' with colon — likely typo`,
        });
      }
      const scriptRe = new RegExp(`["']x-(${VALUE_DIRS.join("|")}):`, "g");
      for (const block of ctx.scriptBlocks) {
        for (const m of findAll(block.text, scriptRe)) {
          out.push({
            index: block.base + m.index + 1,
            message: `value-form Alpine directive 'x-${m.match[1]}:' with colon — likely typo`,
          });
        }
      }
      return out;
    },
  },

  {
    id: "alpine-duplicate-directive",
    description: "The same Alpine directive set twice on one element (HTML attr or setAttribute on one variable)",
    run(ctx) {
      const out = [];
      for (const m of findAll(ctx.htmlText, /<([a-zA-Z][\w-]*)([^>]*?)>/g)) {
        const attrs = m.match[2];
        const attrsStart = m.index + m.match[0].length - attrs.length;
        const seen = new Set();
        for (const d of findAll(attrs, /(?:^|\s)(@[\w:.-]+|x-[\w:.-]+)(?=\s|=|>)/g)) {
          const dir = d.match[1];
          if (seen.has(dir)) {
            out.push({
              index: attrsStart + d.index + d.match[0].indexOf(d.match[1]),
              message: `duplicate Alpine directive '${dir}' on one element`,
            });
          }
          seen.add(dir);
        }
      }
      const perVar = new Map();
      for (const block of ctx.scriptBlocks) {
        for (const m of findAll(block.text, /([A-Za-z_$][\w$]*)\s*\.setAttribute\(\s*["'](x-[\w:.-]+|@[\w:.-]+)["']/g)) {
          const v = m.match[1];
          const list = perVar.get(v) ?? [];
          list.push({ dir: m.match[2], index: block.base + m.index });
          perVar.set(v, list);
        }
      }
      for (const [v, list] of perVar) {
        const seen = new Set();
        for (const e of list) {
          if (seen.has(e.dir)) {
            out.push({
              index: e.index,
              message: `duplicate Alpine directive '${e.dir}' set via setAttribute on '${v}'`,
            });
          }
          seen.add(e.dir);
        }
      }
      return out;
    },
  },

  {
    id: "alpine-cloak-missing-css",
    description: "x-cloak used but no [x-cloak]{display:none!important} rule in <style>",
    run(ctx) {
      const out = [];
      const used = findAll(ctx.htmlText, /\bx-cloak\b/).length > 0 ||
        /setAttribute\(\s*["']x-cloak["']/.test(ctx.scriptText);
      if (!used) return out;
      const styles = findAll(ctx.htmlText, /<style\b[^>]*>([\s\S]*?)<\/style>/gi)
        .map((m) => m.match[1])
        .join("\n");
      if (!styles.includes("x-cloak")) {
        out.push({
          index: 0,
          message: "x-cloak is used but no [x-cloak]{display:none!important} rule exists in <style>",
        });
      }
      return out;
    },
  },

  {
    id: "alpine-xon-deprecated-away",
    description: ".away modifier on x-on/@event is deprecated — use .outside",
    run(ctx) {
      const out = [];
      for (const m of findAll(ctx.htmlText, /(?:x-on:[^\s=]+|@[^\s=]+)/g)) {
        if (/\.away\b/.test(m.match[1])) {
          out.push({ index: m.index, message: ".away modifier is deprecated — use .outside" });
        }
      }
      for (const m of findAll(ctx.htmlText, /(?:x-on:[^\s=]+|@[^\s=]+)\s*=\s*["']([^"']*)["']/g)) {
        if (/\.away\b/.test(m.match[1])) {
          out.push({
            index: m.index + m.match[0].indexOf(m.match[1]),
            message: ".away modifier is deprecated — use .outside",
          });
        }
      }
      for (const block of ctx.scriptBlocks) {
        for (const m of findAll(block.text, /setAttribute\(\s*["'](x-on:[^"']+|@[^"']+)["']\s*,\s*["']([^"']*)["']/g)) {
          // The .away modifier lives in the attribute NAME, not the handler value.
          if (/\.away\b/.test(m.match[1])) {
            out.push({
              index: block.base + m.index + m.match[0].indexOf(m.match[1]),
              message: ".away modifier is deprecated — use .outside",
            });
          }
        }
      }
      return out;
    },
  },

  {
    id: "json-roundtrip-copy",
    description: "JSON.parse(JSON.stringify(...)) — pointless round-trip that drops undefined/functions/Date",
    run(ctx) {
      const out = [];
      for (const block of ctx.scriptBlocks) {
        for (const m of findAll(block.text, /JSON\.parse\(\s*JSON\.stringify\(/g)) {
          out.push({
            index: block.base + m.index,
            message: "pointless JSON round-trip; drops undefined/functions/Date",
          });
        }
        // Variable-assignment round-trip: var X = JSON.stringify(...); later
        // X = JSON.parse(X) or JSON.parse(X).
        for (const m of findAll(block.text, /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*JSON\.stringify\(/g)) {
          const name = m.match[1];
          const parseRe = new RegExp(`(?:${escapeRe(name)}\\s*=\\s*)?JSON\\.parse\\(\\s*${escapeRe(name)}\\s*\\)`, "g");
          for (const p of findAll(block.text, parseRe)) {
            out.push({
              index: block.base + p.index + p.match[0].indexOf("JSON.parse"),
              message: "pointless JSON round-trip; drops undefined/functions/Date",
            });
          }
        }
      }
      return out;
    },
  },

  {
    id: "innerhtml-append-loop",
    description: "Repeated innerHTML += on the same variable re-parses the DOM — build once, then assign",
    run(ctx) {
      const out = [];
      const perVar = new Map();
      for (const block of ctx.scriptBlocks) {
        for (const m of findAll(block.text, /([A-Za-z_$][\w$]*)\.innerHTML\s*(\+=|=)\s*/g)) {
          const name = m.match[1];
          const entry = perVar.get(name) ?? { eq: 0, plus: 0, firstPlus: null };
          if (m.match[2] === "+=") {
            entry.plus++;
            if (entry.firstPlus === null) {
              entry.firstPlus = block.base + m.index + m.match[0].indexOf("+=");
            }
          } else {
            entry.eq++;
          }
          perVar.set(name, entry);
        }
      }
      for (const [name, e] of perVar) {
        if ((e.eq >= 1 && e.plus >= 1) || e.plus >= 2) {
          out.push({
            index: e.firstPlus,
            message: `repeated innerHTML re-parse on '${name}'; build the string once, then assign`,
          });
        }
      }
      return out;
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function runSource(source, file) {
  const { htmlText, scriptText, scriptBlocks } = splitSources(source);
  const ctx = { file: file ?? "", source, htmlText, scriptText, scriptBlocks };
  const findings = [];
  for (const rule of rules) {
    for (const f of rule.run(ctx)) {
      findings.push({ ruleId: rule.id, ...lineColAt(source, f.index), message: f.message });
    }
  }
  const seen = new Set();
  const unique = [];
  for (const f of findings) {
    const key = `${f.ruleId}:${f.line}:${f.col}:${f.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(f);
  }
  const order = new Map(rules.map((r, i) => [r.id, i]));
  unique.sort((a, b) => (order.get(a.ruleId) - order.get(b.ruleId)) || (a.line - b.line) || (a.col - b.col));
  return unique;
}

function runFile(file) {
  return runSource(fs.readFileSync(file, "utf8"), file);
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: node scripts/lint-custom.mjs <file...>");
    process.exit(2);
  }
  let total = 0;
  for (const file of files) {
    const findings = runFile(file);
    total += findings.length;
    for (const f of findings) {
      console.log(`${file}:${f.line}:${f.col}  ${f.ruleId}  ${f.message}`);
    }
  }
  if (total > 0) {
    console.error(`${total} finding(s) in ${files.length} file(s)`);
    process.exit(1);
  }
  console.error("0 findings");
  process.exit(0);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}

export { runSource, runFile, rules };
