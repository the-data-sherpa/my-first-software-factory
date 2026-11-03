import { verifyContainmentEnvelope } from './containment.mjs';

try {
  if (process.argv[2] === 'serve') { await verifyContainmentEnvelope(); await import('../bin/factory.mjs'); }
  else if (process.argv[2] === 'diagnose' && process.argv[3] === 'envelope') {
    process.stdout.write(`${JSON.stringify({ envelope: await verifyContainmentEnvelope() })}\n`);
  } else if (process.argv[2] === 'diagnose') {
    const { runContainmentDiagnostic } = await import('./containment-diagnostics.mjs');
    process.stdout.write(`${JSON.stringify(await runContainmentDiagnostic(process.argv[3], process.argv[4]))}\n`);
  } else throw new Error('Unknown diagnostic');
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: { code: error.code ?? 'CONTAINMENT_FAILED', message: 'Containment unavailable. No fallback.' } })}\n`);
  process.exitCode = 1;
}
