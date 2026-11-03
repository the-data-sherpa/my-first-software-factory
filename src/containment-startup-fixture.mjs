// Fixed fault injection for disposable preparation diagnostics only. Actual installed
// bwrap/Bun, mounts and preparation interfaces remain in use; no substitute command.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { processIdentity } from './containment-process-fixtures.mjs';

export function stopPreparationStartup(root, stage, envelope) {
  if (!/^\/tmp\/factory-dependencies-[A-Za-z0-9]+$/.test(root) || !['proof', 'target'].includes(stage)) throw new Error('Disposable startup fixture required.');
  const spawn = childProcess.spawn;
  const ready = Promise.withResolvers(); let selected;
  childProcess.spawn = (command, args, options) => {
    const input = args[args.indexOf('/input') - 1];
    const matches = command === '/usr/bin/bwrap' && input?.startsWith(`${root}/private/`)
      && (stage === 'proof' ? input.endsWith('/script-proof/input') : input.endsWith('/input') && !input.endsWith('/script-proof/input'));
    if (!matches || selected) return spawn(command, args, options);
    // Baseline lacked --info-fd. Add observation only, separate from export fd5.
    // Never change the baseline's kill or verification implementation.
    const info = args.indexOf('--info-fd');
    const fd = info < 0 ? options.stdio.length : Number(args[info + 1]);
    if (info < 0) { args = ['--info-fd', String(fd), ...args]; options = { ...options, stdio: [...options.stdio, 'pipe'] }; }
    const child = selected = spawn(command, args, options);
    child.stdio[4].end = () => child.stdio[4]; // Keep the command behind the startup gate.
    let text = ''; let exited = false; let closed = false;
    child.on('exit', () => { exited = true; }); child.on('close', () => { closed = true; });
    child.stdio[fd].on('data', (data) => { text += data; });
    child.stdio[fd].on('end', () => {
      (async () => {
        const pid = JSON.parse(text)['child-pid'];
        const sandbox = await processIdentity(pid);
        if (sandbox?.parentPid !== child.pid || (await readFile(`/proc/${pid}/cgroup`, 'utf8')).trim() !== `0::${envelope.cgroup}`) throw new Error('Unowned startup PID.');
        process.kill(pid, 'SIGSTOP');
        // Both implementations save this before releasing the gate.
        const receipt = `${input.slice(0, -'/input'.length)}/launch.json`;
        for (let i = 0; ; i++) {
          try { await readFile(receipt); break; } catch (error) { if (error.code !== 'ENOENT' || i >= 1000) throw error; }
          await delay(1);
        }
        ready.resolve({ backendIdentity: await processIdentity(process.pid), observed: [await processIdentity(child.pid), await processIdentity(pid)],
          envelope, stage, injected: 'namespace SIGSTOP with startup gate held', events: () => ({ exited, closed }) });
      })().catch(ready.reject);
    });
    return child;
  };
  syncBuiltinESMExports();
  return { ready: ready.promise, restore() { childProcess.spawn = spawn; syncBuiltinESMExports(); selected?.stdio[4].destroy(); } };
}
