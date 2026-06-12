import { describe, it, expect } from 'vitest';
import { defaultRubricConfig } from '@bird-watch/photo-quality';
import {
  judgePromptForRubricVersion,
  DEFAULT_EVAL_MODEL,
  resolveEvalModel,
} from './rubric-prompts.js';

// Markers that exist ONLY in the v0.2.2 prompt (commit 974d8c5): the
// same-species-multiples STEP 3 clarification and the adult-plumage STEP 4
// tiebreaker. The v0.2.1 snapshot must contain NEITHER — that criteria delta
// is exactly the drift the pin exists to hold constant (#1037).
const V022_MULTIPLES_MARKER = 'Several individuals of the SAME species';
const V022_ADULT_MARKER = 'mildly prefer an ADULT';

describe('judgePromptForRubricVersion', () => {
  it('returns the v0.2.1 snapshot for version 0.2.1 (no v0.2.2 criteria)', () => {
    const prompt = judgePromptForRubricVersion('0.2.1');
    // The shared four-step field-mark framing is present…
    expect(prompt).toContain('STEP 1 — Diagnostic field marks');
    expect(prompt).toContain('keep (boolean');
    // …but the v0.2.2 criteria changes are NOT.
    expect(prompt).not.toContain(V022_MULTIPLES_MARKER);
    expect(prompt).not.toContain(V022_ADULT_MARKER);
    expect(prompt).not.toBe(defaultRubricConfig.judgePrompt);
  });

  it('maps the LIVE config version to the live prompt (pin follows a re-scored baseline)', () => {
    expect(judgePromptForRubricVersion(defaultRubricConfig.version)).toBe(
      defaultRubricConfig.judgePrompt,
    );
  });

  it('throws on an unknown version, naming it', () => {
    expect(() => judgePromptForRubricVersion('9.9.9')).toThrow(/9\.9\.9/);
  });
});

describe('resolveEvalModel', () => {
  it('defaults to gemini-2.5-flash when EVAL_MODEL is unset', () => {
    expect(resolveEvalModel({})).toBe('gemini-2.5-flash');
    expect(DEFAULT_EVAL_MODEL).toBe('gemini-2.5-flash');
  });

  it('respects an EVAL_MODEL override', () => {
    expect(resolveEvalModel({ EVAL_MODEL: 'gemini-2.0-flash-lite' })).toBe('gemini-2.0-flash-lite');
  });

  it('treats an empty EVAL_MODEL as unset (fail-safe to the default)', () => {
    expect(resolveEvalModel({ EVAL_MODEL: '' })).toBe('gemini-2.5-flash');
  });
});
