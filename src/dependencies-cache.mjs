// Default-registry cache basenames for Bun 1.3.14. Callers validate names and
// strict versions without build metadata before reaching this formatter.
// Pinned source: oven-sh/bun@0d9b296af33f2b851fcbf4df3e9ec89751734ba4,
// src/install/PackageManager/PackageManagerDirectories.zig and src/wyhash/wyhash.zig.
// The stateless Wyhash11 port below follows Bun's copy of Zig
// v0.11.0-dev.2609+5e19250a1/lib/std/hash/wyhash.zig (seed zero).
//
// The MIT License (Expat)
// Copyright (c) 2015-2023, Zig contributors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
const primes = [0xa0761d6478bd642fn, 0xe7037ed1a0b428dbn, 0x8ebc6af09c88c6e3n, 0x589965cc75374cc3n, 0x1d8e4e27c47d124fn];
const mum = (a, b) => { const product = a * b; return BigInt.asUintN(64, (product >> 64n) ^ product); };
const mix0 = (a, b, seed) => mum(a ^ seed ^ primes[0], b ^ seed ^ primes[1]);
const mix1 = (a, b, seed) => mum(a ^ seed ^ primes[2], b ^ seed ^ primes[3]);

function suffixHash(bytes) {
  let seed = 0n; let offset = 0;
  for (; offset + 32 <= bytes.length; offset += 32) {
    seed = mix0(bytes.readBigUInt64LE(offset), bytes.readBigUInt64LE(offset + 8), seed)
      ^ mix1(bytes.readBigUInt64LE(offset + 16), bytes.readBigUInt64LE(offset + 24), seed);
  }
  // This is Bun's exact short-tail packing, including its swapped 32-bit halves
  // for eight-byte words. Full rounds above deliberately use ordinary LE64.
  const u8 = at => BigInt(bytes[at]);
  const u16 = at => BigInt(bytes.readUInt16LE(at));
  const u32 = at => BigInt(bytes.readUInt32LE(at));
  const word = (at, count) => {
    switch (count) {
      case 1: return u8(at);
      case 2: return u16(at);
      case 3: return (u16(at) << 8n) | u8(at + 2);
      case 4: return u32(at);
      case 5: return (u32(at) << 8n) | u8(at + 4);
      case 6: return (u32(at) << 16n) | u16(at + 4);
      case 7: return (u32(at) << 24n) | (u16(at + 4) << 8n) | u8(at + 6);
      case 8: return (u32(at) << 32n) | u32(at + 4);
    }
  };
  const remaining = bytes.length - offset;
  if (remaining > 0 && remaining <= 8) seed = mix0(word(offset, remaining), primes[4], seed);
  else if (remaining <= 16 && remaining > 8) seed = mix0(word(offset, 8), word(offset + 8, remaining - 8), seed);
  else if (remaining > 16) {
    const second = remaining <= 24 ? mix1(word(offset + 16, remaining - 16), primes[4], seed)
      : mix1(word(offset + 16, 8), word(offset + 24, remaining - 24), seed);
    seed = mix0(word(offset, 8), word(offset + 8, 8), seed) ^ second;
  }
  return mum(seed ^ BigInt(bytes.length), primes[4]).toString(16).padStart(16, '0');
}

export function registryCachePath(name, version) {
  const separator = version.indexOf('-');
  const cachedVersion = separator < 0 ? version
    : `${version.slice(0, separator)}-${suffixHash(Buffer.from(version.slice(separator + 1), 'utf8'))}`;
  return `${name}@${cachedVersion}@@@1`;
}
