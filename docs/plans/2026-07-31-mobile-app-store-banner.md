# Mobile app-store banner

## Scope

Add a dismissible, site-wide web banner that offers the native FountainRank app to visitors using
iOS or Android. Reuse the existing optional store-link configuration and keep the website fully
usable when platform detection is unavailable or incorrect.

This is a small extension of the existing homepage store-link design, so it does not require a new
architecture spec. The existing footer links remain available on every platform.

## Behavior

- Detect Android from the browser user agent and detect iPhone, iPad, and iPod, including iPads
  using desktop-class browsing mode. Run detection only in the browser; render nothing during SSR.
- Select only the matching configured store URL. If that URL is absent, the banner stays hidden.
- Do not show the banner when the site is running in standalone display mode.
- Render a non-modal, accessible top banner with concise app copy, one store action, and a **Not
  now** dismissal control. It must not trap focus or block use of the map.
- Persist dismissal in `localStorage`. If storage is unavailable, dismiss for the current page
  lifetime without crashing.
- Mount the coordinator once from the root layout. Keep it independent of the bottom analytics
  consent banner so the two surfaces do not overlap.
- Configure the supplied permanent production URLs in the web image build:
  - App Store: `https://apps.apple.com/us/app/fountainrank/id6782199873`
  - Google Play: `https://play.google.com/store/apps/details?id=com.redducklabs.fountainrank`
- Preserve the existing footer badges and update the setup/runbook status now that both URLs exist.

## Implementation

1. Extend the pure mobile-store helper with platform detection, standalone detection, matching-link
   selection, and a stable dismissal storage key.
2. Add a presentational banner and a client coordinator following the repository's
   `useSyncExternalStore` SSR/hydration pattern.
3. Mount the coordinator in `web/app/layout.tsx` and document the UI contract in the style guide.
4. Pass both public store URLs through the deploy and security-audit Docker builds, and declare the
   corresponding Docker build arguments.
5. Add pure helper tests and component interaction tests covering iOS, Android, desktop,
   standalone mode, missing configuration, dismissal persistence, storage failure, and the
   accessible store action.

## Verification

- Run formatting, web ESLint, TypeScript, the focused pure/helper and component tests, and the web
  production build locally where supported.
- Run the repository's required full local check before pushing, disclosing any host-limited suites.
- Require CI green, an independent adversarial review approval, and resolution of every PR comment
  before squash-merging.
- Dispatch `deploy.yml` from `main`, monitor it to success, then confirm anonymous HTTP 200 responses
  from `https://fountainrank.com/` and `https://api.fountainrank.com/readyz`.
