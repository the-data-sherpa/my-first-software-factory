// Linux x86-64 classic BPF. Other ABIs (including x32) are killed, not accidentally allowed.
// Private IPC socketpairs remain usable; socket creation/connect/bind and io_uring are denied.
export function containmentFilter() {
  const instructions = [
    [0x20, 0, 0, 4], [0x15, 1, 0, 0xc000003e], [0x06, 0, 0, 0x80000000],
    [0x20, 0, 0, 0], [0x35, 0, 1, 0x40000000], [0x06, 0, 0, 0x80000000],
  ];
  for (const syscall of [41, 42, 43, 49, 50, 288, 44, 46, 307, 425, 426, 427,
    101, 310, 311, 165, 166, 155, 308, 272, 304, 321, 298, 250, 248, 249]) {
    instructions.push([0x15, 0, 1, syscall], [0x06, 0, 0, 0x50001]); // EPERM
  }
  instructions.push([0x06, 0, 0, 0x7fff0000]);
  const buffer = Buffer.alloc(instructions.length * 8);
  instructions.forEach(([code, jt, jf, k], index) => {
    buffer.writeUInt16LE(code, index * 8); buffer[index * 8 + 2] = jt;
    buffer[index * 8 + 3] = jf; buffer.writeUInt32LE(k, index * 8 + 4);
  });
  return buffer;
}
