'use client';

import { useEffect } from 'react';

/**
 * Registers the hand-written service worker (public/sw.js). Client-only:
 * the registration call has no meaning during server rendering.
 */
export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // The `?v=` is load-bearing, not cosmetic. A service worker is considered "the
    // same worker" by its URL, so without it a new deploy never triggers install, the
    // precached shell is never refreshed, and the worker keys its caches off a constant
    // that `activate` can never find anything older than.
    const version = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';

    const register = () => {
      navigator.serviceWorker.register(`/sw.js?v=${version}`).catch((error) => {
        console.error('Service worker registration failed', error);
      });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
    }
  }, []);

  return null;
}
