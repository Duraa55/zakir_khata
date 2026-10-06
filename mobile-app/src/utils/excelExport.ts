import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';

export const exportToExcel = async (
  reportName: string,
  data: any[],
  sheetName: string = 'Report'
): Promise<void> => {
  try {
    if (!data || data.length === 0) {
      throw new Error('No data to export.');
    }

    // 1. Create a new workbook and add a worksheet
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    // 2. Generate a binary string of the excel file
    const wbout = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });

    // 3. Define the file path in local device storage
    const timestamp = new Date().getTime();
    const uri = `${FileSystem.documentDirectory}${reportName.replace(/\s+/g, '_')}_${timestamp}.xlsx`;

    // 4. Write the binary string to the local file system
    await FileSystem.writeAsStringAsync(uri, wbout, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // 5. Share the file via the native share sheet
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: `Share ${reportName}`,
      });
    } else {
      throw new Error('Sharing is not available on this device');
    }
  } catch (error) {
    if (__DEV__) console.error('Excel Export Error:', error);
    throw error;
  }
};
