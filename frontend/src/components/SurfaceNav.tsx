import { useRef, type KeyboardEvent } from 'react';
import type { View } from '../state/url-state.js';

export interface SurfaceNavProps {
  activeView: View;
  onSelectView: (view: View) => void;
}

interface TabDef {
  value: View;
  label: string;
}

// Stable order drives ArrowLeft / ArrowRight focus migration. The
// WAI-ARIA "automatic activation" tablist pattern selects on focus, so
// activation and focus move together in Arrow handlers.
const TABS: readonly TabDef[] = [
  { value: 'feed', label: 'Feed' },
  { value: 'species', label: 'Species' },
  { value: 'hotspots', label: 'Hotspots' },
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

  return (
    <div className="surface-nav" role="tablist" aria-label="Surface">
      {TABS.map((tab, index) => {
        const selected = tab.value === props.activeView;
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
            aria-labelledby={`surface-tab-${tab.value}`}
            tabIndex={selected ? 0 : -1}
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
