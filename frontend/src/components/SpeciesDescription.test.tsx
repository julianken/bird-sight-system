import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpeciesDescription } from './SpeciesDescription.js';

/**
 * SpeciesDescription tests (#373 / epic #368).
 *
 * The component is the only place in the codebase that uses React's
 * HTML-injection escape hatch. Sanitization happens at INGEST time
 * (`services/ingestor/src/wikipedia/sanitize.ts` via DOMPurify with a
 * narrow tag allowlist + DB CHECK constraints); the writer-side allowlist
 * is the trust boundary. Tests pin three behaviors:
 *
 *   1. Renders sanitized HTML via the escape hatch when `descriptionBody`
 *      is present (no encoding of the inner markup).
 *   2. Returns `null` (renders nothing) when `descriptionBody` is absent —
 *      matches the CDN-stale contract on the wire (optional field) and
 *      avoids an empty `<section>` shell.
 *   3. The inline credit anchor carries `target="_blank"` +
 *      `rel="noopener noreferrer"` and the per-article `href`.
 */

describe('SpeciesDescription', () => {
  it('renders the descriptionBody HTML via the React injection escape hatch', () => {
    const body =
      '<p>The <em>Vermilion Flycatcher</em> is a small passerine bird.</p>';
    render(
      <SpeciesDescription
        descriptionBody={body}
        descriptionAttributionUrl="https://en.wikipedia.org/wiki/Vermilion_flycatcher"
      />,
    );
    // Verify the inner <p> + <em> render as actual DOM nodes (i.e. the
    // string was injected as HTML, not encoded as a text node). Querying
    // by role catches the case where the HTML is rendered as escaped
    // text — `screen.getByText('<p>The...')` would match the escaped
    // rendering, but `<em>` selection only succeeds when the HTML
    // parsed as markup.
    const em = screen.getByText(/Vermilion Flycatcher/i);
    expect(em.tagName).toBe('EM');
    expect(em.textContent).toBe('Vermilion Flycatcher');
  });

  it('renders nothing when descriptionBody is undefined', () => {
    const { container } = render(
      <SpeciesDescription
        descriptionAttributionUrl="https://en.wikipedia.org/wiki/Vermilion_flycatcher"
      />,
    );
    // A bare `null` return — no shell `<section>`, no credit anchor.
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when descriptionBody is an empty string', () => {
    // Empty string is falsy in the `!descriptionBody` guard. Rendering an
    // empty `<section>` would be worse than nothing (it would create a
    // visual gap in the surface that SR users would land on).
    const { container } = render(
      <SpeciesDescription
        descriptionBody=""
        descriptionAttributionUrl="https://en.wikipedia.org/wiki/Vermilion_flycatcher"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('surfaces the inline credit only when descriptionBody is present', () => {
    render(
      <SpeciesDescription
        descriptionBody="<p>Body.</p>"
        descriptionAttributionUrl="https://en.wikipedia.org/wiki/Vermilion_flycatcher"
      />,
    );
    expect(screen.getByText(/From/)).toBeInTheDocument();
    expect(screen.getByText(/CC BY-SA/)).toBeInTheDocument();
  });

  it('the credit anchor carries target="_blank" + rel="noopener noreferrer" + href={descriptionAttributionUrl}', () => {
    const url = 'https://en.wikipedia.org/wiki/Vermilion_flycatcher';
    render(
      <SpeciesDescription
        descriptionBody="<p>Body.</p>"
        descriptionAttributionUrl={url}
      />,
    );
    const link = screen.getByRole('link', { name: /wikipedia/i });
    expect(link).toHaveAttribute('href', url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders the credit text even when descriptionAttributionUrl is undefined (no crash)', () => {
    // Defensive: the writer-side contract is that body + URL co-vary
    // (both present or both absent on the wire), but a CDN-stale
    // response carrying body without URL must not crash. The credit
    // copy still appears; the `<a>` carries no `href` attribute and
    // therefore has no implicit `link` role per ARIA — that is OK,
    // the visual fallback is just unstyled "Wikipedia" text.
    const { container } = render(<SpeciesDescription descriptionBody="<p>Body.</p>" />);
    expect(screen.getByText(/From/)).toBeInTheDocument();
    expect(screen.getByText('Wikipedia')).toBeInTheDocument();
    // Anchor element exists in the DOM but with no href attribute.
    const anchor = container.querySelector('.species-detail-description-credit a');
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute('href')).toBeNull();
  });

  it('wraps the rendered HTML in a section.species-detail-description', () => {
    const { container } = render(
      <SpeciesDescription
        descriptionBody="<p>Body.</p>"
        descriptionAttributionUrl="https://en.wikipedia.org/wiki/X"
      />,
    );
    const section = container.querySelector('section.species-detail-description');
    expect(section).not.toBeNull();
  });
});
