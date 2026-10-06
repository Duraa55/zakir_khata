import { localDate, toDateValue, formatDisplayDate, todayDate, isValidDateValue } from '../../utils/dates';

/**
 * The period a report covers. Both ends are optional YYYY-MM-DD values, exactly
 * like the book filters: a missing end is open (the SQL uses the same
 * 0001-01-01 / 9999-12-31 bounds as getFilteredCashHistory & co), so an export can
 * cover "everything" the way the screens can.
 */
export type ReportPeriod = { startDate?: string; endDate?: string };

export type ReportPreset = 'today' | 'week' | 'month' | 'custom';

/**
 * The presets, in the order they are shown. KEY ONLY — these carried English `label`
 * strings that nothing ever read: DownloadOptionsModal maps the key to a dictionary key
 * itself. A second set of labels that no one renders is a label free to disagree with
 * the one on screen, and in two languages it can only ever be wrong in one of them.
 */
export const REPORT_PRESETS: { key: ReportPreset }[] = [
  { key: 'today' },
  { key: 'week' },
  { key: 'month' },
  { key: 'custom' },
];

/** Concrete local-calendar bounds for a preset, computed at `now`. */
export const presetPeriod = (preset: ReportPreset, now: Date = new Date()): ReportPeriod => {
  const today = localDate(now);
  if (preset === 'today') return { startDate: today, endDate: today };
  if (preset === 'week') {
    // Today plus the six days before it — seven calendar days, inclusive.
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 12);
    return { startDate: localDate(from), endDate: today };
  }
  if (preset === 'month') {
    // Whole calendar month, the same bounds the Bill Book opens on, so a
    // "This month" export reconciles with the "This month" screen.
    return {
      startDate: localDate(new Date(now.getFullYear(), now.getMonth(), 1, 12)),
      endDate: localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0, 12)),
    };
  }
  return {};
};

/**
 * Validates and normalises what a caller asked for. Accepts YYYY-MM-DD; legacy
 * callers that still pass a full ISO timestamp get its LOCAL calendar day.
 * Throws the same messages as the book filters so the modal surfaces them as-is.
 */
export const resolvePeriod = (period: ReportPeriod): ReportPeriod => {
  const out: ReportPeriod = {};
  for (const key of ['startDate', 'endDate'] as const) {
    const raw = period[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = toDateValue(raw);
    if (!value) throw new Error('Invalid date range.');
    out[key] = value;
  }
  if (out.startDate && out.endDate && out.startDate > out.endDate) throw new Error('From date must not be after To date.');
  return out;
};

/** "01 Sep 2026 to 30 Sep 2026", "from …", "up to …" or "all dates" — for the PDF header. */
export const describePeriod = ({ startDate, endDate }: ReportPeriod): string => {
  if (!startDate && !endDate) return 'all dates';
  if (startDate && endDate) return `${formatDisplayDate(startDate)} to ${formatDisplayDate(endDate)}`;
  return startDate ? `from ${formatDisplayDate(startDate)}` : `up to ${formatDisplayDate(endDate)}`;
};

/** File-name fragment: "2026-09-01_to_2026-09-30", "all-dates", "from_2026-09-01"… */
export const periodSlug = ({ startDate, endDate }: ReportPeriod): string => {
  if (!startDate && !endDate) return 'all-dates';
  if (startDate && endDate) return `${startDate}_to_${endDate}`;
  return startDate ? `from_${startDate}` : `to_${endDate}`;
};

/**
 * Starting period for the download sheet. A day-view screen (the Cash Book's Day Book)
 * passes the day it is showing: that day exports as the "Today" preset when it is today,
 * otherwise as a Custom day-to-day range. With no day given, the month the books open on.
 */
export const initialPeriod = (viewedDay?: string, period?: ReportPeriod): { preset: ReportPreset; range: ReportPeriod } => {
  // A report screen hands over the range it is showing (either end may be open).
  if (period && (period.startDate || period.endDate)) {
    const clean = resolvePeriod(period);
    return { preset: 'custom', range: clean };
  }
  if (viewedDay && isValidDateValue(viewedDay)) {
    if (viewedDay === todayDate()) return { preset: 'today', range: presetPeriod('today') };
    return { preset: 'custom', range: { startDate: viewedDay, endDate: viewedDay } };
  }
  return { preset: 'month', range: presetPeriod('month') };
};
