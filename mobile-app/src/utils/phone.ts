/** The country this shop's local numbers belong to, in calling-code digits. */
export const DEFAULT_COUNTRY_CODE = '92';

/**
 * The longest NATIONAL number (after the trunk '0') that the default country uses.
 * Pakistan: mobiles are 10 digits after the 0 ("3001234567") and landlines 9–10
 * ("4235678901"). A foreign number saved the local way carries its country code
 * inside those digits, so it is always longer than this.
 */
const MAX_NATIONAL_DIGITS = 10;

/**
 * A phone number in the international digits WhatsApp and SMS need — no '+', the
 * caller adds it. Returns null when there is nothing dialable.
 *
 * Numbers are stored however the shopkeeper typed them: "0300 1234567" locally,
 * but also "+971 50 …", "0097150…" and — because the field has always accepted
 * anything — a foreign number flattened into the local shape, "0971501234567".
 *
 * The three forms are resolved in order:
 *   '+cc…' / '00cc…'  already international; strip the prefix and trust it.
 *   '0' + ≤10 digits  a national number of THIS country; prepend the country code.
 *   '0' + >10 digits  too long to be national, so the leading 0 is a mis-saved
 *                     trunk prefix and the country code is already there; drop it.
 *   no leading 0      assumed to already carry a country code; left alone.
 *
 * The length rule replaces a hardcoded list that recognised only Pakistan and one
 * UAE prefix ('0971'). Every other country fell through to the Pakistan branch, so
 * a Saudi '0966…' became '92966…' and dialled a real Pakistani stranger. Nothing
 * here is country-specific except DEFAULT_COUNTRY_CODE and MAX_NATIONAL_DIGITS.
 */
export const internationalPhone = (raw?: string | null): string | null => {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  let out: string;
  if (raw.trim().startsWith('+')) {
    out = digits;
  } else if (digits.startsWith('00')) {
    out = digits.slice(2);
  } else if (digits.startsWith('0')) {
    const national = digits.slice(1);
    out = national.length <= MAX_NATIONAL_DIGITS ? DEFAULT_COUNTRY_CODE + national : national;
  } else {
    out = digits;
  }

  // Shorter than any real international number — a half-typed field, not a number.
  return out.length >= 10 ? out : null;
};
