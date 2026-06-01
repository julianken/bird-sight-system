import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FamilySilhouette } from '@bird-watch/shared-types';
import { AttributionModal, type AttributionModalProps } from './AttributionModal.js';

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

/**
 * #830 item D: AttributionModal no longer renders its own trigger button — it
 * is controlled via the `open` prop, opened by the AppHeader ⓘ button. These
 * tests drive it through a small harness that owns `open` state and exposes a
 * real "Open credits" opener button, so (a) opening is a genuine click on a
 * focusable element and (b) focus-return on close has a real restore target
 * (mirroring the production AppHeader trigger). The harness also threads
 * `onOpenChange` so the dialog's native close flips `open` back to false.
 */
type HarnessProps = Omit<AttributionModalProps, 'open' | 'onOpenChange'> & {
  onOpenChange?: (open: boolean) => void;
};
function ControlledModalHarness({ onOpenChange, ...modalProps }: HarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open credits
      </button>
      <AttributionModal
        {...modalProps}
        open={open}
        onOpenChange={next => {
          setOpen(next);
          onOpenChange?.(next);
        }}
      />
    </>
  );
}

/**
 * Render the harness and open the dialog via the opener button. Returns the
 * userEvent instance and the opener element (the focus-return target).
 */
async function openModal(props: HarnessProps = { silhouettes: [] }) {
  const user = userEvent.setup();
  render(<ControlledModalHarness {...props} />);
  const opener = screen.getByRole('button', { name: /open credits/i });
  await user.click(opener);
  return { user, opener };
}

const SILHOUETTES: FamilySilhouette[] = [
  {
    familyCode: 'tyrannidae',
    color: '#C77A2E',
    colorDark: '#C77A2E',
    svgData: 'M0 0L1 1Z',
    svgUrl: null,
    source: 'https://www.phylopic.org/images/abc-123/tyrannus',
    license: 'CC0-1.0',
    commonName: 'Tyrant Flycatchers',
    creator: 'A. Phylopic Author',
  },
  {
    familyCode: 'ardeidae',
    color: '#3F6E8C',
    colorDark: '#3F6E8C',
    svgData: 'M0 0L1 1Z',
    svgUrl: null,
    source: 'https://www.phylopic.org/images/def-456/ardea',
    license: 'CC-BY-SA-3.0',
    commonName: 'Herons',
    creator: 'B. Phylopic Author',
  },
  {
    familyCode: 'cuculidae',
    color: '#5B7F4A',
    colorDark: '#5B7F4A',
    svgData: 'M0 0L1 1Z',
    svgUrl: null,
    source: 'https://www.phylopic.org/images/ghi-789/coccyzus',
    license: 'CC-BY-3.0',
    commonName: 'Cuckoos',
    // creator IS NULL — render the row but omit the "by <creator>" prefix.
    creator: null,
  },
];

describe('AttributionModal', () => {
  it('does NOT render an internal .attribution-trigger button (controlled-open, #830 item D)', () => {
    render(<AttributionModal silhouettes={SILHOUETTES} />);
    // The modal is controlled via the `open` prop now; its old internal trigger
    // is gone. The only "Credits" affordance is the AppHeader ⓘ button.
    expect(document.querySelector('.attribution-trigger')).toBeNull();
    expect(screen.queryByRole('button', { name: /^credits$/i })).toBeNull();
  });

  it('does not render the dialog content visibly when open is false', () => {
    render(<AttributionModal silhouettes={SILHOUETTES} open={false} />);
    // The <dialog> exists in the DOM but reports open=false.
    const dialog = document.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.hasAttribute('open')).toBe(false);
  });

  it('opens the dialog when the open prop is true', () => {
    render(<AttributionModal silhouettes={SILHOUETTES} open={true} />);
    const dialog = document.querySelector('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
  });

  it('closes the dialog when the open prop flips back to false', () => {
    const { rerender } = render(<AttributionModal silhouettes={SILHOUETTES} open={true} />);
    const dialog = document.querySelector('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
    rerender(<AttributionModal silhouettes={SILHOUETTES} open={false} />);
    expect(dialog?.hasAttribute('open')).toBe(false);
  });

  it('opens when the opener flips the controlled state', async () => {
    await openModal({ silhouettes: SILHOUETTES });
    const dialog = document.querySelector('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
  });

  it('renders the modal title as an <h2>', async () => {
    await openModal({ silhouettes: SILHOUETTES });
    expect(screen.getByRole('heading', { level: 2, name: /credits/i })).toBeInTheDocument();
  });

  it('renders five sections (without optional Photos), each with an <h3> heading', async () => {
    await openModal({ silhouettes: SILHOUETTES });
    // eBird, Family Silhouettes (Phylopic), Species descriptions
    // (Wikipedia — #373), Map Tiles (OSM/OpenFreeMap), Privacy
    // (Clarity disclosure — issue #657). Photos is optional and
    // not rendered without photoAttribution + photoLicense.
    expect(screen.getByRole('heading', { level: 3, name: /bird sightings data/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /family silhouettes/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /species descriptions/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /map tiles/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /privacy/i })).toBeInTheDocument();
  });

  // Issue #373 task 4: catch-all "Species descriptions" section sits
  // between Photos (optional) and Map Tiles. Renders unconditionally —
  // descriptions exist for >85% of species and the inline per-article
  // credit on SpeciesDetailSurface satisfies the per-work attribution
  // requirement, so the modal-level credit is the catch-all.
  it('renders a Species descriptions section disclosing Wikipedia + CC BY-SA', async () => {
    await openModal({ silhouettes: SILHOUETTES });
    const heading = screen.getByRole('heading', { level: 3, name: /species descriptions/i });
    expect(heading).toBeInTheDocument();
    const section = heading.closest('section');
    expect(section).not.toBeNull();
    // Disclosure copy must surface (a) Wikipedia as the source and
    // (b) CC BY-SA as the license + (c) the per-species panel link
    // pointer (the inline "From Wikipedia, CC BY-SA" credit on
    // SpeciesDescription is the per-article attribution).
    expect(section!.textContent).toMatch(/Wikipedia/i);
    expect(section!.textContent).toMatch(/CC BY-SA/i);
    expect(section!.textContent).toMatch(/per-article|species panel/i);
  });

  it('renders the Species descriptions section between Photos and Map Tiles in DOM order', async () => {
    await openModal({
      silhouettes: SILHOUETTES,
      photoAttribution: 'Jane Photographer',
      photoLicense: 'cc-by',
    });
    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map(h => h.textContent?.toLowerCase() ?? '');
    const photosIdx = headings.findIndex(h => h.includes('photos'));
    const descriptionsIdx = headings.findIndex(h => h.includes('species descriptions'));
    const mapIdx = headings.findIndex(h => h.includes('map tiles'));
    expect(photosIdx).toBeGreaterThan(-1);
    expect(descriptionsIdx).toBeGreaterThan(-1);
    expect(mapIdx).toBeGreaterThan(-1);
    // Photos < Species descriptions < Map Tiles in DOM order.
    expect(photosIdx).toBeLessThan(descriptionsIdx);
    expect(descriptionsIdx).toBeLessThan(mapIdx);
  });

  it('renders the Species descriptions section even with Photos absent (sits between Family Silhouettes and Map Tiles)', async () => {
    await openModal({ silhouettes: SILHOUETTES });
    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map(h => h.textContent?.toLowerCase() ?? '');
    const familyIdx = headings.findIndex(h => h.includes('family silhouettes'));
    const descriptionsIdx = headings.findIndex(h => h.includes('species descriptions'));
    const mapIdx = headings.findIndex(h => h.includes('map tiles'));
    expect(familyIdx).toBeGreaterThan(-1);
    expect(descriptionsIdx).toBeGreaterThan(-1);
    expect(mapIdx).toBeGreaterThan(-1);
    // No Photos heading in this branch.
    expect(headings.findIndex(h => h.includes('photos'))).toBe(-1);
    // Family Silhouettes < Species descriptions < Map Tiles.
    expect(familyIdx).toBeLessThan(descriptionsIdx);
    expect(descriptionsIdx).toBeLessThan(mapIdx);
  });

  it('renders a Privacy section disclosing Clarity analytics + default masking', async () => {
    await openModal({ silhouettes: SILHOUETTES });
    // The section follows the existing <h3> idiom (Bird Sightings Data,
    // Family Silhouettes, Photos conditional, Map Tiles).  Privacy is the
    // new final section.
    const heading = screen.getByRole('heading', { level: 3, name: /privacy/i });
    expect(heading).toBeInTheDocument();
    // Disclosure names Microsoft Clarity as the analytics vendor, calls
    // out session replay + heatmaps (Clarity's default product), and
    // states the default-mask posture for sensitive content.
    expect(
      screen.getByText(/usage analytics via microsoft clarity/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/session replay and heatmaps/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/sensitive content.*masked by default/i),
    ).toBeInTheDocument();
  });

  it('renders an eBird credit + link in the Bird Sightings section', async () => {
    await openModal({ silhouettes: SILHOUETTES });
    const ebirdLink = screen.getByRole('link', { name: /eBird/i });
    expect(ebirdLink).toHaveAttribute('href', 'https://ebird.org');
    expect(ebirdLink).toHaveAttribute('target', '_blank');
    expect(ebirdLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders OSM, OpenMapTiles, and OpenFreeMap credits + links in the Map Tiles section', async () => {
    await openModal({ silhouettes: SILHOUETTES });
    const osmLink = screen.getByRole('link', { name: /openstreetmap/i });
    expect(osmLink).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    expect(osmLink).toHaveAttribute('target', '_blank');
    expect(osmLink).toHaveAttribute('rel', 'noopener noreferrer');
    // Item C (#830): OpenFreeMap's required attribution is
    // "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" — OpenMapTiles is
    // mandatory and was previously omitted (a compliance gap).
    const omtLink = screen.getByRole('link', { name: /openmaptiles/i });
    expect(omtLink).toHaveAttribute('href', 'https://openmaptiles.org');
    expect(omtLink).toHaveAttribute('target', '_blank');
    expect(omtLink).toHaveAttribute('rel', 'noopener noreferrer');
    const ofmLink = screen.getByRole('link', { name: /openfreemap/i });
    expect(ofmLink).toHaveAttribute('href', 'https://openfreemap.org');
    expect(ofmLink).toHaveAttribute('target', '_blank');
    expect(ofmLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders one Phylopic row per silhouette with a non-null source', async () => {
    await openModal({ silhouettes: SILHOUETTES });
    const items = screen.getAllByTestId('attribution-phylopic-row');
    expect(items).toHaveLength(SILHOUETTES.length);
  });

  it('renders the creator name and source link for a row with creator + source', async () => {
    await openModal({ silhouettes: SILHOUETTES });
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
    await openModal({ silhouettes: SILHOUETTES });
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
    await openModal({ silhouettes: SILHOUETTES });
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
    const noPhylopic: FamilySilhouette[] = [
      {
        familyCode: 'fallback',
        color: '#888',
        colorDark: '#888',
        svgData: null,
        svgUrl: null,
        source: null,
        license: null,
        commonName: null,
        creator: null,
      },
      ...SILHOUETTES,
    ];
    await openModal({ silhouettes: noPhylopic });
    // Only the three rows with non-null sources should be rendered.
    const items = screen.getAllByTestId('attribution-phylopic-row');
    expect(items).toHaveLength(3);
  });

  it('shows a no-attributions message in the Phylopic section when silhouettes is empty', async () => {
    await openModal({ silhouettes: [] });
    // eBird + OSM sections render unconditionally; only the Phylopic
    // section degrades to the "no attributions" message. Default props
    // give loading=false, error=null — this is the fetch-succeeded-but-
    // empty branch, not a loading state.
    expect(screen.getByText(/no silhouette attributions available/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /bird sightings data/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /map tiles/i })).toBeInTheDocument();
  });

  it('renders the no-attributions message when loading=false, error=null, and phylopicRows=[] (only fallback rows in payload)', async () => {
    // The migration-1700000018000 fallback rows have source=null AND
    // creator=null. After phylopicRows filtering they are dropped, so
    // the section renders the empty-attribution message even though the
    // input array is non-empty.
    const fallbackOnly: FamilySilhouette[] = [
      {
        familyCode: 'fallback-a',
        color: '#777',
        colorDark: '#777',
        svgData: null,
        svgUrl: null,
        source: null,
        license: null,
        commonName: null,
        creator: null,
      },
      {
        familyCode: 'fallback-b',
        color: '#888',
        colorDark: '#888',
        svgData: null,
        svgUrl: null,
        source: null,
        license: null,
        commonName: null,
        creator: null,
      },
    ];
    await openModal({ silhouettes: fallbackOnly, loading: false, error: null });
    expect(screen.getByText(/no silhouette attributions available/i)).toBeInTheDocument();
    // Defensive: the loading and error copies must NOT appear in this branch.
    expect(screen.queryByText(/loading silhouette attributions/i)).toBeNull();
    expect(screen.queryByText(/couldn't load silhouette attributions/i)).toBeNull();
    // No phylopic rows render in this branch.
    expect(screen.queryAllByTestId('attribution-phylopic-row')).toHaveLength(0);
  });

  it('returns focus to the opener when the modal closes', async () => {
    // #830 item D: the restore target is the element focused at open time —
    // here the harness opener (the production equivalent is the AppHeader ⓘ).
    const { user, opener } = await openModal({ silhouettes: SILHOUETTES });
    const close = screen.getByRole('button', { name: /close/i });
    await user.click(close);
    expect(document.activeElement).toBe(opener);
  });

  it('closes when the close button is clicked', async () => {
    const { user } = await openModal({ silhouettes: SILHOUETTES });
    const dialog = document.querySelector('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(dialog?.hasAttribute('open')).toBe(false);
  });

  it('returns focus to the opener when the dialog dispatches its close event (Escape path)', async () => {
    const { opener } = await openModal({ silhouettes: SILHOUETTES });
    const dialog = document.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    // Production contract: native <dialog> closes on Escape and emits a
    // 'close' event. jsdom doesn't synthesise the Escape→close flow, so
    // we dispatch the event directly to verify the close handler returns
    // focus to the opener. The component listens for 'close' (the native
    // event the browser fires after Escape OR backdrop close OR an
    // explicit close()).
    dialog.dispatchEvent(new Event('close'));
    expect(document.activeElement).toBe(opener);
  });

  it('closes when the user clicks the dialog backdrop', async () => {
    await openModal({ silhouettes: SILHOUETTES });
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
    await openModal({ silhouettes: SILHOUETTES });
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
    const exoticLicense: FamilySilhouette[] = [
      {
        familyCode: 'corvidae',
        color: '#222',
        colorDark: '#222',
        svgData: 'M0 0Z',
        svgUrl: null,
        source: 'https://www.phylopic.org/images/jkl-000/corvus',
        license: 'CC-BY-7.0', // does not exist in LICENSE_URLS
        commonName: 'Crows',
        creator: 'C. Author',
      },
    ];
    await openModal({ silhouettes: exoticLicense });
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
    await openModal({ silhouettes: [], loading: true });
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
    const err = new Error('pool exhausted');
    await openModal({ silhouettes: [], error: err });
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
    await openModal({ silhouettes: [], loading: true, error: new Error('x') });
    expect(
      screen.getByText(/couldn't load silhouette attributions/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/loading silhouette attributions/i),
    ).toBeNull();
  });

  it('renders a creator-only row (source=null, creator!=null) as plain text — no broken anchor', async () => {
    const creatorOnly: FamilySilhouette[] = [
      {
        familyCode: 'foobar',
        color: '#444',
        colorDark: '#444',
        svgData: null,
        svgUrl: null,
        source: null, // ← the bug: previously rendered <a href="#">
        license: 'CC-BY-3.0',
        commonName: 'Foo Birds',
        creator: 'Jane Doe',
      },
    ];
    await openModal({ silhouettes: creatorOnly });
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

  // Smoke test: opening (via the controlled `open` prop) and closing both fire
  // the onOpenChange callback. App.tsx wires this to setAttributionOpen so the
  // native close (Escape / backdrop / close button) flips the controlled state.
  it('forwards open-state changes to an optional onOpenChange prop', async () => {
    const onOpenChange = vi.fn();
    const { user } = await openModal({ silhouettes: SILHOUETTES, onOpenChange });
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
    await openModal({
      silhouettes: SILHOUETTES,
      photoAttribution: 'Jane Photographer',
      photoLicense: 'cc-by',
    });
    // Section heading appears as <h3> (consistent with the other sections).
    expect(
      screen.getByRole('heading', { level: 3, name: /^photos$/i }),
    ).toBeInTheDocument();
  });

  it('renders the photographer name + license link in the Photos section', async () => {
    await openModal({
      silhouettes: SILHOUETTES,
      photoAttribution: 'Jane Photographer',
      photoLicense: 'cc-by',
    });
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
    await openModal({ silhouettes: SILHOUETTES });
    // No <h3>Photos</h3> in the modal.
    expect(
      screen.queryByRole('heading', { level: 3, name: /^photos$/i }),
    ).toBeNull();
  });

  it('omits the Photos section when only photoAttribution is present (no license)', async () => {
    await openModal({ silhouettes: SILHOUETTES, photoAttribution: 'Jane Photographer' });
    expect(
      screen.queryByRole('heading', { level: 3, name: /^photos$/i }),
    ).toBeNull();
  });

  it('omits the Photos section when only photoLicense is present (no attribution)', async () => {
    await openModal({ silhouettes: SILHOUETTES, photoLicense: 'cc-by' });
    expect(
      screen.queryByRole('heading', { level: 3, name: /^photos$/i }),
    ).toBeNull();
  });

  it('renders an unknown photo license code as plain text (no link)', async () => {
    await openModal({
      silhouettes: SILHOUETTES,
      photoAttribution: 'Jane Photographer',
      photoLicense: 'cc-mystery-9.9',
    });
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
