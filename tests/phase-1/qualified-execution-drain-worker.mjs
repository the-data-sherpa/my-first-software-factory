import { install } from '../fixtures/qualification-drain-fault.mjs';
install(); // Before containment loads its promisified manager adapter.
await import('./qualified-execution-worker.mjs');
