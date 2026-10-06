import { Alert } from 'react-native';
import { exportToExcel } from './excelExport';
import { generateGenericPDF } from './pdfGenerator';
import { useLanguageStore } from '../store/useLanguageStore';

/**
 * The report export sheet. Both formats are REAL: "PDF" prints through
 * generateGenericPDF, and "Excel" writes a genuine .xlsx through the xlsx package —
 * it is not a CSV wearing an Excel label. The books' own download modal is a separate
 * path that offers PDF and CSV and writes exactly those.
 *
 * Every string here reads from the dictionaries. They were hardcoded English on a flow
 * the Urdu pass reported as complete, so an Urdu user met an English dialog.
 */
export const handleReportExport = (
  reportName: string,
  data: any[],
  sheetName: string = 'Report'
) => {
  // Not a hook: this is called from an onPress, so read the store directly.
  const t = useLanguageStore.getState().t;
  Alert.alert(
    t('exportTitle'),
    t('exportChooseFormat'),
    [
      {
        text: t('exportPdf'),
        onPress: async () => {
          try {
            await generateGenericPDF(reportName.replace(/_/g, ' '), data);
          } catch (e) {
            if (__DEV__) console.error('PDF export failed', e);
            Alert.alert(t('commonError'), t('exportPdfFailed'));
          }
        }
      },
      {
        text: t('exportExcel'),
        onPress: async () => {
          try {
            await exportToExcel(reportName, data, sheetName);
          } catch (e) {
            if (__DEV__) console.error('Excel export failed', e);
            Alert.alert(t('commonError'), t('exportExcelFailed'));
          }
        }
      },
      { text: t('commonCancel'), style: 'cancel' }
    ]
  );
};
