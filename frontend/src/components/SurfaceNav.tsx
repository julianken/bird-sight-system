import { useRef, type KeyboardEvent } from 'react';
import type { View } from '../state/url-state.js';

export interface SurfaceNavProps {
  activeView: View;
  onSelectView: (view: View) => void;
}

interface TabDef {
  value: View;
  label: string;
  // Accessible name diverges from visible text to avoid colliding with
  // FiltersBar's "Species" and "Family" input labels. Without the suffix
  // both elements resolve to name="Species" and break Playwright's
  // strict-mode getByLabel/getByRole locators.
  accessibleName: string;
}

// Stable order drives ArrowLeft / ArrowRight focus migration. The
// WAI-ARIA "automatic activation" tablist pattern selects on focus, so
// activation and focus move together in Arrow handlers.
const TABS: readonly TabDef[] = [
  { value: 'feed', label: 'Feed', accessibleName: 'Feed view' },
  { value: 'species', label: 'Species', accessibleName: 'Species view' },
  { value: 'hotspots', label: 'Hotspots', accessibleName: 'Hotspots view' },
];

export function SurfaceNav(props: SurfaceNavProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function activateIndex(index: number) {
    const next = TABS[index];
    if (!next) return;
    tabRefs.current[index]?.focus();
    if (next.value !== props.activeView) {
      props.onSelectView(next.value);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight': {
        event.preventDefault();
        activateIndex((index + 1) % TABS.length);
        break;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        activateIndex((index - 1 + TABS.length) % TABS.length);
        break;
      }
      case 'Home': {
        event.preventDefault();
        activateIndex(0);
        break;
      }
      case 'End': {
        event.preventDefault();
        activateIndex(TABS.length - 1);
        break;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const tab = TABS[index];
        if (tab && tab.value !== props.activeView) {
          props.onSelectView(tab.value);
        }
        break;
      }
      default:
        break;
    }
  }

  const anyTabActive = TABS.some(t => t.value === props.activeView);

  return (
    <div className="surface-nav" role="tablist" aria-label="Surface">
      {TABS.map((tab, index) => {
        const selected = tab.value === props.activeView;
        const tabbable = selected || (!anyTabActive && index === 0);
        return (
          <button
            key={tab.value}
            ref={el => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`surface-tab-${tab.value}`}
            aria-selected={selected}
            aria-controls="main-surface"
            aria-label={tab.accessibleName}
            tabIndex={tabbable ? 0 : -1}
            className={`surface-nav-tab${selected ? ' is-active' : ''}`}
            onClick={() => {
              if (tab.value !== props.activeView) {
                props.onSelectView(tab.value);
              }
            }}
            onKeyDown={e => handleKeyDown(e, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
