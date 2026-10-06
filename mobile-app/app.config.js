module.exports = {
  expo: {
    name: "AL-REEF",
    slug: "digikhata-app",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#00A651"
    },
    assetBundlePatterns: [
      "assets/icon.png",
      "assets/splash.png",
      "assets/adaptive-icon.png",
      "assets/favicon.png"
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.alreef.app",
      infoPlist: {
        // iOS returns FALSE from Linking.canOpenURL for any scheme not listed here,
        // even when the app is installed. ReminderModal asks canOpenURL before opening
        // WhatsApp, so without this the button would tell every iPhone user that
        // WhatsApp is not installed. Android needs no equivalent.
        LSApplicationQueriesSchemes: ["whatsapp"]
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#00A651"
      },
      package: "com.alreef.app"
      // No googleServicesFile here. This app talks to Firebase through the JS SDK
      // (firebase@10), configured from extra.firebase* below — see
      // src/services/firebase/firebaseConfig.ts. google-services.json is read only by
      // NATIVE Google SDKs (FCM, native analytics), and none are installed: there is no
      // @react-native-firebase package, no expo-notifications, and plugins is empty.
      // It is also matched by .gitignore, so EAS Build never uploaded it and every
      // Android build failed with "google-services.json is missing". Re-add this line
      // only together with a native Firebase package, and then supply the file as an
      // EAS file environment variable rather than committing it.
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    // Over-the-air updates. The binary checks this URL on launch and applies a newer
    // JS bundle if one matches its runtimeVersion. JS and bundled assets ONLY — the app
    // name, the package, the icon and any native module still require a new build.
    updates: {
      url: "https://u.expo.dev/b817f3e3-dc43-43c4-aef6-d6676ceda7b0",
      fallbackToCacheTimeout: 0,
    },
    // An update only reaches binaries whose runtimeVersion matches. "appVersion" ties it
    // to `version` above, so bumping that version deliberately cuts off older installs —
    // which is what you want the moment a native change ships. Do not bump it casually.
    runtimeVersion: { policy: "appVersion" },
    plugins: [],
    extra: {
      eas: {
        projectId: "b817f3e3-dc43-43c4-aef6-d6676ceda7b0"
      },
      firebaseApiKey: process.env.FIREBASE_API_KEY || '',
      firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
      firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
      firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
      firebaseAppId: process.env.FIREBASE_APP_ID || '',
    },
  },
};