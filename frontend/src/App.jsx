import { useEffect } from 'react';
import legacyMarkup from './legacy-markup.html?raw';

/**
 * Compatibility migration: React mounts the original Spend Wise markup unchanged.
 * The existing DOM-driven application script is loaded after the markup is mounted,
 * preserving the current UI and all existing interactions while the frontend moves
 * to a Vite + React entry point.
 */
export default function App() {
  useEffect(() => {
    let cancelled = false;
    const loadScript = (src) => new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-spend-wise="${src}"]`);
      if (existing) { resolve(); return; }
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.spendWise = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.body.appendChild(script);
    });
    (async () => {
      try {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js');
        if (!cancelled) await loadScript('/js/app.js');
      } catch (error) {
        console.error('Spend Wise frontend startup failed:', error);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return <div id="spend-wise-root" dangerouslySetInnerHTML={{ __html: legacyMarkup }} />;
}
