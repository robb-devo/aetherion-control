# Publish the AETHERION Control APK

GitHub Actions builds the sideload APK. Nothing is built on a laptop.

The release APK is signed with Expo's debug keystore (the standard Android debug certificate, SHA1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`). Phones on 1.0.14 can install it as an update. The workflow does not create a release keystore.

`android/` is gitignored. The job runs `pnpm exec expo prebuild --platform android --no-install`, then `assembleRelease` for `arm64-v8a` and `armeabi-v7a`. It uses Node 22 and pnpm 10. pnpm 9 cannot frozen-install this lockfile, because the platform overrides live in `pnpm-workspace.yaml`.

## Publish v1.0.15

`main` is still app 1.0.3. The 1.0.15 source is `release/1.0.15`. GitHub only shows **Run workflow** after `.github/workflows/android-apk.yml` is on the default branch (`main`).

1. Merge the workflow into `release/1.0.15`.
2. Put the same workflow file on `main` (cherry-pick that commit, or copy the file). Do not run the build from `main`.
3. Open **Actions → Android APK → Run workflow**.
4. Branch: **`release/1.0.15`**. Tag: **`v1.0.15`** (already filled in). Click **Run workflow**.

The run uploads an artifact named `AETHERION-Control-1.0.15.apk` and creates or updates the GitHub Release `v1.0.15` with that APK. `/api/app/latest` serves the `.apk` on the latest release.

Clear the tag field to build the artifact without publishing a release. Pushing a `v*` tag (for example `v1.0.15` on `release/1.0.15`) publishes that tag without using the Actions button, including before the workflow file is on `main`. The tag's commit must contain this workflow, and the tag version must match `app.json`.
