// Fixed destructive-diagnostic profile, never an accepted production envelope.
export const DIAGNOSTIC_LIMITS = Object.freeze({
  memoryBytes: 192 * 1024 ** 2, swapBytes: 0, tasks: 48,
  checkMs: 2000, scratchBytes: 1024 ** 2,
  outputBytes: 1024 ** 2, writeBytes: 64 * 1024, readBytes: 16 * 1024,
});
export const SMALL_DIAGNOSTICS = Object.freeze(['resources', 'memory']);
