// gtag bootstrap + sanitized page-view sender (see
// docs/specs/2026-06-30-ga4-web-analytics-design.md §5.C). We deliberately do NOT use
// @next/third-parties: its <GoogleAnalytics> sends the full landing URL (incl. query strings) at
// gtag('config') time and exposes no flag to disable it, and its sendGAEvent only works when that
// component rendered. GaScripts bootstraps gtag via next/script; this module owns the data layer and
// emits config-first, path-only page views.

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export type PageViewParams = {
  page_path: string;
  page_location: string;
  page_referrer: string;
  page_title: string;
};

let configuredId: string | null = null;

// Establish window.dataLayer and a gtag(...args) wrapper. Each call pushes the args array onto the
// data layer; gtag.js reads command entries by index (array-like), so `["config", id, opts]` is the
// same shape it consumes from Google's canonical `arguments`-based snippet. Idempotent: defines the
// wrapper once.
function getGtag(): (...args: unknown[]) => void {
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== "function") {
    window.gtag = (...args: unknown[]): void => {
      window.dataLayer!.push(args);
    };
  }
  return window.gtag;
}

// Queue `js` + `config` (automatic page view disabled) exactly once. Calling this before any page
// view guarantees gtag.js has a configured destination when it drains the queue.
export function ensureGaConfigured(gaId: string): void {
  if (typeof window === "undefined") return;
  const gtag = getGtag();
  if (configuredId === gaId) return;
  gtag("js", new Date());
  gtag("config", gaId, { send_page_view: false });
  configuredId = gaId;
}

// Send a single sanitized (path-only) page view. Always queues config first, so the data-layer order
// is js -> config -> page_view regardless of when the loader <Script> executes.
export function sendPageView(gaId: string, params: PageViewParams): void {
  if (typeof window === "undefined") return;
  ensureGaConfigured(gaId);
  getGtag()("event", "page_view", params);
}

// Test-only: reset the module-scoped config guard between cases.
export function __resetGaConfigured(): void {
  configuredId = null;
}
