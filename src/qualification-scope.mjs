import { readArtifact, fail } from './qualification-artifacts.mjs';
import { SELECTION } from './qualification-selection.mjs';

// Supported helper language, parsed completely; anything else fails closed with
// QUALIFICATION_SCOPE_UNSUPPORTED. It is a conservative allowlist, not a
// TypeScript parser, and it cannot judge whether a supported change is correct.
//   body       := statement* '}'        (exactly one return, as the last statement)
//   statement  := 'const' name '=' expr ';' | 'return' expr ';'
//   expr       := primary ('.' method)*
//   primary    := parameter | earlier const | 'string' | "string" | '(' expr ')'
//   method     := trim|trimStart|trimEnd|toUpperCase|toLowerCase '(' ')'
//              |  replace|replaceAll '(' (regex | string) ',' string ')'
// Names are ASCII; strings allow only \\ \' \" \n \r \t escapes; regex flags are
// from gimsuy and must compile. Only // and /* */ comments and ASCII whitespace
// separate tokens. No assignment, call of a non-listed member, function value,
// global reference, template, or operator is accepted, so the body cannot change
// shared runtime state such as Object.is.
const NO_ARGUMENTS = new Set(['trim', 'trimStart', 'trimEnd', 'toUpperCase', 'toLowerCase']);
const REPLACE = new Set(['replace', 'replaceAll']);
const KEYWORDS = new Set(['await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'eval', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in',
  'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'arguments', 'undefined']);
const unsupported = () => fail('QUALIFICATION_SCOPE_UNSUPPORTED');

function parseBody(text, start, parameter) {
  let i = start;
  const skip = () => {
    for (;;) {
      if (i < text.length && ' \t\n\r'.includes(text[i])) i++;
      else if (text.startsWith('//', i)) {
        const end = text.slice(i + 2).search(/[\n\r\u2028\u2029]/);
        if (end < 0) unsupported();
        i += end + 3;
      }
      else if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); if (end < 0) unsupported(); i = end + 2; }
      else return;
    }
  };
  const punct = c => { skip(); if (text[i] !== c) unsupported(); i++; };
  const name = () => {
    skip();
    const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i, i + 128));
    if (!match) unsupported();
    i += match[0].length;
    if (/^[A-Za-z0-9_$]/.test(text[i] ?? '')) unsupported();
    return match[0];
  };
  const string = () => {
    skip();
    const quote = text[i];
    if (quote !== "'" && quote !== '"') unsupported();
    for (i++; i < text.length; i++) {
      const c = text[i];
      if (c === quote) { i++; return; }
      if (c === '\\') { if (!`\\'"nrt`.includes(text[++i] ?? 'x')) unsupported(); continue; }
      if (c < ' ' || c === ' ' || c === ' ') unsupported();
    }
    unsupported();
  };
  const regex = () => {
    skip();
    if (text[i] !== '/' || text[i + 1] === '/' || text[i + 1] === '*') unsupported();
    const begin = i + 1; let characterClass = false;
    for (i++; i < text.length; i++) {
      const c = text[i];
      if (c === '\n' || c === '\r' || c === ' ' || c === ' ') unsupported();
      if (c === '\\') { i++; if (i >= text.length || /[\n\r\u2028\u2029]/.test(text[i])) unsupported(); continue; }
      if (c === '[') characterClass = true;
      else if (c === ']') characterClass = false;
      else if (c === '/' && !characterClass) break;
    }
    if (text[i] !== '/') unsupported();
    const source = text.slice(begin, i++);
    const flags = /^[a-z]*/.exec(text.slice(i, i + 8))[0];
    i += flags.length;
    if (!/^[gimsuy]*$/.test(flags) || new Set(flags).size !== flags.length || /^[A-Za-z0-9_$]/.test(text[i] ?? '')) unsupported();
    try { new RegExp(source, flags); } catch { unsupported(); }
  };
  const declared = new Set([parameter]);
  const expression = () => {
    skip();
    if (text[i] === '(') { i++; expression(); punct(')'); }
    else if (text[i] === "'" || text[i] === '"') string();
    else if (!declared.has(name())) unsupported();
    for (;;) {
      skip();
      if (text[i] !== '.') return;
      i++;
      const method = name();
      punct('(');
      if (REPLACE.has(method)) {
        skip();
        if (text[i] === '/') regex(); else string();
        punct(','); string();
      } else if (!NO_ARGUMENTS.has(method)) unsupported();
      punct(')');
    }
  };
  for (let returned = false; ;) {
    skip();
    if (text[i] === '}') { if (!returned) unsupported(); return i; }
    if (returned) unsupported();
    const keyword = name();
    if (keyword === 'return') { expression(); returned = true; }
    else if (keyword === 'const') {
      const local = name();
      if (KEYWORDS.has(local) || declared.has(local)) unsupported();
      punct('='); expression(); declared.add(local);
    } else unsupported();
    punct(';');
  }
}

function envelope(text) {
  const signature = /export function normalizeAddress\(([^()]*)\)(?:\s*:\s*string)?\s*\{/g;
  const matches = [...text.matchAll(signature)];
  if (matches.length !== 1) unsupported();
  const parameter = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*string\s*)?$/.exec(matches[0][1])?.[1];
  if (!parameter || KEYWORDS.has(parameter)) unsupported();
  const start = matches[0].index + matches[0][0].length;
  const end = parseBody(text, start, parameter);
  return [text.slice(0, start), text.slice(end)];
}
export async function verifyHelperScope(directory) {
  const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const before = envelope(decode(await readArtifact(directory, `qualification/base/${SELECTION.helper}`)));
  const after = envelope(decode(await readArtifact(directory, `qualification/draft/${SELECTION.helper}`)));
  if (before[0] !== after[0] || before[1] !== after[1]) fail('QUALIFICATION_SCOPE');
}
