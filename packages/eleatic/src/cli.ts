#!/usr/bin/env node
/**
 * The `eleatic` bin — a commander CLI with one `serve` subcommand that boots the
 * eval-results explorer. Modelled on `tools/photo-curation/src/cli.ts`.
 *
 * `buildProgram(startServerFn)` constructs the program with an INJECTABLE server
 * starter, so cli.test.ts can parse argv and inspect the parsed options (and the
 * args handed to startServer) without binding a real port. The module only
 * actually parses `process.argv` + uses the real `startServer` when run as a
 * script (the `import.meta.url`/`process.argv[1]` guard at the bottom).
 */

import { Command } from 'commander';
import { startServer, type ServeOptions } from './server/serve.js';

/** The starter signature buildProgram injects (real or fake). */
export type StartServerFn = (opts: ServeOptions) => { close: () => void };

export function buildProgram(start: StartServerFn): Command {
  const program = new Command();
  program.name('eleatic').description('Domain-agnostic eval-results explorer');

  program
    .command('serve')
    .description('Start the eleatic eval-results explorer')
    .requiredOption('--db <path>', 'eval store path (eval.sqlite)')
    .option('--port <port>', 'port to bind', '8788')
    .option('--config <path>', 'optional eleatic config JSON')
    .action((opts: { db: string; port: string; config?: string }) => {
      // Only set the optional configPath key when --config was passed
      // (exactOptionalPropertyTypes: an omitted optional is an ABSENT key).
      start({
        dbPath: opts.db,
        port: Number(opts.port),
        ...(opts.config !== undefined ? { configPath: opts.config } : {}),
      });
    });

  return program;
}

// Run as a script (`eleatic ...` / `node dist/cli.js ...`), not on import. The
// guard keeps `import { buildProgram } from './cli.js'` (the test) side-effect
// free — importing must not parse argv or start a server.
const invokedAsScript =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedAsScript) {
  buildProgram(startServer).parseAsync(process.argv);
}
