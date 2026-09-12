import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'bolt-theme';

/**
 * Light is the default when nothing is stored, deliberately -- the operating
 * system's preference is not consulted. Most people meeting this page will see
 * it in light, which is what it is designed around.
 */
function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // localStorage throws in some private-browsing modes. The default stands.
  }
  return 'light';
}

/**
 * Owns the theme and keeps it on <html data-theme>, which is what the
 * stylesheet keys off.
 *
 * The first paint is handled by an inline script in index.html rather than
 * here; by the time React mounts, the attribute is already correct. This hook
 * exists to change it afterwards and to remember the choice.
 */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Not being able to remember the choice is not worth failing over.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'light' ? 'dark' : 'light'));
  }, []);

  return { theme, toggleTheme };
}
