import { verifyContainmentEnvelope } from './containment.mjs';

try {
  if (process.argv[2] === 'serve') { await verifyContainmentEnvelope(); await import('../bin/factory.mjs'); }
  else if (process.argv[2] === 'diagnose' && process.argv[3] === 'envelope') {
    process.stdout.write(`${JSON.stringify({ envelope: await verifyContainmentEnvelope() })}\n`);
  } else if (process.argv[2] === 'diagnose') {
    const { runContainmentDiagnostic } = await import('./containment-diagnostics.mjs');
    process.stdout.write(`${JSON.stringify(await runContainmentDiagnostic(process.argv[3], process.argv[4]))}\n`);
  } else if (process.argv[2] === 'dependencies-diagnose') {
    const { runDependencyDiagnostic } = await import('./dependencies-diagnostics.mjs');
    process.stdout.write(`${JSON.stringify(await runDependencyDiagnostic(process.argv[3], process.argv[4]))}\n`);
  } else if (process.argv[2] === 'prepare-dependencies' && process.argv.length === 4) {
    const { regular } = await import('./dependencies-files.mjs');
    const { prepareOwnerDependencies, serializeDependencyError } = await import('./dependencies.mjs');
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
    try {
      const intent = JSON.parse((await regular(process.argv[3], 16 * 1024 ** 2)).toString('utf8'));
      process.stdout.write(`${JSON.stringify(await prepareOwnerDependencies(intent, { signal: controller.signal }))}\n`);
    } catch (error) {
      process.stderr.write(`${JSON.stringify({ error: serializeDependencyError(error) })}\n`); process.exitCode = 1;
    } finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); }
  } else throw new Error('Unknown diagnostic');
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: { code: error.code ?? 'CONTAINMENT_FAILED', message: 'Containment unavailable. No fallback.' } })}\n`);
  process.exitCode = 1;
}
