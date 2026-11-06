// Authored package identities, not expected hash values. Actual network-denied
// Bun cache lookups independently decide whether these packages can be prepared.
export const prereleasePackages = [
  { name: 'exact.prerelease', version: '1.0.0-beta.2', spec: '1.0.0-beta.2' },
  { name: 'caret.prerelease', version: '2.0.0-next.5', spec: '^2.0.0-next.5' },
  { name: '@cache.scope/pre.release', version: '1.0.0-beta.3', spec: '1.0.0-beta.3' },
  { name: 'case.upper', version: '1.0.0-BETA.2', spec: '1.0.0-BETA.2' },
  { name: 'case.lower', version: '1.0.0-beta.2', spec: '1.0.0-beta.2' },
  // Bun's integer-hex cache field for zero44 begins with 0: dropping padding
  // makes the real cache lookup fail, while the locked identity stays unchanged.
  { name: 'leading.zero', version: '1.0.0-zero44', spec: '1.0.0-zero44' },
  { name: 'stable.control', version: '1.0.0', spec: '^1.0.0' },
  { name: '@cache.scope/stable.control', version: '1.0.0', spec: '1.0.0' },
];
// All nonempty suffix lengths admitted with a 1.0.0 triple, up to the existing
// 64-byte version limit. Varying bytes distinguish swapped tail reads from LE64;
// length 32 exercises an empty tail after a full round, and 33..58 combine both.
const pattern = 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7';
for (let length = 1; length <= 58; length++) {
  const version = `1.0.0-${pattern.repeat(3).slice(0, length)}`;
  prereleasePackages.push({ name: `tail.fixture-${String(length).padStart(2, '0')}`, version, spec: version });
}
