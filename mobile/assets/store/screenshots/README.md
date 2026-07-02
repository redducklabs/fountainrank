# Store screenshots

This directory contains owner-reviewable screenshot assets for the first
FountainRank store submissions.

- **`play-store/` (Android): real device captures.** Taken from the release-config
  app running on an Android emulator (San Diego basemap, production API), status
  bar in demo mode, at Google Play's `1080x1920` phone size. These reflect the
  shipped native UI.
- **`app-store-6-9/` and `app-store-6-5/` (iOS): generated mockups.** Still built
  from the committed FountainRank logo/pin assets by
  `scripts/generate-store-screenshots.mjs`, pending real iPhone captures (no macOS
  in the build environment, so the iOS simulator cannot be driven here).

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

| File                                | Size              | Screen                                             |
| ----------------------------------- | ----------------- | -------------------------------------------------- |
| `play-store/01-map-discovery.png`   | 1080x1920 RGB PNG | Map discovery (San Diego, pins + clusters)         |
| `play-store/02-fountain-detail.png` | 1080x1920 RGB PNG | Fountain detail (ratings, features, accessibility) |
| `play-store/03-search.png`          | 1080x1920 RGB PNG | Address/city search + geocode results              |
| `play-store/04-rating-filter.png`   | 1080x1920 RGB PNG | Map filtered by rating (3★+)                       |
| `play-store/05-rankings.png`        | 1080x1920 RGB PNG | Contributor rankings / leaderboard                 |

Google Play accepts `1080x1920` phone screenshots as 24-bit RGB PNGs.

For the Play feature graphic, use
`mobile/assets/store/play-feature-graphic.png` instead of `docs/logos/feature-graphic.png`.
The committed store feature graphic is already cropped to Google's required
`1024x500` RGB PNG size.

## Review note

The `play-store/` PNGs are literal captures of the release-config app and match
the shipped native UI. The `app-store-6-9/` and `app-store-6-5/` PNGs are still
generated mockups and must be replaced with real iPhone captures before final
public submission (see the Android capture recipe below for the equivalent iOS
flow on a physical device).

The map/search/detail-view/rankings screens are public-read, so the emulator
captures are pixel-identical to the production store build for those screens.
Rating and ranking values shown are from seed/test accounts, not organic user
data.

## Regeneration

### iOS mockups (`app-store-6-9/`, `app-store-6-5/`)

The source generator is `scripts/generate-store-screenshots.mjs`. Regenerate the
iOS mockup sets only — **do not** regenerate `play-store/`, which now holds real
device captures the generator would overwrite with mockups:

```bash
rm -rf temp/store-screenshot-build/svg mobile/assets/store/screenshots/app-store-6-9 mobile/assets/store/screenshots/app-store-6-5
node scripts/generate-store-screenshots.mjs
mkdir -p mobile/assets/store/screenshots/app-store-6-9 mobile/assets/store/screenshots/app-store-6-5
pnpm dlx sharp-cli -i 'temp/store-screenshot-build/svg/app-store-6-9/*.svg' -o mobile/assets/store/screenshots/app-store-6-9 -f png --density 72 flatten '#ffffff' -- toColourspace srgb
pnpm dlx sharp-cli -i 'temp/store-screenshot-build/svg/app-store-6-5/*.svg' -o mobile/assets/store/screenshots/app-store-6-5 -f png --density 72 flatten '#ffffff' -- toColourspace srgb
```

### Android real captures (`play-store/`)

Captured from a **release-config** build of the app installed on an Android
emulator (the map is a native module, so a dev-client/release build is required —
not Expo Go). With the app installed and `adb` on `PATH`:

```bash
# Play's phone size + GPS in a fountain-dense area (San Diego = 360+ fountains)
adb shell wm size 1080x1920
adb emu geo fix -117.162 32.715
adb shell pm grant com.redducklabs.fountainrank android.permission.ACCESS_FINE_LOCATION

# Clean status bar (demo mode: 12:00, full battery/wifi, no notifications)
adb shell settings put global sysui_demo_allowed 1
adb shell am broadcast -a com.android.systemui.demo -e command enter
adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 1200
adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false
adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 -e fully true
adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false

# Navigate to each screen, then capture (repeat per screen)
adb exec-out screencap -p > shot.png
```

Raw `screencap` PNGs are RGBA; flatten to 24-bit RGB (e.g. Pillow, white
background) before committing. The same navigate-and-capture flow applies to a
physical iPhone (use its native screenshot, then confirm the size matches an
accepted App Store slot).
