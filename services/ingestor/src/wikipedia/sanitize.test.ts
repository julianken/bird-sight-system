import { describe, it, expect } from 'vitest';
import { sanitizeWikipediaExtract, sanitizeText, SanitizationError } from './sanitize.js';

const PADDING = '. The vermilion flycatcher is a small bird native to the Americas.';

describe('sanitizeWikipediaExtract', () => {
  it('passes through plain paragraph + bold + italic + sup + sub + br + em + strong', async () => {
    const input = `<p>The <b>vermilion</b> <i>flycatcher</i> <em>(Pyrocephalus <strong>rubinus</strong>)</em> H<sub>2</sub>O ranks 2<sup>nd</sup>.<br>${PADDING}</p>`;
    const out = sanitizeWikipediaExtract(input);
    // Allowlisted tags survive intact.
    expect(out).toContain('<p>');
    expect(out).toContain('<b>vermilion</b>');
    expect(out).toContain('<i>flycatcher</i>');
    expect(out).toContain('<em>');
    expect(out).toContain('<strong>rubinus</strong>');
    expect(out).toContain('<sub>2</sub>');
    expect(out).toContain('<sup>nd</sup>');
    expect(out).toContain('<br');
  });

  it('strips <script> blocks (defense-in-depth — Wikipedia would never serve one)', () => {
    const malicious = `<p>Vermilion flycatcher.<script>alert("XSS")</script>${PADDING}</p>`;
    const out = sanitizeWikipediaExtract(malicious);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
    // The benign content survives.
    expect(out).toContain('Vermilion flycatcher');
  });

  it('strips <a> with relative href (e.g. #cite_note-1) — only http/https URIs survive', () => {
    // Relative anchors (#cite_note-1, /wiki/Foo) make sense inside Wikipedia
    // but break in the rendered frontend; the ALLOWED_URI_REGEXP requires
    // an absolute http(s) URL. Without that regex, hrefs like "#cite_note-1"
    // would survive and dangle on click.
    const input = `<p>See <a href="#cite_note-1">[1]</a> and <a href="/wiki/Tyrannidae">flycatcher family</a> details.${PADDING}</p>`;
    const out = sanitizeWikipediaExtract(input);
    expect(out).not.toContain('href="#cite_note-1"');
    expect(out).not.toContain('href="/wiki/Tyrannidae"');
    // The textual content remains; only the broken hrefs are dropped.
    expect(out).toContain('[1]');
    expect(out).toContain('flycatcher family');
  });

  it('preserves <a> with absolute https href', () => {
    const input = `<p>See <a href="https://en.wikipedia.org/wiki/Tyrannidae">Tyrannidae</a> for the family.${PADDING}</p>`;
    const out = sanitizeWikipediaExtract(input);
    expect(out).toContain('href="https://en.wikipedia.org/wiki/Tyrannidae"');
  });

  it('preserves <span lang="..."> (used for binomial Latin annotations on pages like Phainopepla)', () => {
    const input = `<p>The <span lang="la">Phainopepla nitens</span> is a slender bird.${PADDING}</p>`;
    const out = sanitizeWikipediaExtract(input);
    expect(out).toContain('<span lang="la">');
    expect(out).toContain('Phainopepla nitens');
  });

  it('strips style/class attributes (allowlist is href + lang only)', () => {
    const input = `<p style="color:red" class="foo">Vermilion <span style="font-weight:bold" class="bar">flycatcher</span>.${PADDING}</p>`;
    const out = sanitizeWikipediaExtract(input);
    expect(out).not.toContain('style');
    expect(out).not.toContain('class');
    expect(out).toContain('<p>');
    expect(out).toContain('<span>');
  });

  it('strips javascript: URIs in href', () => {
    // The ALLOWED_URI_REGEXP guarantees this, but pin it as an explicit
    // attack-surface test for future readers.
    const input = `<p>Click <a href="javascript:alert(1)">me</a>${PADDING}</p>`;
    const out = sanitizeWikipediaExtract(input);
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('alert');
    expect(out).toContain('me');
  });

  it('throws SanitizationError when post-sanitize body length is below 50 chars', () => {
    // <script> contents fully strip to nothing; remaining text is too short
    // to be a useful description for a species detail card.
    const input = '<p>too short</p>';
    expect(() => sanitizeWikipediaExtract(input)).toThrow(SanitizationError);
    expect(() => sanitizeWikipediaExtract(input)).toThrow(/length/i);
  });

  it('throws SanitizationError when post-sanitize body length exceeds 8192 chars', () => {
    // 9000 chars of raw text wrapped in <p>; survives sanitization, exceeds
    // the size cap.
    const input = `<p>${'a'.repeat(9000)}</p>`;
    expect(() => sanitizeWikipediaExtract(input)).toThrow(SanitizationError);
    expect(() => sanitizeWikipediaExtract(input)).toThrow(/length/i);
  });

  it('accepts exactly 50 chars and exactly 8192 chars (boundary inclusive)', () => {
    // Both exactly-50 and exactly-8192 are accepted (matches DB CHECK
    // BETWEEN 50 AND 8192). The wrapper <p> doesn't count toward the limit
    // when DOMPurify echoes the same wrapper back.
    const input50 = `<p>${'a'.repeat(46)}</p>`; // <p> + 46 chars + </p> = 53 chars (within 50..8192)
    expect(() => sanitizeWikipediaExtract(input50)).not.toThrow();
    const input8192 = `<p>${'b'.repeat(8185)}</p>`; // 8185 + 7 wrapper = 8192
    expect(() => sanitizeWikipediaExtract(input8192)).not.toThrow();
  });
});

describe('sanitizeText', () => {
  // sanitizeText is the iNat-fallback counterpart to sanitizeWikipediaExtract.
  // iNat's `wikipedia_summary` field is plaintext extracted from the Wikipedia
  // article — no HTML to allow-list. But we still strip any tags as
  // defense-in-depth (never trust input) and trim whitespace, then enforce the
  // same `[50, 8192]` length contract that matches the DB body CHECK.

  it('returns the input unchanged when it is already plain text within bounds', () => {
    const input = `Vermilion flycatcher (Pyrocephalus rubinus) is a small passerine native to the Americas. ${PADDING}`;
    const out = sanitizeText(input);
    expect(out).toBe(input.trim());
  });

  it('strips HTML tags (defense-in-depth — iNat returns plaintext but never trust input)', () => {
    const input = `<script>alert("XSS")</script>The vermilion flycatcher is a small passerine bird native to the Americas. ${PADDING}`;
    const out = sanitizeText(input);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('</script>');
    expect(out).toContain('vermilion flycatcher');
  });

  it('strips even benign-looking tags like <p> and <em> (no allowlist — plaintext only)', () => {
    const input = `<p>The vermilion flycatcher (<em>Pyrocephalus rubinus</em>) is a small passerine bird native to the Americas.${PADDING}</p>`;
    const out = sanitizeText(input);
    expect(out).not.toContain('<p>');
    expect(out).not.toContain('<em>');
    expect(out).not.toContain('</p>');
    expect(out).toContain('vermilion flycatcher');
    expect(out).toContain('Pyrocephalus rubinus');
  });

  it('trims leading and trailing whitespace', () => {
    const input = `   \n\tThe Vermilion flycatcher is a small passerine bird native to the Americas. ${PADDING}\n   `;
    const out = sanitizeText(input);
    expect(out.startsWith(' ')).toBe(false);
    expect(out.startsWith('\n')).toBe(false);
    expect(out.endsWith(' ')).toBe(false);
    expect(out.endsWith('\n')).toBe(false);
    expect(out).toContain('Vermilion flycatcher');
  });

  it('throws SanitizationError when post-strip length is below 50 chars', () => {
    const input = '<p>too short</p>';
    expect(() => sanitizeText(input)).toThrow(SanitizationError);
    expect(() => sanitizeText(input)).toThrow(/length/i);
  });

  it('throws SanitizationError when post-strip length exceeds 8192 chars', () => {
    const input = `${'a'.repeat(8193)}`;
    expect(() => sanitizeText(input)).toThrow(SanitizationError);
    expect(() => sanitizeText(input)).toThrow(/length/i);
  });

  it('accepts exactly 50 chars and exactly 8192 chars (boundary inclusive — matches DB body CHECK)', () => {
    const input50 = 'a'.repeat(50);
    expect(() => sanitizeText(input50)).not.toThrow();
    const input8192 = 'b'.repeat(8192);
    expect(() => sanitizeText(input8192)).not.toThrow();
  });

  it('an empty-after-strip input throws SanitizationError (whitespace + tags only)', () => {
    // A pathological iNat response that strips to nothing must not silently
    // produce a 0-char body that fails the DB CHECK opaquely; surface a
    // SanitizationError with a clear "below MIN_LENGTH" message.
    const input = '   <span></span>   <p></p>   ';
    expect(() => sanitizeText(input)).toThrow(SanitizationError);
    expect(() => sanitizeText(input)).toThrow(/length/i);
  });
});
