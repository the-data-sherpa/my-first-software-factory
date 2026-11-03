import { install } from '../fixtures/qualification-drain-fault.mjs';
install();
await import('./qualification-worker.mjs');
