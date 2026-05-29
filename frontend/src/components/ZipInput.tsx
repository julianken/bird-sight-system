import { useId, useState, type FormEvent } from 'react';
import { loadZipIndex, lookupZip } from '../data/zip-lookup.js';
import { zipResolutionToScope, type ScopeResolution } from '../state/scope-types.js';

/**
 * ZIP entry — a native `<input>` (no combobox lib; repo pattern) that resolves
 * a 5-digit ZIP to a map scope and never fails silently.
 *
 * Lazy load: the ~1 MB ZIP index is warmed on the FIRST input FOCUS, not on
 * mount — that focus is the lazy-load trigger keeping the dataset out of the
 * entry bundle. `loadZipIndex` is memoized single-flight, so re-focusing is a
 * no-op after the first warm.
 *
 * Four submit outcomes (the "never silent" contract):
 *   - resolved        → `onResolve(zipResolutionToScope(res))`
 *   - notRecognized   → well-formed 5-digit ZIP, lookup returned null. A
 *                       VISIBLE `role=status` message; the input value is KEPT
 *                       (never a silent no-op).
 *   - malformed       → not 5 digits. An inline `role=status`-free hint; no
 *                       fetch is attempted (the regex gate is in `lookupZip`,
 *                       and we short-circuit here too so the index never warms
 *                       on a malformed submit).
 *   - fetchError      → the index download failed. A `role=alert` message
 *                       steering the user to the state selector instead.
 */

type Feedback =
  | { kind: 'none' }
  | { kind: 'malformed' }
  | { kind: 'notRecognized' }
  | { kind: 'fetchError' };

export interface ZipInputProps {
  /** Called with the resolved scope when a known ZIP is submitted. */
  onResolve: (scope: ScopeResolution) => void;
}

export function ZipInput({ onResolve }: ZipInputProps): React.JSX.Element {
  const [value, setValue] = useState('');
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'none' });
  const inputId = useId();

  function handleFocus(): void {
    // Lazy-load trigger: warm the dataset on first focus. Memoized, so safe
    // to call on every focus.
    void loadZipIndex().catch(() => {
      // A focus-time warm failure is not surfaced here — the submit path
      // re-attempts the lookup and renders the role=alert fallback if it
      // still fails. Swallowing keeps focus side-effect-free for the user.
    });
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    // `maxLength={5}` caps the field at 5 chars, so a `-####` ZIP+4 suffix can
    // never be typed here — and `lookupZip` already trims + strips ZIP+4 + gates
    // on exactly 5 digits (and is independently tested for it). So we do NOT
    // re-strip: we gate "malformed → no fetch" on the trimmed value and hand the
    // normalization to `lookupZip`, keeping a single source of truth.
    const zip = value.trim();

    // Malformed → inline hint, no lookup, no fetch.
    if (!/^\d{5}$/.test(zip)) {
      setFeedback({ kind: 'malformed' });
      return;
    }

    try {
      const res = await lookupZip(zip);
      if (res) {
        setFeedback({ kind: 'none' });
        onResolve(zipResolutionToScope(res));
      } else {
        // Well-formed but unknown: never silent. Keep the value.
        setFeedback({ kind: 'notRecognized' });
      }
    } catch {
      setFeedback({ kind: 'fetchError' });
    }
  }

  return (
    <form className="zip-input" onSubmit={handleSubmit} role="search">
      <input
        id={inputId}
        className="zip-input__field"
        type="text"
        inputMode="numeric"
        pattern="[0-9]{5}"
        maxLength={5}
        aria-label="ZIP code"
        placeholder="ZIP"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={handleFocus}
      />
      {feedback.kind === 'malformed' && (
        <p className="zip-input__error">Enter a 5-digit ZIP</p>
      )}
      {feedback.kind === 'notRecognized' && (
        <p className="zip-input__status" role="status" aria-live="polite">
          ZIP not recognized — try a nearby ZIP or pick a state
        </p>
      )}
      {feedback.kind === 'fetchError' && (
        <p className="zip-input__error" role="alert">
          Could not load ZIP data — pick a state instead
        </p>
      )}
    </form>
  );
}
