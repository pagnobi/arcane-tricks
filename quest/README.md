# Publishing Arcane Tricks on the Meta Horizon Store

The Quest app is a thin Android wrapper (a *Trusted Web Activity*, built with Meta's fork of Google's
Bubblewrap) around the live site, https://pagnobi.github.io/arcane-tricks/. It launches straight into VR.
Because the game loads from the website, every push to GitHub updates the game on Quest too.
You only rebuild the APK when the name, icon or package settings change.

## What's already done

- [x] Installable web app: `public/manifest.webmanifest` (PNG icons, maskable icon, `ovr_package_name`) and a
      service worker (`public/sw.js`)
- [x] Launches straight into VR when opened as the installed app (`World.enterVrIfInstalledApp`)
- [x] Privacy policy: `public/privacy.html` → https://pagnobi.github.io/arcane-tricks/privacy.html
- [x] Store art, screenshots and listing text: `store/` (see `store/listing.md`)
- [x] Build tools on this PC: JDK 17 and Android SDK in `~/.bubblewrap`, Meta's Bubblewrap in `~/.arcane-tricks-tools`
- [x] Signing key: `~/.arcane-tricks-signing/`. **Back up this whole folder** (a USB stick or password manager).
      If you lose it, you can never update the store app. Never commit it.
- [x] Build config: `quest/twa-manifest.json` (package `com.pagnobi.arcanetricks`, immersive mode)
- [x] Build script: `bash quest/build.sh` → `quest/out/arcane-tricks.apk`

## Domain verification (Digital Asset Links)

Quest only opens the site full-screen as an app if the site proves it owns the app. It does this with
`https://pagnobi.github.io/.well-known/assetlinks.json`, which must be at the **root** of the domain, not under
`/arcane-tricks/`. On GitHub Pages that means a separate repo named `pagnobi.github.io`
(see `quest/assetlinks.json` for the file). Without it, the app opens with a browser address bar.

## Steps only you can do

1. **Create a Meta developer account.** Go to https://developers.meta.com/horizon/ and sign in with your Meta
   account. Create an **organization**, then verify the account (phone number or payment method).
2. **Create the app.** In the Developer Dashboard, choose **Create new app** and pick the **Meta Horizon Store**
   (Quest) platform. Name it `Arcane Tricks`.
3. **Fill in the store listing** from `store/listing.md`, and upload the art from `store/`. Also complete the
   **IARC age rating** questionnaire and the **Data use** (privacy) section, matching `public/privacy.html`.
4. **Get a Quest and test.** Meta reviews every app on a real headset, and nobody has played this one in a
   headset yet. Before you submit:
   - Turn on Developer Mode (Meta Horizon phone app → your headset → Developer Mode).
   - Connect the headset by USB, then install the APK with `adb install quest/out/arcane-tricks.apk`
     (adb is in `~/.bubblewrap/android_sdk/platform-tools`).
   - Check that it opens straight into VR, that solo play and hosting/joining work, that performance is smooth,
     and that the menus are readable.
   - Record the trailer (30s–2min, 1080p or higher) and headset screenshots with the Quest's built-in
     recording (**Camera** in the universal menu).
5. **Upload the build.** In the dashboard, open **Distribution → Builds**, upload `quest/out/arcane-tricks.apk`
   to the **ALPHA** channel, and invite yourself and a friend as testers. When it works, submit it for review.
   You can also upload from the command line with Meta's **Oculus Platform Utility**
   (`ovr-platform-util upload-quest-build --app_id <APP ID> --app_secret <SECRET> --apk quest/out/arcane-tricks.apk --channel ALPHA`),
   using the App ID and secret from **Development → API**.
6. **Price and payouts.** If you charge for the app, add your payout account and tax forms under
   **Payout Accounts** before you set a price.

## Rebuilding the APK

```bash
bash quest/build.sh
```

Before uploading a new build, increase `appVersionCode` (and `appVersionName`) in `quest/twa-manifest.json`.
Meta rejects a build whose version code isn't higher than the last one.

## Later: in-app purchases

Packaged web apps on Quest can sell things through Meta's store payments, using the web
**Digital Goods API** (`window.getDigitalGoodsService`). That fits the "host pays, friends join free" model:
Meta handles payment and records who owns what, so purchases can't be faked by editing the browser's storage.
To turn it on, set `features.horizonBilling` and `applicationId` (your 16-digit App ID) in `twa-manifest.json`,
then rebuild.
