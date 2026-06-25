# 04 — Apple & app stores

Two things live here:

1. **Sign in with Apple** — required for Apple OAuth via Logto (and effectively
   mandatory for iOS App Store apps that offer other social logins).
2. **Store accounts** — Apple Developer Program + Google Play Console, needed to
   distribute the mobile app.

**Unblocks:** Phase 2 Apple sign-in; eventual store submission.

> **Start the paid enrollments now.** Apple Developer Program and Google Play
> Console both involve identity verification / review that can take days. The
> technical wiring (Services ID, keys) can follow once enrolled.

---

## Part A — Apple Developer Program (paid)

1. Enroll at <https://developer.apple.com/programs/> (annual fee). Use the
   Red Duck Labs / FountainRank identity as appropriate.
2. Once active you have access to the **Developer** portal (Certificates, IDs &
   Profiles) and **App Store Connect**.

### App ID

1. **Certificates, IDs & Profiles → Identifiers → App IDs → +**.
2. Create an **App ID** with the owner-confirmed reverse-DNS bundle id
   `com.redducklabs.fountainrank`. It must match the Expo app config.
3. Enable the **Sign In with Apple** capability on this App ID.

### Sign in with Apple (for Logto)

Logto's Apple connector needs a **Services ID** and a **key**:

1. **Identifiers → + → Services IDs.** Create one (e.g.
   `com.redducklabs.fountainrank.web`). This is the OAuth `client_id` Apple
   uses for the web/redirect flow.
2. Configure the Services ID:
   - Enable **Sign In with Apple**.
   - **Return URL / redirect:** Logto's Apple callback,
     `https://auth.fountainrank.com/callback/<connector-id>` — the exact
     `<connector-id>` comes from creating the Apple connector in Logto
     (`06-logto.md`). Add it when Logto is up.
3. **Keys → + →** create a key with **Sign In with Apple** enabled, associate it
   with the App ID. Download the **`.p8` private key** (downloadable once — it's
   a secret). Record the **Key ID**.
4. Record your **Team ID** (top-right of the developer portal).

### App Store Connect

Create the app record in **App Store Connect** (App Store listing) when you're
ready to submit builds. EAS may also create the App ID/app record during the
first iOS build flow if the owner signs in and accepts that path. Not needed for
auth.

---

## Part B — Google Play Console (paid)

1. Enroll at <https://play.google.com/console> (one-time fee + identity
   verification).
   - If you are using a Google Workspace account and Play Console is blocked,
     sign in as a Workspace super admin at <https://admin.google.com/> and turn
     on **Google Play Console** for your user or organizational unit under
     **Apps → Additional Google services**. Workspace can disable access to
     Play Console even when the Google account itself is valid.
2. Create the **app** entry with package name `com.redducklabs.fountainrank`
   when ready; set up **Play App Signing** (Google manages the signing key). The
   resulting **signing certificate SHA-1** is what the Android OAuth client in
   `03-google-cloud.md` needs — capture it from Play Console → App integrity
   once the app is created.

See `07-mobile-store-readiness.md` for the slice 6e-8 store metadata,
screenshots, EAS credential, and testing-track worksheet.

---

## Outputs to record

| Value                                    | Becomes                             | Destination               |
| ---------------------------------------- | ----------------------------------- | ------------------------- |
| Bundle id `com.redducklabs.fountainrank` | Expo + Apple App ID + iOS OAuth     | already owner-confirmed   |
| Apple **Team ID**                        | Logto Apple connector               | `06-logto.md`             |
| Apple **Services ID**                    | Logto Apple connector (`client_id`) | `06-logto.md`             |
| Apple **Key ID**                         | Logto Apple connector               | `06-logto.md`             |
| Apple **`.p8` private key**              | Logto Apple connector               | **secret** — set in Logto |
| Play app signing **SHA-1**               | Android OAuth client (`03`)         | feeds `03`                |

**Hand me:** Play App Signing SHA-1 when it exists, plus any non-secret App
Store Connect / Play identifiers that need to be reflected in repo docs. **You
keep / set yourself:** the `.p8` key (entered into Logto in Phase 2), App Store
Connect API keys, Play service-account JSON, and all signing material.

---

## Security notes

- The `.p8` Sign-in-with-Apple key is downloadable **once** — store it securely
  immediately; it never goes in the repo.
- Keep the bundle id identical everywhere (Expo config, Apple App ID, Google
  OAuth iOS client) or sign-in/build will fail. The confirmed value is
  `com.redducklabs.fountainrank`.
