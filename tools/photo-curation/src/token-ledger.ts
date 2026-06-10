/**
 * Token-spend ledger helper for photo-curation operations (#997, ledger #996).
 *
 * After every score / source-candidates / calibration run the operator records
 * one row in ledger issue #996. This module does the cost math (blended OR
 * exact split, ×0.5 batch), formats the markdown row, and splices it directly
 * above the `<!-- APPEND-ROWS-ABOVE-THIS-LINE -->` marker. The GitHub read/write
 * is injected (ReadWriteDeps) so the whole path is unit-testable without
 * touching GitHub — the same DI idiom as apply-swaps.ts (runApplySwaps(deps)).
 *
 * Contract: NO `@anthropic-ai/sdk` and NO `ANTHROPIC_API_KEY`. We never call a
 * model here — we only price token counts the Workflow already reported.
 */

export const LEDGER_ISSUE = 996;

/** The marker new rows are inserted immediately above (mirrors #996 verbatim). */
export const APPEND_MARKER = '<!-- APPEND-ROWS-ABOVE-THIS-LINE -->';

/**
 * Price table — USD per **Million** tokens. ONE constant, dated so it is
 * updatable as Anthropic pricing moves.
 *
 * Anthropic live pricing, 2026-06 (from ledger #996's cost-model table). The
 * cache multipliers are conventions, not separate columns: cache-read = 0.1×
 * input, 5-minute cache-write = 1.25× input, 1-hour cache-write = 2× input.
 * Re-audit when Anthropic publishes a price change; bump the date when you do.
 */
export const PRICE_TABLE = {
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
} as const satisfies Record<string, { input: number; output: number }>;

/** Cache-rate multipliers relative to a model's input rate (#996 convention). */
export const CACHE_READ_MULT = 0.1; // cache-read
export const CACHE_WRITE_5M_MULT = 1.25; // 5-minute cache-write
export const CACHE_WRITE_1H_MULT = 2; // 1-hour cache-write

/** Blended-rate mix: photo scoring is input-heavy (image+rubric in, verdict out). */
export const BLEND_INPUT_SHARE = 0.85;
export const BLEND_OUTPUT_SHARE = 0.15;

/** Batch API discount applied to est_$ (#996). */
export const BATCH_DISCOUNT = 0.5;

export type JudgeModel = keyof typeof PRICE_TABLE;

export type Op = 'score_batch' | 'source_candidates' | 'calibration';
export type AgentDesign = 'generic' | 'lean_photo_judge';
export type YesNo = 'yes' | 'no';

/**
 * Exact per-bucket token split (the four Anthropic buckets). When supplied,
 * est_$ is priced exactly instead of via the blended rate. `cacheCreate` is
 * priced at the 5-minute cache-write rate (the common case); a 1-hour split is
 * not modelled separately — keep those runs blended or extend this type.
 */
export interface TokenSplit {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

export interface LedgerInput {
  runId: string;
  date: string; // YYYY-MM-DD, UTC
  op: Op;
  judgeModel: JudgeModel;
  agentDesign: AgentDesign;
  prefilter: YesNo;
  itemsIn: number;
  gateRejected: number;
  agents: number;
  totalTokens: number;
  toolUses: number;
  durationMs: number;
  batch?: boolean;
  split?: TokenSplit;
  notes?: string;
}

export interface LedgerRow {
  runId: string;
  date: string;
  op: Op;
  judgeModel: JudgeModel;
  agentDesign: AgentDesign;
  prefilter: YesNo;
  itemsIn: number;
  gateRejected: number;
  scored: number;
  agents: number;
  totalTokens: number;
  toolUses: number;
  durS: number;
  tokensPerItem: number;
  estUsd: number; // unrounded USD
  estUsdLabel: string; // "$2.81"
  usdPerItemLabel: string; // "$0.94"
  exact: boolean; // true when priced from the four-bucket split
  notes: string;
}

/** Blended USD/MTok for a model: 0.85·input + 0.15·output. */
export function blendedRate(model: string): number {
  const price = PRICE_TABLE[model as JudgeModel];
  if (!price) {
    throw new Error(
      `unknown model "${model}" — add it to PRICE_TABLE (known: ${Object.keys(PRICE_TABLE).join(', ')})`,
    );
  }
  return BLEND_INPUT_SHARE * price.input + BLEND_OUTPUT_SHARE * price.output;
}

/** Exact USD from the four Anthropic buckets, priced at the model's rates. */
function exactUsd(model: JudgeModel, split: TokenSplit): number {
  const price = PRICE_TABLE[model];
  if (!price) {
    throw new Error(`unknown model "${model}" — add it to PRICE_TABLE`);
  }
  const cacheReadRate = price.input * CACHE_READ_MULT;
  const cacheWriteRate = price.input * CACHE_WRITE_5M_MULT;
  return (
    (split.input * price.input +
      split.output * price.output +
      split.cacheRead * cacheReadRate +
      split.cacheCreate * cacheWriteRate) /
    1e6
  );
}

/** Format a USD number as a "$x.xx" label (2 dp). */
function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Compute every derived column from the run facts (#996 cost model):
 *   scored        = items_in − gate_rejected
 *   tokens/item   = round(total_tokens / scored)
 *   est_$         = blended (total_tokens · blended/1e6) OR exact (four buckets),
 *                   ×0.5 when --batch
 *   $/item        = est_$ / scored
 */
export function computeRow(input: LedgerInput): LedgerRow {
  const scored = input.itemsIn - input.gateRejected;
  if (scored <= 0) {
    throw new Error(
      `scored must be > 0 (items_in ${input.itemsIn} − gate_rejected ${input.gateRejected} = ${scored})`,
    );
  }

  const exact = input.split !== undefined;
  let estUsd = exact
    ? exactUsd(input.judgeModel, input.split as TokenSplit)
    : (input.totalTokens * blendedRate(input.judgeModel)) / 1e6;
  if (input.batch) estUsd *= BATCH_DISCOUNT;

  const tokensPerItem = Math.round(input.totalTokens / scored);
  const usdPerItem = estUsd / scored;

  return {
    runId: input.runId,
    date: input.date,
    op: input.op,
    judgeModel: input.judgeModel,
    agentDesign: input.agentDesign,
    prefilter: input.prefilter,
    itemsIn: input.itemsIn,
    gateRejected: input.gateRejected,
    scored,
    agents: input.agents,
    totalTokens: input.totalTokens,
    toolUses: input.toolUses,
    durS: Math.round(input.durationMs / 1000),
    tokensPerItem,
    estUsd,
    estUsdLabel: usd(estUsd),
    usdPerItemLabel: usd(usdPerItem),
    exact,
    notes: input.notes ?? '',
  };
}

/** US-style thousands separator for token counts. */
function group(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Render a LedgerRow as the 17-column markdown table row that #996 expects:
 * run_id | date | op | judge_model | agent_design | prefilter | items_in |
 * gate_rej | scored | agents | total_tokens | tool_uses | dur_s | tokens/item |
 * est_$ | $/item | notes
 *
 * Exact-split rows get an "exact $" suffix in notes so a reader knows est_$ is
 * not the blended approximation.
 */
export function formatRow(row: LedgerRow): string {
  const notes = row.exact
    ? `${row.notes ? `${row.notes} · ` : ''}exact $ (per-bucket split)`
    : row.notes;
  const cells = [
    row.runId,
    row.date,
    row.op,
    row.judgeModel,
    row.agentDesign,
    row.prefilter,
    String(row.itemsIn),
    String(row.gateRejected),
    String(row.scored),
    String(row.agents),
    group(row.totalTokens),
    String(row.toolUses),
    String(row.durS),
    group(row.tokensPerItem),
    row.estUsdLabel,
    row.usdPerItemLabel,
    notes,
  ];
  return `| ${cells.join(' | ')} |`;
}

/**
 * Does the body already contain a ledger row whose FIRST cell is `runId`?
 * Matches `| <runId> |` at the start of a table row only, so a run_id that
 * merely appears inside a notes cell does not count as a duplicate.
 */
export function hasRunId(body: string, runId: string): boolean {
  const escaped = runId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\|\\s*${escaped}\\s*\\|`, 'm');
  return re.test(body);
}

/**
 * Insert `rowMarkdown` on the line immediately above the APPEND marker. Throws
 * if the marker is absent rather than guessing an insert point — a missing
 * marker means the issue body drifted and the operator should look.
 */
export function spliceRowAboveMarker(body: string, rowMarkdown: string): string {
  const lines = body.split('\n');
  const markerIdx = lines.findIndex(line => line.trim() === APPEND_MARKER);
  if (markerIdx === -1) {
    throw new Error(`append marker "${APPEND_MARKER}" not found in issue body`);
  }
  lines.splice(markerIdx, 0, rowMarkdown);
  return lines.join('\n');
}

export interface ReadWriteDeps {
  readIssueBody: () => Promise<string>;
  writeIssueBody: (body: string) => Promise<void>;
  log: (line: string) => void;
}

export interface LogRunResult {
  appended: boolean; // false when skipped as a duplicate run_id
  row: string; // the formatted markdown row (whether or not it was appended)
}

/**
 * End-to-end: read the ledger body, compute + format the row, and (unless the
 * run_id is already present) splice it above the marker and write back. The
 * read/write are injected so unit tests never hit GitHub.
 */
export async function runLogRun(input: LedgerInput, deps: ReadWriteDeps): Promise<LogRunResult> {
  const row = formatRow(computeRow(input));
  const body = await deps.readIssueBody();

  if (hasRunId(body, input.runId)) {
    deps.log(
      `Run "${input.runId}" already exists in the ledger — not appending a duplicate row.`,
    );
    return { appended: false, row };
  }

  const next = spliceRowAboveMarker(body, row);
  await deps.writeIssueBody(next);
  deps.log(`Appended row for run "${input.runId}" to ledger #${LEDGER_ISSUE}.`);
  deps.log(row);
  return { appended: true, row };
}
