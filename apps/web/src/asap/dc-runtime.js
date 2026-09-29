/**
 * The few runtime helpers the compiled ASAP interface needs. Expressions in the approved markup
 * are data paths (`tab.title`, `!busy`, `a === b`), resolved here by a parser — nothing is ever
 * evaluated as code.
 */
import React from "react";

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

function wrapsWhole(expr) {
  let depth = 0;
  for (let i = 0; i < expr.length - 1; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")" && --depth === 0) return false;
  }
  return true;
}

function topLevelEquality(expr) {
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    else if (depth === 0 && (c === "=" || c === "!") && expr[i + 1] === "=") {
      if (i > 0 && (expr[i - 1] === "=" || expr[i - 1] === "!")) continue;
      if (!expr.slice(0, i).trim()) continue;
      return { index: i, op: expr[i + 2] === "=" ? c + "==" : c + "=" };
    }
  }
  return null;
}

function path(vals, expr) {
  const head = expr.match(IDENT_RE);
  if (!head) return undefined;
  let cur = vals == null ? undefined : vals[head[0]];
  let i = head[0].length;
  while (i < expr.length) {
    if (expr[i] === ".") {
      const m = expr.slice(i + 1).match(IDENT_RE) || expr.slice(i + 1).match(/^\d+/);
      if (!m) return undefined;
      cur = cur == null ? undefined : cur[m[0]];
      i += 1 + m[0].length;
    } else if (expr[i] === "[") {
      let depth = 1;
      let j = i + 1;
      while (j < expr.length && depth > 0) {
        if (expr[j] === "[") depth++;
        else if (expr[j] === "]" && --depth === 0) break;
        j++;
      }
      if (depth !== 0) return undefined;
      const key = resolvePath(vals, expr.slice(i + 1, j));
      cur = cur == null ? undefined : cur[key];
      i = j + 1;
    } else return undefined;
  }
  return cur;
}

export function resolvePath(vals, src) {
  const expr = String(src).trim();
  if (!expr) return undefined;
  if (expr[0] === "(" && expr.endsWith(")") && wrapsWhole(expr)) return resolvePath(vals, expr.slice(1, -1));
  const eq = topLevelEquality(expr);
  if (eq) {
    const l = resolvePath(vals, expr.slice(0, eq.index));
    const rv = resolvePath(vals, expr.slice(eq.index + eq.op.length));
    switch (eq.op) {
      case "===": return l === rv;
      case "!==": return l !== rv;
      // The approved markup's own loose comparisons, reproduced as written.
      case "==": return l == rv;
      default: return l != rv;
    }
  }
  if (expr[0] === "!") return !resolvePath(vals, expr.slice(1));
  if (expr === "true") return true;
  if (expr === "false") return false;
  if (expr === "null") return null;
  if (expr === "undefined") return undefined;
  if (NUMBER_RE.test(expr)) return Number(expr);
  if (expr.length >= 2 && (expr[0] === '"' || expr[0] === "'") && expr.endsWith(expr[0])) return expr.slice(1, -1);
  return path(vals, expr);
}

export const str = (x) => (x == null || x === false || x === true ? "" : String(x));

const styleCache = new Map();
/** "a:b;c-d:e" → { a: "b", cD: "e" }, cached by string. Empty values are dropped. */
export function cssToStyle(text) {
  let out = styleCache.get(text);
  if (out) return out;
  out = {};
  for (const decl of text.split(";")) {
    const at = decl.indexOf(":");
    if (at === -1) continue;
    const prop = decl.slice(0, at).trim();
    const value = decl.slice(at + 1).trim();
    if (!prop || !value) continue;
    const key = prop.startsWith("--") ? prop : prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = value;
  }
  if (styleCache.size > 5000) styleCache.clear();
  styleCache.set(text, out);
  return out;
}

/** A child scope for a loop variable, reading through to the parent. */
export function scope(parent, name, value) {
  const v = Object.create(parent);
  v[name] = value;
  return v;
}

/** The logic base class the approved component extends: an ordinary React class component. */
export class DCLogic extends React.Component {
  renderVals() {
    return {};
  }
}
