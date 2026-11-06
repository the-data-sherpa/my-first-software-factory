// Controlled baseline-check consumer, inlined into the disposable vitest package.
// It is not Vitest. It models only the CLI contract the baseline check relies on,
// taken from the retained Vitest 4.0.17 sources (packages/vitest/src/node/cli/cac.ts
// and cli-config.ts; config.ts for fileParallelism):
// - every command is registered without allowUnknownOptions, so an option absent
//   from cli-config.ts is a startup error (`--minWorkers` is absent);
// - `run` disables watch mode;
// - fileParallelism:false overrides maxWorkers to 1.
// Options outside this small table are rejected too, which keeps the fixture fail-closed.
export const vitestBaselineCli = `
if (process.argv[1].endsWith('/vitest/vitest.mjs')) {
  const booleans = new Set(['run', 'watch', 'fileParallelism', 'cache', 'allowOnly', 'passWithNoTests']);
  const valued = new Set(['maxWorkers', 'retry', 'configLoader', 'config', 'reporter']);
  const camel = name => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const options = { fileParallelism: true, watch: true };
  const args = process.argv.slice(2);
  let startupError;
  if (args[0] === 'run') { options.run = true; options.watch = false; args.shift(); }
  for (let i = 0; i < args.length && !startupError; i++) {
    const match = /^--(no-)?([^=]+)(?:=(.*))?$/.exec(args[i]);
    if (!match) continue; // filter
    const name = camel(match[2]);
    if (booleans.has(name) && match[3] === undefined) options[name] = !match[1];
    else if (valued.has(name) && !match[1]) options[name] = match[3] ?? args[++i];
    else startupError = 'CACError: Unknown option \\\`' + args[i].split('=')[0] + '\\\`';
  }
  if (options.run) options.watch = false;
  const requested = Number(options.maxWorkers ?? 2);
  const resolved = startupError ? undefined : { watch: options.watch, fileParallelism: options.fileParallelism,
    maxWorkers: options.fileParallelism === false ? 1 : requested };
  console.log(JSON.stringify({ vitestCli: startupError ? { startupError } : { resolved } }));
  if (startupError || !Number.isInteger(requested) || requested < 1) process.exitCode = 1;
}
`;
