import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import { SpeciesDetailSurface } from './SpeciesDetailSurface.js';
import { ApiClient } from '../api/client.js';
import type { SpeciesMeta, FamilySilhouette } from '@bird-watch/shared-types';
import { __resetSilhouettesCache } from '../data/use-silhouettes.js';
import { __resetSpeciesDetailCache } from '../data/use-species-detail.js';
import { analytics } from '../analytics.js';
import { FAMILY_COLOR_FALLBACK } from '../data/family-color.js';

const VERMFLY: SpeciesMeta = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  // 'songbird' is a valid FamilyCode — required because Phase 4 routes
  // familyCode through <Photo> → <FamilySilhouette> → getFamilyChannel()
  // which only accepts the 7 predefined FamilyCode literals. 'tyrannidae'
  // was valid only for the pre-Phase-4 lookup path.
  familyCode: 'songbird',
  familyName: 'Tyrant Flycatchers',
  taxonOrder: 4400,
};

const VERMFLY_WITH_PHOTO: SpeciesMeta = {
  ...VERMFLY,
  photoUrl: 'https://photos.bird-maps.com/vermfly.jpg',
  photoAttribution: 'Jane Smith',
  photoLicense: 'CC-BY-4.0',
};

const TYRANNIDAE_SILHOUETTE: FamilySilhouette = {
  familyCode: 'songbird',
  color: '#C77A2E',
  colorDark: '#C77A2E',
  svgData: 'M0 0L1 1Z',
  svgUrl: null,
  source: 'https://www.phylopic.org/i/x',
  license: 'CC-BY-3.0',
  commonName: 'Tyrant Flycatchers',
  creator: 'Test Creator',
};

function makeClient(overrides: Partial<ApiClient>): ApiClient {
  return Object.assign(new ApiClient(), overrides);
}

describe('SpeciesDetailSurface', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    // Reset the module-level species detail cache so one test's resolved
    // species data cannot bleed into the next test's assertions.
    __resetSpeciesDetailCache();
  });

  it('renders common, scientific, and family names when data resolves', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(
      <SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
    );

    // #918 Restated-data decision: the identity block (B–D) shows the
    // scientific + family names once as IDENTITY; the taxonomy <dl> (F) restates
    // them as formal labeled REFERENCE data — by design (matches the mobile
    // field-guide entry page). So each text now appears in exactly TWO nodes:
    // the identity row and the taxonomy row. Scope to the identity block for the
    // identity-tagline assertion (and assert the count is 2, not de-duplicated).
    const identityBlock = container.querySelector('.detail-fg-identity') as HTMLElement;
    expect(identityBlock).not.toBeNull();
    const sci = within(identityBlock).getByText('Pyrocephalus rubinus');
    expect(sci.tagName).toBe('EM');
    expect(within(identityBlock).getByText('Tyrant Flycatchers')).toBeInTheDocument();
    // Restated, not de-duplicated: 2 nodes each (identity row + taxonomy row).
    expect(screen.getAllByText('Pyrocephalus rubinus')).toHaveLength(2);
    expect(screen.getAllByText('Tyrant Flycatchers')).toHaveLength(2);
  });

  // #918 — the taxonomy <dl> is the field-guide reference block. It must be a
  // real <dl> with three label→value rows (Scientific name / Family / eBird
  // taxonomic order) so the restated data is COVERED, not merely tolerated.
  it('renders a taxonomy <dl> with labeled Scientific-name, Family, and taxon-order rows', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(
      <SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
    );
    const dl = container.querySelector('dl.detail-fg-taxonomy') as HTMLElement;
    expect(dl).not.toBeNull();
    const rows = dl.querySelectorAll('.detail-fg-taxrow');
    expect(rows).toHaveLength(3);
    // Labels (dt) and the values they tie to (dd).
    const labels = Array.from(dl.querySelectorAll('dt')).map((el) => el.textContent);
    expect(labels).toEqual(['Scientific name', 'Family', 'eBird taxonomic order']);
    const tax = within(dl);
    // Scientific name restated in the dl (italic <em>) — the second of the 2 nodes.
    expect(tax.getByText('Pyrocephalus rubinus').tagName).toBe('EM');
    // Family restated in the dl.
    expect(tax.getByText('Tyrant Flycatchers')).toBeInTheDocument();
    // taxonOrder rendered as #4400.
    expect(tax.getByText('#4400')).toBeInTheDocument();
  });

  // #918 — the identity block carries the family dot (inline family-color bg +
  // aria-hidden) and the family-accent rule; both are field-guide structural
  // signals. The dot's inline background comes from resolveColor(familyCode).
  it('renders the family dot (inline color, aria-hidden) and the accent rule', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(
      <SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
    );
    const dot = container.querySelector('.detail-fg-family-dot') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    // Inline background resolved from the family color (#C77A2E in the fixture).
    // jsdom normalizes the hex to its rgb() form.
    expect(dot.style.background).toBe('rgb(199, 122, 46)');
    // The 3px family-accent rule carries the same inline color.
    const rule = container.querySelector('.detail-fg-rule') as HTMLElement;
    expect(rule).not.toBeNull();
    expect(rule).toHaveAttribute('aria-hidden', 'true');
    expect(rule.style.background).toBe('rgb(199, 122, 46)');
  });

  // #918 — the About section leads with an "About" eyebrow heading when a
  // description is present (the field-guide section divider).
  it('renders the "About" eyebrow heading when descriptionBody is present', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue({
        ...VERMFLY,
        descriptionBody: '<p>Body.</p>',
        descriptionAttributionUrl: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
      }),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(
      <SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />,
    );
    const eyebrow = await waitFor(() => {
      const el = container.querySelector('.detail-fg-about-eyebrow');
      if (!el) throw new Error('About eyebrow not yet rendered');
      return el;
    });
    expect(eyebrow.textContent).toBe('About');
  });

  it('shows loading state initially', () => {
    const client = makeClient({
      getSpecies: vi.fn().mockReturnValue(new Promise(() => {})),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    expect(screen.getByText('Loading species details…')).toBeInTheDocument();
  });

  it('shows error state on fetch failure', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockRejectedValue(new Error('boom')),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    await waitFor(() =>
      expect(screen.getByText('Could not load species details')).toBeInTheDocument()
    );
  });

  // eBird API ToU §3 attribution moved to the app-level AttributionModal
  // (#250) and is reachable from every view via the persistent footer in
  // App.tsx. SpeciesDetailSurface no longer carries a per-surface footer
  // — the loaded/loading/error footer assertions that lived here are now
  // covered by AttributionModal unit tests + the e2e attribution-modal spec.

  it('renders in-flow (no role=complementary, no close button)', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
    );
    // No complementary landmark — this is an in-flow surface, not a sidebar.
    expect(screen.queryByRole('complementary')).toBeNull();
    // No close button — user navigates away via the browser back button.
    expect(screen.queryByRole('button', { name: 'Close species details' })).toBeNull();
  });

  // ─── Photo rendering (issue #327 task-10) ─────────────────────────────
  //
  // The Read API LEFT-JOINs species_photos onto /api/species/:code (task-9)
  // and projects optional photoUrl/photoAttribution/photoLicense fields onto
  // SpeciesMeta. Frontend renders a <img> for the photo when present and
  // falls back to the existing Phylopic silhouette path on absence OR on
  // image-load error. Behavioral spec verbatim from issue #327 task-10.

  it('renders <img src={photoUrl} alt="X photo"> when photoUrl is present', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY_WITH_PHOTO),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    const photo = await screen.findByAltText('Vermilion Flycatcher photo');
    expect(photo.tagName).toBe('IMG');
    expect(photo).toHaveAttribute('src', 'https://photos.bird-maps.com/vermfly.jpg');
  });

  it('does not render the photo img when photoUrl is undefined/null', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
    );
    // No photo img — the silhouette is the only visual.
    expect(screen.queryByAltText('Vermilion Flycatcher photo')).toBeNull();
    // Phase 4: <Photo src={null}> renders <FamilySilhouette> as a
    // .family-silhouette span (no longer the old data-testid pattern
    // from SpeciesDetailVisual — FamilySilhouette carries no testid).
    expect(container.querySelector('.family-silhouette')).not.toBeNull();
  });

  it('onError on the photo img triggers fallback to silhouette', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY_WITH_PHOTO),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    const photo = await screen.findByAltText('Vermilion Flycatcher photo');
    // Phase 4: silhouette is NOT rendered while the photo img is shown.
    // <Photo> uses photo--silhouette class only in the silhouette state.
    expect(container.querySelector('.photo--silhouette')).toBeNull();
    // Simulate an image-load failure (404, ECONNRESET, etc.).
    fireEvent.error(photo);
    // Photo img is gone; silhouette fallback is now visible.
    // <Photo> unmounts <img> and shows <FamilySilhouette> (via .family-silhouette).
    expect(screen.queryByAltText('Vermilion Flycatcher photo')).toBeNull();
    expect(container.querySelector('.family-silhouette')).not.toBeNull();
  });

  it('alt text uses {comName} photo format for accessibility', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue({
        ...VERMFLY_WITH_PHOTO,
        comName: 'Anna’s Hummingbird',
        speciesCode: 'annhum',
        photoUrl: 'https://photos.bird-maps.com/annhum.jpg',
      }),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="annhum" apiClient={client} />);
    const photo = await screen.findByAltText('Anna’s Hummingbird photo');
    expect(photo.tagName).toBe('IMG');
  });

  // ─── Species description mount (issue #373 / epic #368) ──────────────
  //
  // SpeciesDescription renders the per-species Wikipedia summary HTML when
  // SpeciesMeta carries a non-null `descriptionBody`. The component
  // returns `null` when the field is absent so the surface gracefully
  // degrades on CDN-stale responses predating the field.
  //
  // The sentinel must remain the LAST child of `.species-detail-body` for
  // the IntersectionObserver to fire only after the user scrolls past every
  // descendant content node.

  it('mounts SpeciesDescription when descriptionBody is present and the credit links to the article', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue({
        ...VERMFLY,
        descriptionBody: '<p>The <em>Vermilion Flycatcher</em> is small and red.</p>',
        descriptionLicense: 'CC-BY-SA-3.0',
        descriptionAttributionUrl: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
      }),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(
      <SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />,
    );
    const section = await waitFor(() => {
      const node = container.querySelector('section.species-detail-description');
      if (!node) throw new Error('species-detail-description not yet rendered');
      return node;
    });
    expect(section).toBeInTheDocument();
    // The injected HTML rendered as DOM (not encoded as text).
    const em = section.querySelector('em');
    expect(em?.textContent).toBe('Vermilion Flycatcher');
    // Inline credit anchor: href + target + rel.
    const link = section.querySelector('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe(
      'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
    );
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('does not mount SpeciesDescription when descriptionBody is absent', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(
      <SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument(),
    );
    expect(container.querySelector('section.species-detail-description')).toBeNull();
  });

  it('keeps the bottom sentinel as the LAST child of .species-detail-body when description renders', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue({
        ...VERMFLY,
        descriptionBody: '<p>Body.</p>',
        descriptionAttributionUrl: 'https://en.wikipedia.org/wiki/X',
      }),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    const sentinel = await screen.findByTestId('detail-bottom-sentinel');
    const body = sentinel.closest('.species-detail-body');
    expect(body).not.toBeNull();
    // The IntersectionObserver fires on FIRST intersection then disconnects.
    // For that to mean "scrolled past everything" the sentinel must remain
    // the final child of the body container regardless of which optional
    // sub-components mount above it.
    expect(body!.lastElementChild).toBe(sentinel);
  });

  // ─── C2 #1046: colloquial family-name resolution ─────────────────────────
  //
  // Both render sites (identity row + taxonomy <dl>) must show the curated
  // #924 colloquial name from the silhouettes payload, NOT the raw eBird
  // familyName from SpeciesMeta.  Fixtures are DESYNCED (different strings)
  // to prove the resolution chain rather than accidentally passing because
  // both sources happen to carry the same text.

  it('C2: identity row and taxonomy <dl> show the colloquial name, not the raw eBird name', async () => {
    // DESYNCED: raw eBird name uses "and"; colloquial uses "&".
    const HAWK_META: SpeciesMeta = {
      speciesCode: 'coohaw',
      comName: "Cooper's Hawk",
      sciName: 'Accipiter cooperii',
      familyCode: 'accipitridae',
      familyName: 'Hawks, Eagles, and Kites',
      taxonOrder: 2200,
    };
    const HAWK_SILHOUETTE: FamilySilhouette = {
      familyCode: 'accipitridae',
      color: '#7A2EC7',
      colorDark: '#7A2EC7',
      svgData: 'M0 0L1 1Z',
      svgUrl: null,
      source: 'https://www.phylopic.org/i/y',
      license: 'CC0-1.0',
      commonName: 'Hawks, Eagles & Kites',
      creator: 'Test Creator',
    };
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(HAWK_META),
      getSilhouettes: vi.fn().mockResolvedValue([HAWK_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="coohaw" apiClient={client} />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: "Cooper's Hawk" })).toBeInTheDocument()
    );
    // Colloquial name appears at both sites (identity row + taxonomy dl).
    expect(screen.getAllByText('Hawks, Eagles & Kites')).toHaveLength(2);
    // Raw eBird name must NOT appear at either site.
    expect(screen.queryByText('Hawks, Eagles, and Kites')).toBeNull();
  });

  it('C2 fallback: when silhouettes payload has no entry for the family, renders raw eBird familyName', async () => {
    const HAWK_META: SpeciesMeta = {
      speciesCode: 'coohaw',
      comName: "Cooper's Hawk",
      sciName: 'Accipiter cooperii',
      familyCode: 'accipitridae',
      familyName: 'Hawks, Eagles, and Kites',
      taxonOrder: 2200,
    };
    const client = makeClient({
      // Silhouettes payload carries a DIFFERENT family — no accipitridae entry.
      getSpecies: vi.fn().mockResolvedValue(HAWK_META),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="coohaw" apiClient={client} />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: "Cooper's Hawk" })).toBeInTheDocument()
    );
    // Falls back to the raw eBird name at both sites.
    expect(screen.getAllByText('Hawks, Eagles, and Kites')).toHaveLength(2);
    // Must NOT render the Latin family name as a fallback.
    expect(screen.queryByText('Accipitridae')).toBeNull();
  });

  it('C2 null-commonName fallback: when silhouette.commonName is null, renders raw eBird familyName', async () => {
    const HAWK_META: SpeciesMeta = {
      speciesCode: 'coohaw',
      comName: "Cooper's Hawk",
      sciName: 'Accipiter cooperii',
      familyCode: 'accipitridae',
      familyName: 'Hawks, Eagles, and Kites',
      taxonOrder: 2200,
    };
    const NULL_COMMON_SILHOUETTE: FamilySilhouette = {
      familyCode: 'accipitridae',
      color: '#7A2EC7',
      colorDark: '#7A2EC7',
      svgData: 'M0 0L1 1Z',
      svgUrl: null,
      source: 'https://www.phylopic.org/i/y',
      license: 'CC0-1.0',
      commonName: null,
      creator: 'Test Creator',
    };
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(HAWK_META),
      getSilhouettes: vi.fn().mockResolvedValue([NULL_COMMON_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="coohaw" apiClient={client} />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: "Cooper's Hawk" })).toBeInTheDocument()
    );
    // null commonName → falls back to raw eBird name, not Latin family code.
    expect(screen.getAllByText('Hawks, Eagles, and Kites')).toHaveLength(2);
    expect(screen.queryByText('Accipitridae')).toBeNull();
  });

  // ─── Phase 4 heading + Photo contracts ──────────────────────────────────
  //
  // Sky Atlas Phase 4 promotes SpeciesDetailSurface to a presentational body
  // component consumed by SpeciesDetailModal (desktop) and SpeciesDetailSheet
  // (mobile). The heading becomes <h1 id="detail-title" tabIndex={-1}> so
  // the modal/sheet wrappers can set aria-labelledby="detail-title" and
  // call #detail-title.focus() on open. The photo masthead uses <Photo
  // priority={true}> so LCP is served by loading="eager" fetchpriority="high".

  it('renders species name as <h1 id="detail-title" tabIndex={-1}>', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY_WITH_PHOTO),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    const heading = await screen.findByRole('heading', { level: 1, name: /vermilion flycatcher/i });
    expect(heading).toHaveAttribute('id', 'detail-title');
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('renders <Photo priority> masthead when photoUrl is present', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY_WITH_PHOTO),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    const img = await screen.findByAltText(/vermilion flycatcher photo/i);
    // <Photo priority={true}> must produce loading="eager" and fetchpriority="high"
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
  });

  it('falls back to <FamilySilhouette> via <Photo> when photoUrl is null', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    // <Photo src={null}> renders <FamilySilhouette> internally, which
    // emits a .family-silhouette span (no data-testid — Phase 2 component).
    await waitFor(() =>
      expect(container.querySelector('.family-silhouette')).not.toBeNull()
    );
  });

  it('masthead silhouette carries family DB color (not grey) when photoUrl is null and silhouettes resolve', async () => {
    // Bot finding on #480: Photo.color was added but SpeciesDetailSurface never
    // resolved or forwarded it. When data.photoUrl is null the silhouette must
    // render in the family's DB color, not the FAMILY_COLOR_FALLBACK grey.
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    // Wait for the silhouette to render (data and silhouettes must both resolve).
    const silhouetteEl = await waitFor(() => {
      const el = container.querySelector('.family-silhouette') as HTMLElement | null;
      if (!el) throw new Error('.family-silhouette not yet rendered');
      return el;
    });
    // The DB color (#C77A2E) from TYRANNIDAE_SILHOUETTE must be wired through
    // buildFamilyColorResolver → Photo.color → FamilySilhouette → --family-fill.
    expect(silhouetteEl.style.getPropertyValue('--family-fill')).toBe('#C77A2E');
    expect(silhouetteEl.style.getPropertyValue('--family-fill')).not.toBe(FAMILY_COLOR_FALLBACK);
  });

  // ─── Analytics instrumentation (issue #357 tasks 3, 4) ─────────────────
  //
  // The detail surface fires three analytics events once per active species:
  //
  //   - `panel_opened` on mount (after the species detail resolves).
  //   - `panel_dwell_ms` on unmount with `dwell_ms = Date.now() - t0`.
  //   - `panel_scrolled_to_bottom` on first IntersectionObserver hit on
  //     the bottom sentinel.
  //
  // `analytics.capture` flows through `safeClarity.event` + `setTag` from
  // `clarity.ts`. In jsdom, `window.clarity` is undefined so the wrapper
  // no-ops — no console noise, no SDK throws. We spy on `analytics.capture`
  // directly to verify the events fire with the right payload.

  describe('analytics instrumentation', () => {
    it('fires panel_opened on mount with species_code and has_description=false when no description', async () => {
      const captureSpy = vi.spyOn(analytics, 'capture');
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
        getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
      } as unknown as Partial<ApiClient>);
      render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
      );
      expect(captureSpy).toHaveBeenCalledWith('panel_opened', {
        species_code: 'vermfly',
        has_description: false,
      });
      captureSpy.mockRestore();
    });

    // Issue #373 task 6: stratify the panel-thinness analysis post-hoc by
    // tagging `panel_opened` with `has_description: !!data.descriptionBody`.
    // The dwell event shape stays unchanged (Clarity's UI lets the analyst
    // group on the open-event property at query time).
    it('fires panel_opened with has_description=true when descriptionBody is present', async () => {
      const captureSpy = vi.spyOn(analytics, 'capture');
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue({
          ...VERMFLY,
          descriptionBody: '<p>Body.</p>',
          descriptionAttributionUrl: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
        }),
        getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
      } as unknown as Partial<ApiClient>);
      render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
      );
      expect(captureSpy).toHaveBeenCalledWith('panel_opened', {
        species_code: 'vermfly',
        has_description: true,
      });
      // Defensive: dwell event shape is unchanged — no `has_description` on
      // the dwell payload (the analyst groups on the open-event property at
      // query time).
      const dwellCalls = captureSpy.mock.calls.filter(([name]) => name === 'panel_dwell_ms');
      for (const [, payload] of dwellCalls) {
        expect(payload as Record<string, unknown>).not.toHaveProperty('has_description');
      }
      captureSpy.mockRestore();
    });

    it('fires panel_dwell_ms on unmount with species_code and a numeric dwell_ms', async () => {
      const captureSpy = vi.spyOn(analytics, 'capture');
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
        getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
      } as unknown as Partial<ApiClient>);
      const { unmount } = render(
        <SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />,
      );
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
      );
      // panel_opened fired on mount; clear so we isolate the unmount call.
      captureSpy.mockClear();
      unmount();
      expect(captureSpy).toHaveBeenCalledWith(
        'panel_dwell_ms',
        expect.objectContaining({
          species_code: 'vermfly',
          dwell_ms: expect.any(Number),
        }),
      );
      captureSpy.mockRestore();
    });

    it('does NOT fire panel_opened before species data resolves', async () => {
      const captureSpy = vi.spyOn(analytics, 'capture');
      // getSpecies never resolves — the effect's `if (!data?.speciesCode) return`
      // guard means `panel_opened` should not fire while the surface is still
      // in its loading state.
      const client = makeClient({
        getSpecies: vi.fn().mockReturnValue(new Promise(() => {})),
        getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
      } as unknown as Partial<ApiClient>);
      render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
      expect(screen.getByText('Loading species details…')).toBeInTheDocument();
      // Check synchronously after mount — no event should have fired.
      const calls = captureSpy.mock.calls.filter(([name]) => name === 'panel_opened');
      expect(calls).toHaveLength(0);
      captureSpy.mockRestore();
    });

    it('renders the bottom sentinel inside .species-detail-body', async () => {
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
        getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
      } as unknown as Partial<ApiClient>);
      render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
      const sentinel = await screen.findByTestId('detail-bottom-sentinel');
      expect(sentinel).toBeInTheDocument();
      // aria-hidden so SR users don't perceive an empty element at the end.
      expect(sentinel).toHaveAttribute('aria-hidden', 'true');
      // Must live inside the body so it scrolls with the panel content.
      const body = sentinel.closest('.species-detail-body');
      expect(body).not.toBeNull();
    });

    it('fires panel_scrolled_to_bottom on first sentinel intersection then disconnects', async () => {
      // Capture the IntersectionObserver instances and the callbacks the
      // component registers.  jsdom does not implement IntersectionObserver,
      // so we install a controllable mock that records each callback for
      // manual triggering — same pattern any IO-driven test in the codebase
      // would use.
      type IOInstance = {
        callback: IntersectionObserverCallback;
        observe: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        unobserve: ReturnType<typeof vi.fn>;
        takeRecords: ReturnType<typeof vi.fn>;
      };
      const observers: IOInstance[] = [];
      // Class form is required because the component uses `new IntersectionObserver(...)`
      // — vi.fn().mockImplementation(...) returns a function that's not callable
      // with `new`.  A real class wins.
      class IOMock {
        callback: IntersectionObserverCallback;
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
        takeRecords = vi.fn(() => []);
        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback;
          observers.push(this as unknown as IOInstance);
        }
      }
      const originalIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
      (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = IOMock;

      try {
        const captureSpy = vi.spyOn(analytics, 'capture');
        const client = makeClient({
          getSpecies: vi.fn().mockResolvedValue(VERMFLY),
          getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
        } as unknown as Partial<ApiClient>);
        render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
        const sentinel = await screen.findByTestId('detail-bottom-sentinel');
        expect(observers.length).toBeGreaterThan(0);
        // Find the observer that was wired to the sentinel — the component
        // calls observer.observe(sentinelRef.current) once.
        const wired = observers.find(o => o.observe.mock.calls.some(call => call[0] === sentinel));
        expect(wired).toBeDefined();
        // Trigger the first intersection.  The component should fire
        // `panel_scrolled_to_bottom` once and then disconnect to prevent
        // future re-fires.
        captureSpy.mockClear();
        act(() => {
          wired!.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            wired as unknown as IntersectionObserver,
          );
        });
        expect(captureSpy).toHaveBeenCalledWith('panel_scrolled_to_bottom', {
          species_code: 'vermfly',
        });
        expect(wired!.disconnect).toHaveBeenCalled();

        // Second intersection must NOT re-fire — the observer is already
        // disconnected, but defensively assert the binary-only contract
        // (issue #357 task 4: no 25/50/75 thresholds).
        captureSpy.mockClear();
        act(() => {
          wired!.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            wired as unknown as IntersectionObserver,
          );
        });
        const reFires = captureSpy.mock.calls.filter(([name]) => name === 'panel_scrolled_to_bottom');
        expect(reFires).toHaveLength(0);
        captureSpy.mockRestore();
      } finally {
        if (originalIO === undefined) {
          delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
        } else {
          (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = originalIO;
        }
      }
    });
  });
});
