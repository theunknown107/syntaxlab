import { useEffect, useState } from 'react';

import {
  applyTheme,
  flushTheme,
  reloadThemeFromUrl,
  themeStore,
} from '@/application/theme/themeStore';
import { useStore } from '@/components/hooks/useStore';

import { ThemeDrawer } from './ThemeDrawer';
import styles from './theme.module.css';

/*
 * The drawer is imported eagerly, having been measured both ways.
 *
 * `React.lazy` is the obvious move for a settings panel most sessions never
 * open, and it made the bundle *larger*: it moved 1.59 KiB into its own chunk
 * while the entry chunk shrank by only 0.46 KiB, the rest going to lazy-load
 * machinery and to gzip having a smaller corpus to work with. Net +1.11 KiB
 * for a deferred fetch nobody was waiting on. Recorded in 12_PERFORMANCE.md so
 * the next person does not repeat the experiment.
 */

/**
 * The Appearance button, and the wiring the theme needs to stay honest.
 *
 * Three effects, each for a failure the pre-paint bootstrap cannot cover:
 *
 *  - **Re-apply on mount.** The bootstrap runs before the bundle and may have
 *    been skipped entirely (a theme from a newer build, or a URL it could not
 *    read). This makes the DOM agree with the state the application holds.
 *  - **Follow Back and Forward.** The theme lives in the URL from M15, and
 *    `popstate` is the one navigation that can change it underneath a running
 *    document — theme edits themselves use `replaceState` precisely so they do
 *    not. This replaces the old cross-tab `storage` listener, which has no
 *    equivalent now and deliberately has not been recreated: two tabs on two
 *    URLs are two documents with two themes.
 *  - **Flush before leaving.** The URL write is debounced so a slider drag
 *    does not rewrite the address bar on every frame, which leaves a window
 *    where a change is on screen but not yet in the URL. Closing the tab
 *    inside that window would lose it silently.
 */
export function ThemeControls(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const preset = useStore(themeStore, (value) => value.preset);

  useEffect(() => {
    applyTheme(themeStore.getState());

    const onPopState = (): void => {
      reloadThemeFromUrl();
    };
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') flushTheme();
    };

    window.addEventListener('popstate', onPopState);
    document.addEventListener('visibilitychange', onHide);
    // `pagehide` rather than `unload`: it fires for the back/forward cache,
    // which `unload` does not, and it is the one the platform still supports.
    window.addEventListener('pagehide', flushTheme);

    return () => {
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushTheme);
      flushTheme();
    };
  }, []);

  return (
    <>
      <button
        type="button"
        className={styles.headerButton}
        // The current theme is named, not only shown: "Appearance" alone
        // gives a screen-reader user no way to know what is set.
        aria-label={`Appearance. Current theme: ${preset === 'custom' ? 'custom' : preset}.`}
        onClick={() => {
          setOpen(true);
        }}
      >
        Appearance
      </button>

      <ThemeDrawer
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}
