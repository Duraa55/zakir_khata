import * as FileSystem from 'expo-file-system';
import { ReportOptions } from '../../types/download.types';

/**
 * One CSV cell, escaped per RFC 4180. A cell holding a comma, a quote or a line break
 * is wrapped in quotes with its quotes doubled, so `5" pipe, 2m` stays ONE cell and
 * never shifts the columns after it. Callers pass raw values — never pre-quoted.
 *
 * A text cell starting with = + @ or a tab is prefixed with ' so a spreadsheet shows
 * it as text instead of running it as a formula. A leading minus is left alone: that
 * is how a negative amount is written.
 */
export const csvCell = (value: unknown): string => {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+@\t]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const generateCsvFile = async (
  options: ReportOptions,
  data: any[],
  headers: string[],
  rowMapper: (row: any) => string[]
): Promise<string> => {
  const headerRow = headers.map(csvCell).join(',');
  const bodyRows = data.map(r => rowMapper(r).map(csvCell).join(',')).join('\n');
  const csvContent = `${headerRow}\n${bodyRows}`;

  const fileName = `${options.reportType}_report_${Date.now()}.csv`;
  const fileUri = `${FileSystem.documentDirectory}${fileName}`;

  await FileSystem.writeAsStringAsync(fileUri, csvContent, { encoding: FileSystem.EncodingType.UTF8 });
  return fileUri;
};
