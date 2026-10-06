import { useLanguageStore } from '../store/useLanguageStore';

/**
 * THE one place a name is resolved — customers, staff, stock items, party names on
 * khata entries and bills. No screen picks a language of its own.
 *
 * English UI → the English name. Urdu UI → the Urdu name where one was entered,
 * otherwise the English one: every English name column is NOT NULL and Urdu was
 * added later, so the fallback always has something to show. It never returns blank.
 *
 * `language` is only passed by code that has no React context (an export, a test);
 * everything else takes the current UI language.
 */
export function getDisplayName(
  entity: {
    name_en?: string;
    name_ur?: string;
    item_name_en?: string;
    item_name_ur?: string;
    item_name?: string;
    partyName?: string;
    party_name?: string;
    name?: string;
    party_name_ur?: string;
    description?: string;
    reason?: string;
  },
  language?: 'en' | 'ur'
): string {
  // An em dash, not "Stock Item": this helper names people as well as things.
  const NO_NAME = '—';
  if (!entity) return NO_NAME;

  const en =
    entity.item_name_en ||
    entity.item_name ||
    entity.name_en ||
    entity.partyName ||
    entity.party_name ||
    entity.name ||
    entity.description ||
    entity.reason ||
    '';

  const ur = entity.item_name_ur || entity.name_ur || entity.party_name_ur;
  const lang = language ?? useLanguageStore.getState().language;

  if (lang === 'ur') return ur || en || NO_NAME;
  return en || ur || NO_NAME;
}
