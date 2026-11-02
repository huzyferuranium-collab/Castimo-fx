/**
 * Registers the small service worker (public/sw.js) that only provides an offline page.
 * It is switched on only in the real build, over HTTPS, and never stops the site from loading if it fails.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // The site works the same without it.
    });
  });
}
