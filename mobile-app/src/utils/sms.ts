/**
 * SMS length accounting, so the user can be told what a message will COST before the
 * messaging app opens. The customer pays per part, and a message that silently splits
 * into three is a real expense on a cheap plan.
 *
 * Two encodings, decided by the characters present:
 *   GSM-7  plain Latin text. 160 characters in one part, 153 per part once it splits.
 *   UCS-2  anything else, which includes every Urdu character. 70 in one part, 67 after.
 *
 * ONE non-GSM character drags an entire message into UCS-2 and cuts its capacity from
 * 160 to 70 — which is exactly why no currency prefix in this app is a symbol, and why
 * there is no emoji anywhere in an SMS body.
 */

/** The GSM 03.38 basic set: one unit each. */
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

/** The GSM escape set: TWO units each, which is why '|' is worth avoiding. */
const GSM_EXTENDED = '^{}\[~]|€';

export type SmsCost = {
  encoding: 'GSM-7' | 'UCS-2';
  /** Billable units, not JavaScript characters — an extended GSM character counts twice. */
  units: number;
  /** How many messages the customer is charged for. */
  parts: number;
  /** Capacity of each part at this length, for reporting headroom. */
  perPart: number;
};

/** What this exact body will cost to send. */
export const smsCost = (body: string): SmsCost => {
  let units = 0;
  let gsm = true;
  for (const ch of body) {
    if (GSM_BASIC.includes(ch)) units += 1;
    else if (GSM_EXTENDED.includes(ch)) units += 2;
    else { gsm = false; break; }
  }
  if (gsm) {
    const perPart = units <= 160 ? 160 : 153;
    return { encoding: 'GSM-7', units, parts: units === 0 ? 1 : Math.ceil(units / perPart), perPart };
  }
  // UCS-2 counts 16-bit code units, so anything outside the BMP costs two.
  const units16 = Array.from(body).reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
  const perPart = units16 <= 70 ? 70 : 67;
  return { encoding: 'UCS-2', units: units16, parts: units16 === 0 ? 1 : Math.ceil(units16 / perPart), perPart };
};
