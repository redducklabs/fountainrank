# Local Android Emulator

This guide walks through running the FountainRank mobile app on a local Android
emulator without using EAS build credits. It is intentionally linear. For host
specific gotchas and recovery notes, see `claude_help/local-dev.md`.

## What this runs

The mobile app uses MapLibre React Native, so Expo Go is not enough. The local
loop is:

1. Build the checked-in Android debug app with Gradle.
2. Install it on an Android emulator.
3. Run Metro from `mobile/`.
4. Open the app and reload it after JavaScript changes.

The debug app talks to production HTTPS defaults unless you build it with public
`EXPO_PUBLIC_*` overrides. Do not put those values in a `.env` file.

## Prerequisites

Install and configure these on the Windows host:

- Node 22 and pnpm 11.
- JDK 17.
- Android Studio with Android SDK Platform 35.
- Android SDK command-line tools and platform-tools.
- An Android Virtual Device named `fountainrank`, using API 35 `google_apis`
  x86_64 or equivalent.

Make sure PowerShell can find Java and the Android SDK:

```powershell
java -version
adb version
$env:JAVA_HOME
$env:ANDROID_HOME
```

If you run Gradle from Git Bash instead of PowerShell, export the same values in
that shell. Windows user-scope environment variables are not automatically
available inside Git Bash.

## One-time dependency setup

From the repo root:

```powershell
pnpm install --frozen-lockfile
```

This project uses a local hoisted pnpm linker on the Windows host so React Native
native build paths stay under Windows path-length limits. If you recently changed
the pnpm linker or repaired `node_modules`, clear stale Android build caches:

```powershell
Remove-Item -Recurse -Force mobile/android/.gradle,mobile/android/build,mobile/android/app/build,mobile/android/app/.cxx -ErrorAction SilentlyContinue
```

## Start the emulator

Start the `fountainrank` AVD from Android Studio, or from PowerShell:

```powershell
emulator -avd fountainrank
```

Wait until the device is visible:

```powershell
adb devices
```

On this Windows/WSL/Docker host, the emulator may boot without a default network
route. If the app cannot reach Metro or the network, run this once per emulator
boot:

```powershell
adb root
adb shell ip route add default via 10.0.2.2 dev wlan0
```

## Build and install the debug APK

From the repo root:

```powershell
mobile/android/gradlew.bat -p mobile/android :app:assembleDebug -PreactNativeArchitectures=x86_64
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

If you need authenticated native features, export the public Logto native app id
before the Gradle build. The values are baked into the debug APK at build time,
not read from Metro:

```powershell
$env:EXPO_PUBLIC_LOGTO_APP_ID="<public native app id>"
$env:EXPO_PUBLIC_LOGTO_NATIVE_AUTH_CONFIRMED="true"
mobile/android/gradlew.bat -p mobile/android :app:assembleDebug -PreactNativeArchitectures=x86_64
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Do not commit those values. The native app id is public client configuration, but
it still belongs in your shell or CI config, not in repo files.

## Start Metro

Metro must run from `mobile/`, not from the repo root:

```powershell
cd mobile
$env:CI="1"
pnpm exec expo start --port 8081
```

The Android debug app loads JavaScript from `10.0.2.2:8081`, which is the
emulator's route to host loopback. `adb reverse` is not part of this setup.

Because `CI=1` disables Metro's file watcher, restart Metro after JavaScript or
asset edits before reloading the app. Native or config-plugin changes require a
new Gradle build and reinstall.

## Launch the app

With Metro running:

```powershell
adb shell monkey -p com.redducklabs.fountainrank 1
```

If you want the map centered on seeded data, grant location and set the emulator
location to San Diego:

```powershell
adb shell pm grant com.redducklabs.fountainrank android.permission.ACCESS_FINE_LOCATION
adb emu geo fix -117.162 32.715
```

Useful commands while testing:

```powershell
adb shell input keyevent 82
adb shell am force-stop com.redducklabs.fountainrank
adb logcat | Select-String -Pattern "ReactNativeJS|FountainRank"
```

You can also deep-link directly to a fountain detail screen:

```powershell
adb shell am start -a android.intent.action.VIEW -d "com.redducklabs.fountainrank://fountains/<uuid>"
```

## Edit loop

For JavaScript-only edits:

1. Stop Metro.
2. Start Metro again from `mobile/`.
3. Relaunch or reload the app.

For native dependency, Android project, Expo config, or patch-package edits:

1. Stop the app.
2. Rebuild with Gradle.
3. Reinstall the debug APK.
4. Restart Metro.
5. Relaunch the app.

## Checks

Before treating a mobile change as ready, run the local mobile checks:

```powershell
.\run.ps1 check -Mobile
```

If PowerShell is unavailable from your shell, run the direct checks:

```bash
pnpm --filter mobile run lint
pnpm --filter mobile run typecheck
pnpm --filter mobile run test
CI=true pnpm dlx expo-doctor
```

On this host, some mobile dependency and render confidence still comes from CI
and device/emulator verification. Do not claim emulator behavior worked unless
you actually observed it on the running emulator.

## Troubleshooting

`JAVA_HOME is not set`

Set `JAVA_HOME` in the shell that runs Gradle. Git Bash does not inherit all
PowerShell user-scope environment variables.

`ninja: error: manifest 'build.ninja' still dirty`

This usually means Android build caches still point at an old pnpm layout. Clear:

```powershell
Remove-Item -Recurse -Force mobile/android/.gradle,mobile/android/build,mobile/android/app/build,mobile/android/app/.cxx -ErrorAction SilentlyContinue
```

Then reinstall dependencies if needed and rebuild.

Metro serves old code

Confirm Metro was started from `mobile/`. Restart Metro after each JavaScript
edit because the local `CI=1` Metro process does not watch files.

The app cannot reach Metro

Confirm Metro is on port 8081, then add the emulator default route:

```powershell
adb shell ip route
adb root
adb shell ip route add default via 10.0.2.2 dev wlan0
```

Map opens but there are no fountains nearby

Set the emulator location to a seeded area:

```powershell
adb emu geo fix -117.162 32.715
```
