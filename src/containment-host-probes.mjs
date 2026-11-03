import { createServer, connect } from 'node:net';
import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export async function hostProbes(directory) {
  // The caller supplies a short, pinned /proc/PID/fd path into its private receipt directory.
  const servers = []; let connections = 0;
  async function listen(address) {
    const server = createServer((socket) => { connections++; socket.end(); });
    servers.push(server); server.listen(address); await once(server, 'listening');
    const target = typeof address === 'string' ? address : { host: '127.0.0.1', port: server.address().port };
    const socket = connect(target); await once(socket, 'connect'); socket.end(); await once(socket, 'close');
    return target;
  }
  let udp;
  try {
    udp = createSocket('udp4');
    udp.on('message', () => { connections++; });
    udp.bind(0, '127.0.0.1'); await once(udp, 'listening');
    const datagram = { host: '127.0.0.1', port: udp.address().port };
    const received = once(udp, 'message');
    udp.send(Buffer.alloc(0), datagram.port, datagram.host); await received;
    const tcp = await listen({ host: '127.0.0.1', port: 0 });
    const abstract = await listen(`\0factory-containment-${randomUUID()}`);
    const socket = await listen(`${directory}/backend.sock`);
    await writeFile(`${directory}/private-sentinel`, 'controlled private sentinel', { flag: 'wx', mode: 0o600 });
    connections = 0;
    return { input: { tcp, abstract, socket, udp: datagram, sentinel: `${directory}/private-sentinel` },
      connections: () => connections,
      close: async () => {
        await new Promise((resolve) => udp.close(resolve));
        await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
      } };
  } catch (error) {
    try { udp?.close(); } catch { /* A failed bind leaves no live socket. */ }
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    throw error;
  }
}
