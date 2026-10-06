import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppLanguage = 'en' | 'ur';

const LANGUAGE_KEY = 'app_language';

export { type TKey } from '../i18n/en';
import { en, TKey } from '../i18n/en';
import { ur } from '../i18n/ur';
import { translate, TranslationParams } from '../i18n/translate';
export const translations = { en, ur };

// ─── Store ────────────────────────────────────────────────────────────────────
interface LanguageStore {
  language: AppLanguage;
  isLoaded: boolean;
  loadLanguage: () => Promise<void>;
  setLanguage: (lang: AppLanguage) => Promise<void>;
  toggleLanguage: () => Promise<void>;
  /** Translate a typed key using named placeholders. */
  t: (key: TKey, params?: TranslationParams) => string;
}

export const useLanguageStore = create<LanguageStore>((set, get) => ({
  // English until the Urdu dictionary is complete — a fresh install labelled Urdu
  // but showing English strings is worse than plain English. Flip back when done.
  language: 'en',
  isLoaded: false,

  loadLanguage: async () => {
    try {
      const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
      const lang: AppLanguage = stored === 'en' || stored === 'ur' ? stored : 'en';
      set({ language: lang, isLoaded: true });
    } catch (_) {
      set({ language: 'en', isLoaded: true });
    }
  },

  setLanguage: async (lang: AppLanguage) => {
    try {
      await AsyncStorage.setItem(LANGUAGE_KEY, lang);
    } catch (_) {
      // ignore write failures — state still updates
    }
    set({ language: lang });
  },

  toggleLanguage: async () => {
    const next: AppLanguage = get().language === 'ur' ? 'en' : 'ur';
    await get().setLanguage(next);
  },

  t: (key, params) => translate(get().language, key, params),
}));
