import { readArtifact, fail } from './qualification-artifacts.mjs';
import { SELECTION } from './qualification-selection.mjs';

// Conservative lexical envelope, not a TypeScript semantic proof. Only this named
// function body may change. Unsupported templates/ambiguous slash expressions
// block instead of interpreting an arbitrary source program on the host.
function envelope(text) {
  const signature = /export function normalizeAddress\([^()]*\)(?:\s*:\s*string)?\s*\{/g;
  const matches = [...text.matchAll(signature)];
  if (matches.length !== 1) fail('QUALIFICATION_SCOPE_UNSUPPORTED');
  const start = matches[0].index + matches[0][0].length;
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '`') fail('QUALIFICATION_SCOPE_UNSUPPORTED');
    if (c === '/' && text[i + 1] === '/') { const end = text.indexOf('\n', i + 2); if (end < 0) break; i = end; continue; }
    if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); if (end < 0) break; i = end + 1; continue; }
    if (c === "'" || c === '"' || c === '/') {
      // Regex is supported only as the first argument of .replace(/.../,...).
      if (c === '/' && !/\.replace\(\s*$/.test(text.slice(start, i))) fail('QUALIFICATION_SCOPE_UNSUPPORTED');
      let closed = false; let characterClass = false;
      for (++i; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue; }
        if (text[i] === '\n' || text[i] === '\r') fail('QUALIFICATION_SCOPE_UNSUPPORTED');
        if (c === '/' && text[i] === '[') characterClass = true;
        if (c === '/' && text[i] === ']') characterClass = false;
        if (text[i] === c && !characterClass) { closed = true; break; }
      }
      if (!closed) fail('QUALIFICATION_SCOPE_UNSUPPORTED');
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return [text.slice(0, start), text.slice(i)];
  }
  fail('QUALIFICATION_SCOPE_UNSUPPORTED');
}
export async function verifyHelperScope(directory) {
  const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const before = envelope(decode(await readArtifact(directory, `qualification/base/${SELECTION.helper}`)));
  const after = envelope(decode(await readArtifact(directory, `qualification/draft/${SELECTION.helper}`)));
  if (before[0] !== after[0] || before[1] !== after[1]) fail('QUALIFICATION_SCOPE');
}
