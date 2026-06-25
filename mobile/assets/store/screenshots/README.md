# Store screenshots

This directory contains owner-reviewable screenshot assets for the first
FountainRank store submissions. They are generated from the committed
FountainRank logo/pin assets and current mobile app flows.

## App Store Connect

Upload the PNGs in `app-store/` to the iPhone 6.5" Display screenshot slot:

| File                                   | Size              | Screen                  |
| -------------------------------------- | ----------------- | ----------------------- |
| `app-store/01-map-discovery.png`       | 1242x2688 RGB PNG | Map discovery           |
| `app-store/02-fountain-detail.png`     | 1242x2688 RGB PNG | Fountain detail         |
| `app-store/03-contribute.png`          | 1242x2688 RGB PNG | Contribution flow       |
| `app-store/04-add-fountain.png`        | 1242x2688 RGB PNG | Add fountain            |
| `app-store/05-account-diagnostics.png` | 1242x2688 RGB PNG | Account and diagnostics |

Apple accepts `1242x2688` for the iPhone 6.5" Display slot.

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

These are polished store screenshot mockups based on the current app flows. Before
final public submission, review them against the native build and replace them
with physical-device captures if the store reviewer or owner policy requires
literal device screenshots.
