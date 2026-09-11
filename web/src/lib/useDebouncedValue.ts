import { useEffect, useState } from 'react';

/**
 * Returns `value` only once it has stopped changing for `delayMs`.
 *
 * Debounce, not throttle -- the two are often confused and the difference
 * matters here. Throttle fires at most once every N ms, sampling a value as it
 * changes. Debounce waits for a pause and then fires once. We want the address
 * the user settled on, not samples taken while they were still typing it.
 *
 * The cleanup function is the entire mechanism: every keystroke cancels the
 * timer the previous keystroke set, so only a genuine pause survives long
 * enough to fire.
 *
 * 400ms is chosen to match the natural pause after finishing a field. Much
 * shorter and it fires mid-word; much longer and the user has already moved to
 * the next field when the modal appears, which reads as a glitch.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
