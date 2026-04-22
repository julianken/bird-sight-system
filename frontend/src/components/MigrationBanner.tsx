// Release 2: remove this component and `readMigrationFlag` after `?region=` traffic ages out.
import { useState } from 'react';
export { readMigrationFlag } from '../state/url-state.js';

interface MigrationBannerProps {
  show: boolean;
}

/**
 * Shown when a user lands with a legacy ?region= URL.
 * Dismiss removes ?region= from the URL without a page navigation.
 *
 * Release 2: remove this component and `readMigrationFlag` after `?region=` traffic ages out.
 */
export function MigrationBanner({ show }: MigrationBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!show || dismissed) return null;

  function handleDismiss() {
    const p = new URLSearchParams(window.location.search);
    p.delete('region');
    const q = p.toString();
    const newUrl = q
      ? `${window.location.pathname}?${q}`
      : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
    setDismissed(true);
  }

  return (
    <div className="migration-banner" role="status">
      <span className="migration-banner-text">
        The region view has been replaced. Use the Filters bar to filter by family or species.
      </span>
      <button
        type="button"
        className="migration-banner-dismiss"
        aria-label="Dismiss migration notice"
        onClick={handleDismiss}
      >
        &times;
      </button>
    </div>
  );
}
