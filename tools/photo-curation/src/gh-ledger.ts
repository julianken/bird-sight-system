import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEDGER_ISSUE } from './token-ledger.js';

const execFileAsync = promisify(execFile);

/**
 * The live GitHub read/write for the token ledger, backed by the `gh` CLI.
 *
 * Read: `gh api repos/<repo>/issues/<n> --jq .body`.
 * Write: `gh issue edit <n> --repo <repo> --body-file <tmp>` — `--body-file`
 *        avoids shell-escaping a multi-KB markdown body on argv.
 *
 * This is the ONLY place that touches GitHub. The pure splice/format logic in
 * token-ledger.ts takes these as injected deps (ReadWriteDeps) so it stays
 * unit-testable without network. Kept out of cli.ts so the command wiring is thin.
 */
export function ghLedgerDeps(opts: {
  repo: string;
  issue?: number;
  log: (line: string) => void;
}) {
  const issue = opts.issue ?? LEDGER_ISSUE;
  return {
    log: opts.log,
    async readIssueBody(): Promise<string> {
      const { stdout } = await execFileAsync('gh', [
        'api',
        `repos/${opts.repo}/issues/${issue}`,
        '--jq',
        '.body',
      ]);
      // `gh api --jq .body` emits the body followed by a trailing newline.
      return stdout.replace(/\n$/, '');
    },
    async writeIssueBody(body: string): Promise<void> {
      const dir = await mkdtemp(join(tmpdir(), 'token-ledger-'));
      const file = join(dir, 'body.md');
      try {
        await writeFile(file, body, 'utf8');
        await execFileAsync('gh', [
          'issue',
          'edit',
          String(issue),
          '--repo',
          opts.repo,
          '--body-file',
          file,
        ]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
