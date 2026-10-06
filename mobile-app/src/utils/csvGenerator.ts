import { csvCell } from '../components/Download/csvGenerator';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export const exportToCSV = async (filename: string, headers: string[], data: any[][]): Promise<void> => {
  // Build CSV string
  const rows = [headers, ...data];
  const csvContent = rows
    .map((row) => 
      row.map((cell) => csvCell(cell)).join(',')
    )
    .join('\n');

  // Define file URI
  const fileUri = `${FileSystem.documentDirectory}${filename}.csv`;

  try {
    // Write the CSV content to a local file
    await FileSystem.writeAsStringAsync(fileUri, csvContent, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    // Open native share dialog
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/csv',
        dialogTitle: `Share ${filename}`,
        UTI: 'public.comma-separated-values-text',
      });
    } else {
      if (__DEV__) console.warn('Sharing is not available on this device');
    }
  } catch (error) {
    if (__DEV__) console.error('Error exporting to CSV:', error);
    throw error;
  }
};
