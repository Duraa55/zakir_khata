# The app lives in `mobile-app/`, not here

This directory is the git root ONLY. The Expo project is `mobile-app/`.

`app.json.disabled`, `package.json.disabled`, `package-lock.json.disabled` and
`eas.json.disabled` were a second, unrelated Expo project that had been left here:
Expo SDK **56** with `expo-dev-client`, no `src/`, no `assets/`.

They were disabled on 2026-10-03 because they broke the EAS build. EAS uploads every
git-tracked file, saw a `package.json` at the archive root, installed `expo@56` there,
resolved the ROOT as the project instead of `mobile-app/`, and then prebuild died on
the root `app.json`'s `./assets/icon.png`, which does not exist here:

    Error: withAndroidDangerousBaseMod: ENOENT: open './assets/icon.png'
    at /home/expo/workingdir/build/node_modules/@expo/prebuild-config/...

The same files were also why `npx expo start` from this directory reported
"Unable to resolve asset ./assets/icon.png" instead of serving the app.

DO NOT re-enable them. If you need them back for some reason, they are intact in git
history and a rename restores them. Run every expo / eas command from `mobile-app/`.

## What DOES belong here (added 2026-10-07)

`firebase.json`, `.firebaserc`, `firestore.rules` and `firestore.indexes.json` are
legitimately root-level and must NOT be swept up as more stray config. They configure the
Firebase **project**, which backs the whole repo, not the Expo app — and unlike a root
`package.json`, they are invisible to EAS Build and cannot confuse it.

Deploy rules from HERE, not from `mobile-app/`:

    firebase deploy --only firestore:rules

The rules were previously edited only in the Firebase console, unversioned, where nobody
could review a change or tell when one happened. That is why they are in git now.
