import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

const firebaseConfig = {
  apiKey: extra.firebaseApiKey || '',
  authDomain: extra.firebaseAuthDomain || '',
  projectId: extra.firebaseProjectId || '',
  storageBucket: extra.firebaseStorageBucket || '',
  messagingSenderId: extra.firebaseMessagingSenderId || '',
  appId: extra.firebaseAppId || '',
};

export const IS_FIREBASE_CONFIGURED =
  !!firebaseConfig.apiKey && !!firebaseConfig.projectId;

let firebaseInitialized = false;

export const initializeFirebase = (): void => {
  if (__DEV__) console.log('[Firebase] Starting initialization...');
  try {
    if (!IS_FIREBASE_CONFIGURED) {
      if (__DEV__) console.log('[Firebase] Env vars missing, skipping Firebase init.');
      return;
    }
    if (!getApps().length) {
      initializeApp(firebaseConfig);
    }
    firebaseInitialized = true;
    if (__DEV__) console.log('[Firebase] Auth ready.');
  } catch (error) {
    if (__DEV__) console.error('[Firebase] Init failed:', error);
  }
};

export const getFirestoreDB = () => {
  if (!IS_FIREBASE_CONFIGURED) {
    throw new Error('Firebase is not configured. Set FIREBASE_* env vars.');
  }
  if (!firebaseInitialized) initializeFirebase();
  return getFirestore(getApp());
};
