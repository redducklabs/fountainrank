# Store screenshots

This directory contains owner-reviewable screenshot assets for the first
FountainRank store submissions. They are generated from the committed
FountainRank logo/pin assets and current mobile app flows.

## App Store Connect

Upload the PNGs in `app-store-6-9/` to the iPhone 6.9" Display screenshot
slot:

| File                                       | Size              | Screen                  |
| ------------------------------------------ | ----------------- | ----------------------- |
| `app-store-6-9/01-map-discovery.png`       | 1290x2796 RGB PNG | Map discovery           |
| `app-store-6-9/02-fountain-detail.png`     | 1290x2796 RGB PNG | Fountain detail         |
| `app-store-6-9/03-contribute.png`          | 1290x2796 RGB PNG | Contribution flow       |
| `app-store-6-9/04-add-fountain.png`        | 1290x2796 RGB PNG | Add fountain            |
| `app-store-6-9/05-account-diagnostics.png` | 1290x2796 RGB PNG | Account and diagnostics |

If App Store Connect specifically prompts for the iPhone 6.5" Display slot, use
the PNGs in `app-store-6-5/`:

| File                                       | Size              | Screen                  |
| ------------------------------------------ | ----------------- | ----------------------- |
| `app-store-6-5/01-map-discovery.png`       | 1242x2688 RGB PNG | Map discovery           |
| `app-store-6-5/02-fountain-detail.png`     | 1242x2688 RGB PNG | Fountain detail         |
| `app-store-6-5/03-contribute.png`          | 1242x2688 RGB PNG | Contribution flow       |
| `app-store-6-5/04-add-fountain.png`        | 1242x2688 RGB PNG | Add fountain            |
| `app-store-6-5/05-account-diagnostics.png` | 1242x2688 RGB PNG | Account and diagnostics |

Apple's current screenshot specification lists `1290x2796` as an accepted 6.9"
portrait size and `1242x2688` as an accepted 6.5" portrait size:
<https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/>.

## Google Play Console

Upload the PNGs in `play-store/` to the Phone screenshots section:

| File                                    | Size              | Screen                  |
| --------------------------------------- | ----------------- | ----------------------- |
| `play-store/01-map-discovery.png`       | 1080x1920 RGB PNG | Map discovery           |
| `play-store/02-fountain-detail.png`     | 1080x1920 RGB PNG | Fountain detail         |
| `play-store/03-contribute.png`          | 1080x1920 RGB PNG | Contribution flow       |
| `play-store/04-add-fountain.png`        | 1080x1920 RGB PNG | Add fountain            |
| `play-store/05-account-diagnostics.png` | 1080x1920 RGB PNG | Account and diagnostics |

Google Play accepts `1080x1920` phone screenshots as 24-bit RGB PNGs.

For the Play feature graphic, use
`mobile/assets/store/play-feature-graphic.png` instead of `docs/logos/feature-graphic.png`.
The committed store feature graphic is already cropped to Google's required
`1024x500` RGB PNG size.

## Review note

These are polished store screenshot mockups based on the current app flows. They
must accurately match the shipped native build before final public submission.
Replace them with physical-device captures if the native UI diverges, the store
reviewer requires literal device screenshots, or owner policy requires captures.

## Regeneration

The source generator is `scripts/generate-store-screenshots.mjs`. To regenerate:

```bash
rm -rf temp/store-screenshot-build/svg mobile/assets/store/screenshots/app-store-6-9 mobile/assets/store/screenshots/app-store-6-5 mobile/assets/store/screenshots/play-store
node scripts/generate-store-screenshots.mjs
mkdir -p mobile/assets/store/screenshots/app-store-6-9 mobile/assets/store/screenshots/app-store-6-5 mobile/assets/store/screenshots/play-store
pnpm dlx sharp-cli -i 'temp/store-screenshot-build/svg/app-store-6-9/*.svg' -o mobile/assets/store/screenshots/app-store-6-9 -f png --density 72 flatten '#ffffff' -- toColourspace srgb
pnpm dlx sharp-cli -i 'temp/store-screenshot-build/svg/app-store-6-5/*.svg' -o mobile/assets/store/screenshots/app-store-6-5 -f png --density 72 flatten '#ffffff' -- toColourspace srgb
pnpm dlx sharp-cli -i 'temp/store-screenshot-build/svg/play-store/*.svg' -o mobile/assets/store/screenshots/play-store -f png --density 72 flatten '#ffffff' -- toColourspace srgb
```
