// Controlled framework boundary, not the Vitest distribution. Emits framework
// events to the real factory reporter; it never manufactures qualification JSON.
export function expect(actual) {
  return { toBe(expected) {
    globalThis.fixtureAssertions++;
    if (!Object.is(actual, expected)) throw Object.assign(new Error(`expected value to be expected // Object.is equality`),
      { name: 'AssertionError', actual, expected });
  } };
}
export function test(name, run) { globalThis.fixtureTests.push({ name, run, skip: false }); }
test.skip = (name, run) => globalThis.fixtureTests.push({ name, run, skip: true });
