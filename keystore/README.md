# Release signing keystore

This folder holds `mediasteru-release.jks` — the private key used to sign
release builds of both Android apps (`android/` standalone app and
`companion-android/` companion app). It contains two key aliases:

- `standalone` — signs the standalone app (`com.mediasteru.android`)
- `companion` — signs the companion app (`com.mediasteru.companion`)

## ⚠️ Back this up. Losing it is permanent.

Once an app has been published (even just shared as an APK that people rely on
for updates), **Android will refuse to install any future update signed with a
different key**. If you lose this keystore or its passwords, you cannot ever
update that app again under the same package name — the only fix is telling
users to uninstall and install a "new" app from scratch.

**Do this now:**
1. Copy `mediasteru-release.jks` to at least one other location you
   control (a password manager's file storage, an encrypted USB drive, a
   private cloud folder). Do **not** email it to yourself in plaintext.
2. Also back up `../android/keystore.properties` and
   `../companion-android/keystore.properties` — they hold the passwords. If
   you'd rather not store passwords in plain files long-term, move the values
   into a password manager and delete the `.properties` files; Gradle will
   just skip signing (see below) until you recreate them.

## Why it's git-ignored

Both the `keystore/` folder and every `keystore.properties` file are excluded
in `.gitignore`. This is intentional — a signing key that ends up in a public
(or even private) git history is effectively compromised forever, since
history rewrites don't reliably scrub it from every clone/fork.

## How the build finds it

`android/app/build.gradle.kts` and `companion-android/app/build.gradle.kts`
each read their own `keystore.properties` (same folder as `build.gradle.kts`'s
project root) and point `storeFile` at this shared `.jks` via a relative path.
If `keystore.properties` is missing (e.g. a fresh clone, or CI without
secrets configured), the release build type simply isn't signed — `assembleRelease`
still runs but produces an unsigned APK you'd need to sign manually before
installing.

## Recreating `keystore.properties` if lost (but keystore intact)

```properties
storeFile=../keystore/mediasteru-release.jks
storePassword=<store password>
keyAlias=standalone   # or "companion" in companion-android/keystore.properties
keyPassword=<same as storePassword — PKCS12 requires they match>
```
