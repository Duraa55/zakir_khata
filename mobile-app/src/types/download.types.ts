export interface ReportOptions {
  reportType: 'cash' | 'stock' | 'stockIn' | 'stockOut' | 'bill' | 'staff' | 'expense';
  userId: string;
  /** YYYY-MM-DD, inclusive. Either end may be omitted for an open range (all dates). */
  startDate?: string;
  endDate?: string;
  /** Stock IN / OUT only: one item's movements, as opened from the report. */
  itemId?: string;
  format: 'pdf' | 'csv';
}

export interface DownloadRequest {
  reportType: 'cash' | 'stock' | 'bill' | 'staff' | 'expense';
  targetUserId: string;
  requestedBy: string;
  startDate: string;
  endDate: string;
  format: 'pdf' | 'csv';
  generatedAt: string;
  fileUri?: string;
}
