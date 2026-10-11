import { TKey } from './en';

// The data layer throws English messages (it has no access to the UI language, and the
// same message is written to logs). A screen that shows one to the user passes it
// through here first, so the shopkeeper reads it in their own language. A message with
// no entry shows as-is rather than disappearing.
const MESSAGE_KEYS: Readonly<Record<string, TKey>> = {
  'Password must be at least 8 characters': 'pwTooShort',
  'Password must contain an uppercase letter': 'pwNeedsCapital',
  'Password must contain a number': 'pwNeedsNumber',
  // Sentinels, not prose: these are thrown where the UI language is unknown, and the
  // message a shopkeeper reads must explain WHY, not just that something failed.
  PASSWORD_CHANGE_NEEDS_ONLINE: 'pwNeedsOnline',
  PASSWORD_DIVERGED: 'pwDiverged',
  PASSWORD_CHANGE_FAILED: 'pwChangeFailed',
};

/** Display text for a message thrown by the data layer. Pass `t` from useLanguageStore. */
export function messageLabel(t: (key: TKey) => string, message: string | null | undefined): string {
  if (!message) return '';
  const key = MESSAGE_KEYS[message];
  return key ? t(key) : message;
}
