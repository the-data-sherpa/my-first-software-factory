// Authored, synthetic Bun-lock shapes only. No captured target bytes, public registry, or package code is used here.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, chmod, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tarball, bunPath } from './dependencies-registry-fixture.mjs';
import { admitWorkspace, prepareWorkspace } from '../../src/workspace.mjs';
import { admitDependencies, serializeDependencyError } from '../../src/dependencies.mjs';

export { bunPath };
// One authored placement: [lock key, version, lock metadata, optional archive manifest overrides].
// The archive manifest is derived from the lock metadata, as a published package would declare it.
export function archiveManifest(name, version, metadata) {
  const pkg = { name, version, type: 'module', exports: './index.js' };
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bin']) if (metadata[key]) pkg[key] = metadata[key];
  if (metadata.optionalPeers) pkg.peerDependenciesMeta = Object.fromEntries(metadata.optionalPeers.map((peer) => [peer, { optional: true }]));
  for (const key of ['os', 'cpu']) if (metadata[key]) pkg[key] = Array.isArray(metadata[key]) ? metadata[key] : [metadata[key]];
  return pkg;
}
export function lockFixture({ configVersion = 0, dependencies = {}, devDependencies, placements }) {
  const archives = new Map(); const packages = {};
  for (const [key, version, metadata = {}, archive = {}] of placements) {
    const name = key.match(/(?:@[^/]+\/)?[^/@]+$/)[0];
    const pkg = { ...archiveManifest(name, version, metadata), ...archive };
    const bytes = tarball({ 'package.json': JSON.stringify(pkg), 'index.js': `export const value = ${JSON.stringify(`${name}@${version}`)};` });
    archives.set(`/${name}/-/${name.split('/').at(-1)}-${version}.tgz`, bytes);
    packages[key] = [`${name}@${version}`, '', metadata, `sha512-${createHash('sha512').update(bytes).digest('base64')}`];
  }
  const manifest = { name: 'compatibility-fixture', version: '1.0.0', dependencies, ...(devDependencies ? { devDependencies } : {}) };
  const lock = { lockfileVersion: 1, configVersion,
    workspaces: { '': { name: manifest.name, dependencies, ...(devDependencies ? { devDependencies } : {}) } }, packages };
  return { manifest, lock, archives };
}

async function writable(path) {
  await chmod(path, 0o700);
  for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await writable(`${path}/${entry.name}`);
}
// Commits authored bytes into a disposable owner repository and admits a private workspace for it.
export async function compatibilityRepository(t, { manifest, lock, archives }, { lockText, serve = false } = {}) {
  const root = await mkdtemp('/tmp/factory-dependency-compatibility-');
  const repositoryPath = `${root}/owner`; const stateDir = `${root}/private`;
  await mkdir(repositoryPath, { mode: 0o700 }); await mkdir(stateDir, { mode: 0o700 });
  await writeFile(`${repositoryPath}/package.json`, JSON.stringify(manifest));
  await writeFile(`${repositoryPath}/bun.lock`, lockText ?? `${JSON.stringify(lock, null, 2)}\n`);
  await writeFile(`${repositoryPath}/package-lock.json`, '{"fixture":"npm lock must remain byte identical"}\n');
  const git = (...args) => execFileSync('/usr/bin/git', ['-C', repositoryPath, ...args], { env: {
    PATH: '/usr/bin', HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture', GIT_COMMITTER_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  }, stdio: 'pipe' });
  git('init', '--initial-branch=main', '--template='); git('add', '.'); git('commit', '-m', 'authored compatibility fixture');
  const workspaceIntent = await admitWorkspace({ stateDir, project: { id: 'fixture', repositoryPath }, runId: 'run_compatibility' });
  await prepareWorkspace(workspaceIntent);
  const requests = []; let server;
  if (serve) {
    server = createServer((req, res) => {
      requests.push({ method: req.method, path: req.url, authorization: req.headers.authorization });
      const bytes = archives.get(req.url);
      res.writeHead(bytes ? 200 : 404, { 'Content-Type': 'application/octet-stream' }); res.end(bytes ?? 'not planned');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  }
  t.after(async () => {
    if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    await writable(root); await rm(root, { recursive: true, force: true });
  });
  return { root, repositoryPath, stateDir, workspaceIntent, requests, registryTransport: server && { loopbackPort: server.address().port } };
}

export async function admit(t, fixture, options) {
  const f = await compatibilityRepository(t, fixture, options);
  try { return { ...f, intent: await admitDependencies({ workspaceIntent: f.workspaceIntent, bunPath, registry: true }) }; }
  catch (error) { return { ...f, failure: serializeDependencyError(error).code }; }
}
