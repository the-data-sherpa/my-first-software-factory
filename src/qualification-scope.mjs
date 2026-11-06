import { readArtifact, fail, hash } from './qualification-artifacts.mjs';
import { SELECTION } from './qualification-selection.mjs';

// Supported helper language, parsed completely; anything else fails closed with
// QUALIFICATION_SCOPE_UNSUPPORTED. It is a conservative allowlist, not a
// TypeScript parser, and it cannot judge whether a supported change is correct.
//   helper     := signature guard? body
//   signature  := 'export function normalizeAddress(' name (':' 'string' (' | null | undefined')?)? ')' (':' 'string')? '{'
//   guard      := 'if' '(' '!' parameter ')' 'return' ('""' | "''") ';'   (no line terminator after 'return')
//   body       := statement* '}'        (exactly one return, as the last statement)
//   statement  := ('const' | 'let') name '=' expr ';' | 'return' expr ';'
//   expr       := primary ('.' method)*
//   primary    := parameter | earlier binding | 'string' | "string" | '(' expr ')'
//   method     := trim|trimStart|trimEnd|toUpperCase|toLowerCase '(' ')'
//              |  replace|replaceAll '(' (regex | string) ',' string ')'
// The signature and guard form the immutable prefix that base and draft must share.
// A nullable parameter requires the guard, so null, undefined, and "" return "" in
// both. `!` on a parameter calls no user code. A `let` binding cannot be reassigned
// because the grammar has no assignment.
// Names are ASCII; strings allow only \\ \' \" \n \r \t escapes; regex flags are
// from gimsuy and must compile. Only // and /* */ comments and ASCII whitespace
// separate tokens. No assignment, call of a non-listed member, function value,
// global reference, template, control flow other than the guard, or operator other
// than the guard's `!` is accepted, so the body cannot change shared runtime state
// such as Object.is.
const NO_ARGUMENTS = new Set(['trim', 'trimStart', 'trimEnd', 'toUpperCase', 'toLowerCase']);
const REPLACE = new Set(['replace', 'replaceAll']);
const KEYWORDS = new Set(['await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'eval', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in',
  'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'arguments', 'undefined']);
const unsupported = () => fail('QUALIFICATION_SCOPE_UNSUPPORTED');

// Returns the end of the optional leading guard and the index of the closing brace.
function parseBody(text, start, parameter, nullable) {
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
  skip();
  let guardEnd = start;
  if (text.startsWith('if', i) && !/^[A-Za-z0-9_$]/.test(text[i + 2] ?? '')) {
    name(); punct('('); punct('!');
    if (name() !== parameter) unsupported();
    punct(')');
    if (name() !== 'return') unsupported();
    // A line terminator here, even inside a comment, would make JavaScript return undefined.
    const afterReturn = i; skip();
    if (/[\n\r\u2028\u2029]/.test(text.slice(afterReturn, i))) unsupported();
    const literal = i; string();
    if (i !== literal + 2) unsupported();
    punct(';');
    guardEnd = i;
  } else if (nullable) unsupported();
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
    if (text[i] === '}') { if (!returned) unsupported(); return { guardEnd, end: i }; }
    if (returned) unsupported();
    const keyword = name();
    if (keyword === 'return') { expression(); returned = true; }
    else if (keyword === 'const' || keyword === 'let') {
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
  const [, parameter, nullable] = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*string( \| null \| undefined)?\s*)?$/.exec(matches[0][1]) ?? [];
  if (!parameter || KEYWORDS.has(parameter)) unsupported();
  const { guardEnd, end } = parseBody(text, matches[0].index + matches[0][0].length, parameter, Boolean(nullable));
  return [text.slice(0, guardEnd), text.slice(end)];
}
const decode = bytes => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return unsupported(); } };
export async function verifyHelperScope(directory) {
  const before = envelope(decode(await readArtifact(directory, `qualification/base/${SELECTION.helper}`)));
  const after = envelope(decode(await readArtifact(directory, `qualification/draft/${SELECTION.helper}`)));
  if (before[0] !== after[0] || before[1] !== after[1]) fail('QUALIFICATION_SCOPE');
}

/** Composed-run eligibility, checked before containment, ModelRuntime construction,
 * or the smoke request. The selected write pair must be exact. The helper bytes read
 * without following links must equal the admitted manifest entry, and they must parse
 * under the same grammar. The late draft check above remains required.
 */
export async function verifyAdmittedHelper({ intent, writePaths }) {
  const selected = [SELECTION.helper, SELECTION.test].sort();
  if (!Array.isArray(writePaths) || JSON.stringify([...writePaths].sort()) !== JSON.stringify(selected)) fail('QUALIFICATION_SCOPE');
  const entry = intent.sourceManifest.entries.find(item => item.path === SELECTION.helper);
  if (!entry) fail('QUALIFICATION_BASE_INVALID');
  let bytes;
  try { bytes = await readArtifact(intent.worktree, SELECTION.helper, entry.bytes); } catch { fail('ADMISSION_SOURCE_CHANGED'); }
  if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) fail('ADMISSION_SOURCE_CHANGED');
  envelope(decode(bytes));
}
