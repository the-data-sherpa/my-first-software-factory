// Synthetic registry only. No package metadata or archives come from public services.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { admitDependencies, prepareDependencies, dependencyDirectory } from '../../src/dependencies.mjs';

export const bunPath = '/home/cowen/.bun/bin/bun';
export const scripts = (kind) => Object.fromEntries(['preinstall', 'install', 'postinstall'].map((phase) => [phase,
  `bun -e 'require("fs").writeFileSync("/tmp/work/${kind}-${phase}", "executed")'`]));
export function tarball(files) {
  const blocks = [];
  for (const [path, content] of Object.entries(files)) {
    const data = Buffer.from(content); const header = Buffer.alloc(512);
    header.write(`package/${path}`, 0, 100); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124); header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
    header.write(`${header.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
export async function registryFixture(root, { mutateLock, mutateManifest, response, nested = false, extraFiles = 0 } = {}) {
  const repositoryPath = `${root}/owner`; const stateDir = `${root}/private`;
  await mkdir(repositoryPath, { mode: 0o700 }); await mkdir(stateDir, { mode: 0o700 });
  const packages = {
    vitest: { name: 'vitest', version: '1.0.0', type: 'module', dependencies: { 'fixture-leaf': '2.0.0' }, scripts: scripts('dependency'), bin: { vitest: './vitest.mjs' } },
    'fixture-leaf': { name: 'fixture-leaf', version: '2.0.0', type: 'module', exports: './index.js', scripts: scripts('dependency') },
  };
  if (nested) {
    packages['vitest/fixture-leaf'] = packages['fixture-leaf'];
    packages['fixture-leaf'] = { name: 'fixture-leaf', version: '1.0.0', type: 'module', exports: './index.js' };
    packages.vitest.dependencies['@fixture/scoped'] = '~3.0.0';
    packages['@fixture/scoped'] = { name: '@fixture/scoped', version: '3.0.0', type: 'module', exports: './index.js' };
  }
  const archives = new Map(); const tuples = {};
  for (const [key, pkg] of Object.entries(packages)) {
    const name = pkg.name;
    const files = { 'package.json': JSON.stringify(pkg) };
    if (name === 'vitest') files['vitest.mjs'] = `import { value } from 'fixture-leaf'; ${nested ? "import { value as scoped } from '@fixture/scoped';" : ''} console.log(JSON.stringify({ value, ${nested ? 'scoped,' : ''} argv: process.argv.slice(2) }));`;
    else files['index.js'] = `export const value = ${JSON.stringify(pkg.version === '1.0.0' ? 'root leaf not nested' : 'transitive registry fixture')};`;
    if (name === 'vitest') for (let index = 0; index < extraFiles; index++) files[`padding/${index}.js`] = '/* controlled padding */'.repeat(40);
    const bytes = tarball(files);
    archives.set(`/${name}/-/${name.split('/').at(-1)}-${pkg.version}.tgz`, bytes);
    const metadata = Object.fromEntries(['dependencies', 'bin'].filter((key) => pkg[key]).map((key) => [key, pkg[key]]));
    tuples[key] = [`${name}@${pkg.version}`, '', metadata, `sha512-${createHash('sha512').update(bytes).digest('base64')}`];
  }
  const manifest = { name: 'registry-fixture', version: '1.0.0', scripts: scripts('root'), trustedDependencies: ['vitest', 'fixture-leaf'], dependencies: { vitest: '1.0.0' } };
  if (nested) manifest.dependencies = { vitest: '^1.0.0', 'fixture-leaf': '^1.0.0' };
  const lock = { lockfileVersion: 1, configVersion: 1, workspaces: { '': { name: manifest.name, dependencies: manifest.dependencies } }, trustedDependencies: manifest.trustedDependencies, packages: tuples };
  mutateManifest?.(manifest); mutateLock?.(lock);
  await writeFile(`${repositoryPath}/package.json`, JSON.stringify(manifest));
  await writeFile(`${repositoryPath}/bun.lock`, JSON.stringify(lock));
  await writeFile(`${repositoryPath}/package-lock.json`, '{"fixture":"npm lock must remain byte identical"}\n');
  const git = (...args) => execFileSync('/usr/bin/git', ['-C', repositoryPath, ...args], { env: {
    PATH: '/usr/bin', HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture', GIT_COMMITTER_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  }, stdio: 'pipe' });
  git('init', '--initial-branch=main', '--template='); git('add', '.'); git('commit', '-m', 'synthetic registry');
  const workspaceIntent = await admitWorkspace({ stateDir, project: { id: 'fixture', repositoryPath }, runId: 'run_registry' });
  await prepareWorkspace(workspaceIntent);
  const requests = []; const sockets = new Set();
  const server = createServer(async (req, res) => {
    requests.push({ method: req.method, path: req.url, authorization: req.headers.authorization });
    if (response) return response(req, res, archives);
    const bytes = archives.get(req.url);
    res.writeHead(bytes ? 200 : 404, { 'Content-Type': 'application/octet-stream' }); res.end(bytes ?? 'not allowed');
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { repositoryPath, stateDir, workspaceIntent, git, archives, requests, sockets,
    registryTransport: { loopbackPort: server.address().port },
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }) };
}

export async function prepareFixture(root, options) {
  const f = await registryFixture(root, options);
  try {
    f.intent = await admitDependencies({ workspaceIntent: f.workspaceIntent, bunPath, registry: true });
    await writeFile(`${root}/saved-intent.json`, JSON.stringify(f.intent), { mode: 0o600 });
    f.receipt = await prepareDependencies(f.intent, { authorizeRegistryFetch: true, registryTransport: f.registryTransport });
    f.directory = dependencyDirectory(f.intent);
    f.lockfilesUnchanged = (await Promise.all(['bun.lock', 'package-lock.json'].map(async (path) =>
      (await readFile(`${f.repositoryPath}/${path}`)).equals(await readFile(`${f.workspaceIntent.worktree}/${path}`))))).every(Boolean);
    return f;
  } catch (error) { await f.close(); throw error; }
}
