import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FamilySilhouette } from '@bird-watch/shared-types';
import { AttributionModal } from './AttributionModal.js';

/**
 * AttributionModal tests (#250).
 *
 * jsdom's <dialog> implementation predates the spec's `showModal()` and
 * top-layer behaviour, so we monkey-patch the methods on
 * HTMLDialogElement.prototype before each test. The polyfill mirrors the
 * showModal/close lifecycle: `open` attribute is added/removed and a
 * native `close` event is dispatched on close. Keeps the production
 * component free of jsdom-aware branching.
 */
function patchDialog() {
  if (typeof HTMLDialogElement === 'undefined') return;
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown> & {
    showModal?: () => void;
    close?: () => void;
    open?: boolean;
  };
  // Idempotent: tag the patched function so re-imports across tests
  // don't double-patch (close() event would fire twice).
  if ((proto.showModal as unknown as { __patched?: boolean } | undefined)?.__patched) {
    return;
  }
  const showModal = function (this: HTMLDialogElement) {
    (this as unknown as { open: boolean }).open = true;
    this.setAttribute('open', '');
  };
  const close = function (this: HTMLDialogElement) {
    (this as unknown as { open: boolean }).open = false;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  Object.defineProperty(showModal, '__patched', { value: true });
  proto.showModal = showModal as () => void;
  proto.close = close as () => void;
}

patchDialog();

const SILHOUETTES: FamilySilhouette[] = [
  {
    familyCode: 'tyrannidae',
    color: '#C77A2E',
    svgData: 'M0 0L1 1Z',
    source: 'https://www.phylopic.org/images/abc-123/tyrannus',
    license: 'CC0-1.0',
    commonName: 'Tyrant Flycatchers',
    creator: 'A. Phylopic Author',
  },
  {
    familyCode: 'ardeidae',
    color: '#3F6E8C',
    svgData: 'M0 0L1 1Z',
    source: 'https://www.phylopic.org/images/def-456/ardea',
    license: 'CC-BY-SA-3.0',
    commonName: 'Herons',
    creator: 'B. Phylopic Author',
  },
  {
    familyCode: 'cuculidae',
    color: '#5B7F4A',
    svgData: 'M0 0L1 1Z',
    source: 'https://www.phylopic.org/images/ghi-789/coccyzus',
    license: 'CC-BY-3.0',
    commonName: 'Cuckoos',
    // creator IS NULL — render the row but omit the "by <creator>" prefix.
    creator: null,
  },
];

describe('AttributionModal', () => {
  it('renders a Credits trigger button', () => {
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    expect(screen.getByRole('button', { name: /credits/i })).toBeInTheDocument();
  });

  it('does not render the dialog content visibly when closed', () => {
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    // The <dialog> exists in the DOM but reports open=false.
    const dialog = document.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.hasAttribute('open')).toBe(false);
  });

  it('opens when the trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    const dialog = document.querySelector('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
  });

  it('renders the modal title as an <h2>', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    expect(screen.getByRole('heading', { level: 2, name: /credits/i })).toBeInTheDocument();
  });

  it('renders four sections, each with an <h3> heading', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    // eBird, Family Silhouettes (Phylopic), Map Tiles (OSM/OpenFreeMap),
    // Privacy (PostHog disclosure — issue #357 task 7).
    expect(screen.getByRole('heading', { level: 3, name: /bird sightings data/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /family silhouettes/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /map tiles/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /privacy/i })).toBeInTheDocument();
  });

  it('renders a Privacy section disclosing PostHog analytics + DNT respect', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    // The section follows the existing <h3> idiom (Bird Sightings Data,
    // Family Silhouettes, Photos conditional, Map Tiles).  Privacy is the
    // new final section.
    const heading = screen.getByRole('heading', { level: 3, name: /privacy/i });
    expect(heading).toBeInTheDocument();
    // Verbatim copy from the issue: discloses PostHog as the analytics
    // vendor + DNT compliance + no session recordings / personal data.
    expect(
      screen.getByText(/usage analytics via posthog/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/respects do not track/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no session recordings or personal data collected/i),
    ).toBeInTheDocument();
  });

  it('renders an eBird credit + link in the Bird Sightings section', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    const ebirdLink = screen.getByRole('link', { name: /eBird/i });
    expect(ebirdLink).toHaveAttribute('href', 'https://ebird.org');
    expect(ebirdLink).toHaveAttribute('target', '_blank');
    expect(ebirdLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders OSM and OpenFreeMap credits + links in the Map Tiles section', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    const osmLink = screen.getByRole('link', { name: /openstreetmap/i });
    expect(osmLink).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    expect(osmLink).toHaveAttribute('target', '_blank');
    expect(osmLink).toHaveAttribute('rel', 'noopener noreferrer');
    const ofmLink = screen.getByRole('link', { name: /openfreemap/i });
    expect(ofmLink).toHaveAttribute('href', 'https://openfreemap.org');
    expect(ofmLink).toHaveAttribute('target', '_blank');
    expect(ofmLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders one Phylopic row per silhouette with a non-null source', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    const items = screen.getAllByTestId('attribution-phylopic-row');
    expect(items).toHaveLength(SILHOUETTES.length);
  });

  it('renders the creator name and source link for a row with creator + source', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    // The first row in SILHOUETTES is tyrannidae with a creator.
    const rows = screen.getAllByTestId('attribution-phylopic-row');
    const tyr = rows[0]!;
    expect(within(tyr).getByText(/A. Phylopic Author/i)).toBeInTheDocument();
    const phylopicLink = within(tyr).getByRole('link', { name: /tyrant flycatchers|phylopic/i });
    expect(phylopicLink).toHaveAttribute('href', 'https://www.phylopic.org/images/abc-123/tyrannus');
    expect(phylopicLink).toHaveAttribute('target', '_blank');
    expect(phylopicLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('omits the "by <creator>" prefix when creator is null but still renders the source link', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    const rows = screen.getAllByTestId('attribution-phylopic-row');
    // Cuckoos is the third silhouette, with creator: null.
    const cuckoo = rows[2]!;
    // The literal string "by " (a creator preamble) must not appear in this row.
    expect(within(cuckoo).queryByText(/^by\s/i)).toBeNull();
    // But the Phylopic image-page link is still present.
    const link = within(cuckoo).getByRole('link', { name: /cuckoos|phylopic/i });
    expect(link).toHaveAttribute('href', 'https://www.phylopic.org/images/ghi-789/coccyzus');
  });

  it('renders the license short identifier as a link to the matching CC URL', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    const rows = screen.getAllByTestId('attribution-phylopic-row');
    // Expected pairs:
    //   tyrannidae   -> CC0-1.0       -> https://creativecommons.org/publicdomain/zero/1.0/
    //   ardeidae     -> CC-BY-SA-3.0  -> https://creativecommons.org/licenses/by-sa/3.0/
    //   cuculidae    -> CC-BY-3.0     -> https://creativecommons.org/licenses/by/3.0/
    const tyrLicense = within(rows[0]!).getByRole('link', { name: /CC0-1\.0/i });
    expect(tyrLicense).toHaveAttribute('href', 'https://creativecommons.org/publicdomain/zero/1.0/');
    const ardLicense = within(rows[1]!).getByRole('link', { name: /CC-BY-SA-3\.0/i });
    expect(ardLicense).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/3.0/');
    const cucLicense = within(rows[2]!).getByRole('link', { name: /CC-BY-3\.0/i });
    expect(cucLicense).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/3.0/');
    // All license links carry the same noopener noreferrer + _blank contract.
    for (const link of [tyrLicense, ardLicense, cucLicense]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('skips silhouettes with a null source (no Phylopic data → nothing to attribute)', async () => {
    const user = userEvent.setup();
    const noPhylopic: FamilySilhouette[] = [
      {
        familyCode: 'fallback',
        color: '#888',
        svgData: null,
        source: null,
        license: null,
        commonName: null,
        creator: null,
      },
      ...SILHOUETTES,
    ];
    render(<AttributionModal silhouettes={noPhylopic} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    // Only the three rows with non-null sources should be rendered.
    const items = screen.getAllByTestId('attribution-phylopic-row');
    expect(items).toHaveLength(3);
  });

  it('shows a no-attributions message in the Phylopic section when silhouettes is empty', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={[]} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    // eBird + OSM sections render unconditionally; only the Phylopic
    // section degrades to the "no attributions" message. Default props
    // give loading=false, error=null — this is the fetch-succeeded-but-
    // empty branch, not a loading state.
    expect(screen.getByText(/no silhouette attributions available/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /bird sightings data/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /map tiles/i })).toBeInTheDocument();
  });

  it('renders the no-attributions message when loading=false, error=null, and phylopicRows=[] (only fallback rows in payload)', async () => {
    const user = userEvent.setup();
    // The migration-1700000018000 fallback rows have source=null AND
    // creator=null. After phylopicRows filtering they are dropped, so
    // the section renders the empty-attribution message even though the
    // input array is non-empty.
    const fallbackOnly: FamilySilhouette[] = [
      {
        familyCode: 'fallback-a',
        color: '#777',
        svgData: null,
        source: null,
        license: null,
        commonName: null,
        creator: null,
      },
      {
        familyCode: 'fallback-b',
        color: '#888',
        svgData: null,
        source: null,
        license: null,
        commonName: null,
        creator: null,
      },
    ];
    render(<AttributionModal silhouettes={fallbackOnly} loading={false} error={null} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    expect(screen.getByText(/no silhouette attributions available/i)).toBeInTheDocument();
    // Defensive: the loading and error copies must NOT appear in this branch.
    expect(screen.queryByText(/loading silhouette attributions/i)).toBeNull();
    expect(screen.queryByText(/couldn't load silhouette attributions/i)).toBeNull();
    // No phylopic rows render in this branch.
    expect(screen.queryAllByTestId('attribution-phylopic-row')).toHaveLength(0);
  });

  it('returns focus to the trigger when the modal closes', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    const trigger = screen.getByRole('button', { name: /credits/i });
    await user.click(trigger);
    // Click the close button.
    const close = screen.getByRole('button', { name: /close/i });
    await user.click(close);
    // After close, focus returns to the trigger.
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when the close button is clicked', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    const dialog = document.querySelector('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(dialog?.hasAttribute('open')).toBe(false);
  });

  it('returns focus to the trigger when the dialog dispatches its close event (Escape path)', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    const trigger = screen.getByRole('button', { name: /credits/i });
    await user.click(trigger);
    const dialog = document.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    // Production contract: native <dialog> closes on Escape and emits a
    // 'close' event. jsdom doesn't synthesise the Escape→close flow, so
    // we dispatch the event directly to verify the close handler returns
    // focus to the trigger. The component listens for 'close' (the native
    // event the browser fires after Escape OR backdrop close OR an
    // explicit close()).
    dialog.dispatchEvent(new Event('close'));
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when the user clicks the dialog backdrop', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.hasAttribute('open')).toBe(true);
    // The backdrop-click handler matches `event.target === dialog`. jsdom
    // can't synthesise a real backdrop click, but firing a click event with
    // the dialog itself as the target reproduces the production code path.
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'target', { value: dialog });
    dialog.dispatchEvent(evt);
    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('does NOT close when the user clicks inside the dialog content', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    // Click an inner element — a heading is convenient and unambiguously
    // not the dialog itself.
    const heading = within(dialog).getByRole('heading', { level: 2 });
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'target', { value: heading });
    dialog.dispatchEvent(evt);
    expect(dialog.hasAttribute('open')).toBe(true);
  });

  // Verify the LICENSE_URLS constant doesn't silently drop unknown licenses.
  // If a row's license isn't in the map, we still render the short identifier
  // as plain text rather than a broken link — fail-soft on Phylopic curation
  // adding a new license short identifier the modal hasn't been taught yet.
  it('renders an unknown license short identifier as plain text (no link)', async () => {
    const user = userEvent.setup();
    const exoticLicense: FamilySilhouette[] = [
      {
        familyCode: 'corvidae',
        color: '#222',
        svgData: 'M0 0Z',
        source: 'https://www.phylopic.org/images/jkl-000/corvus',
        license: 'CC-BY-7.0', // does not exist in LICENSE_URLS
        commonName: 'Crows',
        creator: 'C. Author',
      },
    ];
    render(<AttributionModal silhouettes={exoticLicense} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    const rows = screen.getAllByTestId('attribution-phylopic-row');
    // The license string is in the row...
    expect(within(rows[0]!).getByText(/CC-BY-7\.0/)).toBeInTheDocument();
    // ...but it's not linked.
    const links = within(rows[0]!).getAllByRole('link');
    for (const link of links) {
      expect(link.getAttribute('href')).not.toMatch(/creativecommons\.org/);
    }
  });

  /*
   * Loading / error / NULL-source polish (issue #274).
   *
   * Bot review on PR #272 surfaced two follow-ups:
   *  - The modal didn't surface `useSilhouettes`'s loading/error state,
   *    so SR users opening Credits during a slow `/api/silhouettes`
   *    response heard "Family Silhouettes" + nothing.
   *  - Phylopic rows with creator !== null AND source === null rendered
   *    `<a href="#">` for the labelName — looked like a working link
   *    but scrolled to top of page on click.
   *
   * The three tests below pin both fixes.
   */

  it('renders a user-facing loading message in the Phylopic section when loading=true', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={[]} loading={true} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    // Status (aria-live) text replaces the empty list.
    expect(
      screen.getByText(/loading silhouette attributions/i),
    ).toBeInTheDocument();
    // Bird sightings + Map tiles sections still render unconditionally.
    expect(
      screen.getByRole('heading', { level: 3, name: /bird sightings data/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: /map tiles/i }),
    ).toBeInTheDocument();
  });

  it('renders a user-facing error message in the Phylopic section when error is set (raw message hidden)', async () => {
    const user = userEvent.setup();
    const err = new Error('pool exhausted');
    render(<AttributionModal silhouettes={[]} error={err} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    // User-facing copy is generic; raw error string MUST NOT leak.
    expect(
      screen.getByText(/couldn't load silhouette attributions/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/pool exhausted/)).toBeNull();
    // Bird sightings + Map tiles sections still render.
    expect(
      screen.getByRole('heading', { level: 3, name: /bird sightings data/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: /map tiles/i }),
    ).toBeInTheDocument();
  });

  it('error state takes precedence over loading state', async () => {
    const user = userEvent.setup();
    render(
      <AttributionModal
        silhouettes={[]}
        loading={true}
        error={new Error('x')}
      />,
    );
    await user.click(screen.getByRole('button', { name: /credits/i }));
    expect(
      screen.getByText(/couldn't load silhouette attributions/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/loading silhouette attributions/i),
    ).toBeNull();
  });

  it('renders a creator-only row (source=null, creator!=null) as plain text — no broken anchor', async () => {
    const user = userEvent.setup();
    const creatorOnly: FamilySilhouette[] = [
      {
        familyCode: 'foobar',
        color: '#444',
        svgData: null,
        source: null, // ← the bug: previously rendered <a href="#">
        license: 'CC-BY-3.0',
        commonName: 'Foo Birds',
        creator: 'Jane Doe',
      },
    ];
    render(<AttributionModal silhouettes={creatorOnly} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    const rows = screen.getAllByTestId('attribution-phylopic-row');
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // The labelName ("Foo Birds") is rendered as plain text — must NOT be a link.
    expect(within(row).getByText('Foo Birds')).toBeInTheDocument();
    // No <a> in this row should carry an empty / "#" href.
    const anchors = within(row).queryAllByRole('link');
    for (const a of anchors) {
      const href = a.getAttribute('href') ?? '';
      expect(href).not.toBe('#');
      expect(href).not.toBe('');
    }
    // The labelName itself should NOT have been wrapped in an anchor.
    const fooLink = within(row).queryByRole('link', { name: /foo birds/i });
    expect(fooLink).toBeNull();
    // Creator credit still appears.
    expect(within(row).getByText(/Jane Doe/)).toBeInTheDocument();
  });

  // Smoke test: the trigger calls a controlled onOpenChange callback if
  // provided (lets App.tsx wire telemetry / focus instrumentation if it
  // ever wants to without a refactor).
  it('forwards open-state changes to an optional onOpenChange prop', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  /*
   * iNaturalist photo credit (issue #327 task-11).
   *
   * SpeciesDetailSurface (#327 task-10) renders an iNat-mirrored photo
   * when SpeciesMeta carries a non-null `photoUrl`. Per CC license terms
   * (specifically iNat's CC-BY / CC-BY-SA / CC-BY-NC variants on
   * uploaded observations), the photographer must be credited and the
   * license URL surfaced on the same page as the photo. We surface that
   * credit in the AttributionModal — already the canonical credits
   * surface — so the prominence requirement is met without crowding
   * the SpeciesDetailSurface itself.
   *
   * Render contract:
   *   - Both `photoAttribution` AND `photoLicense` present → render the
   *     "Photos" section. The section sits below Family Silhouettes, above
   *     Map Tiles, mirroring the existing CC-credit pattern (label by
   *     creator — license link).
   *   - Either prop absent (or both) → omit the section entirely. No
   *     empty heading; no "no photo credit" placeholder. Silently
   *     dropping is correct because not every species has a photo.
   *   - Unknown license code → render the code as plain text rather than
   *     a broken link (mirrors the unknown-Phylopic-license behavior
   *     above).
   */

  it('renders a Photos section when photoAttribution + photoLicense are both present', async () => {
    const user = userEvent.setup();
    render(
      <AttributionModal
        silhouettes={SILHOUETTES}
        photoAttribution="Jane Photographer"
        photoLicense="cc-by"
      />,
    );
    await user.click(screen.getByRole('button', { name: /credits/i }));
    // Section heading appears as <h3> (consistent with the other sections).
    expect(
      screen.getByRole('heading', { level: 3, name: /^photos$/i }),
    ).toBeInTheDocument();
  });

  it('renders the photographer name + license link in the Photos section', async () => {
    const user = userEvent.setup();
    render(
      <AttributionModal
        silhouettes={SILHOUETTES}
        photoAttribution="Jane Photographer"
        photoLicense="cc-by"
      />,
    );
    await user.click(screen.getByRole('button', { name: /credits/i }));
    const photosHeading = screen.getByRole('heading', { level: 3, name: /^photos$/i });
    const section = photosHeading.closest('section');
    expect(section).not.toBeNull();
    // Photographer attribution surfaces.
    expect(within(section!).getByText(/Jane Photographer/)).toBeInTheDocument();
    // License is rendered as a link to the matching CC URL.
    const licenseLink = within(section!).getByRole('link', { name: /CC BY 4\.0/i });
    expect(licenseLink).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
    // Same noopener-noreferrer + _blank contract as every other modal link.
    expect(licenseLink).toHaveAttribute('target', '_blank');
    expect(licenseLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('omits the Photos section when both photoAttribution and photoLicense are absent', async () => {
    const user = userEvent.setup();
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    await user.click(screen.getByRole('button', { name: /credits/i }));
    // No <h3>Photos</h3> in the modal.
    expect(
      screen.queryByRole('heading', { level: 3, name: /^photos$/i }),
    ).toBeNull();
  });

  it('omits the Photos section when only photoAttribution is present (no license)', async () => {
    const user = userEvent.setup();
    render(
      <AttributionModal
        silhouettes={SILHOUETTES}
        photoAttribution="Jane Photographer"
      />,
    );
    await user.click(screen.getByRole('button', { name: /credits/i }));
    expect(
      screen.queryByRole('heading', { level: 3, name: /^photos$/i }),
    ).toBeNull();
  });

  it('omits the Photos section when only photoLicense is present (no attribution)', async () => {
    const user = userEvent.setup();
    render(
      <AttributionModal
        silhouettes={SILHOUETTES}
        photoLicense="cc-by"
      />,
    );
    await user.click(screen.getByRole('button', { name: /credits/i }));
    expect(
      screen.queryByRole('heading', { level: 3, name: /^photos$/i }),
    ).toBeNull();
  });

  it('renders an unknown photo license code as plain text (no link)', async () => {
    const user = userEvent.setup();
    render(
      <AttributionModal
        silhouettes={SILHOUETTES}
        photoAttribution="Jane Photographer"
        photoLicense="cc-mystery-9.9"
      />,
    );
    await user.click(screen.getByRole('button', { name: /credits/i }));
    const photosHeading = screen.getByRole('heading', { level: 3, name: /^photos$/i });
    const section = photosHeading.closest('section');
    expect(section).not.toBeNull();
    // Unknown identifier surfaces as plain text — verify by walking the
    // text content; getByText alone on a string fragment may partial-match.
    expect(section!.textContent).toMatch(/cc-mystery-9\.9/i);
    // ...and there's no anchor in the section pointing at creativecommons.
    const ccLinks = within(section!).queryAllByRole('link');
    for (const link of ccLinks) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/creativecommons\.org/);
    }
  });
});
