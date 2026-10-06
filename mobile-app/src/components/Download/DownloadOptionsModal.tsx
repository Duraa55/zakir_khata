import { useLanguageStore } from '../../store/useLanguageStore';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useAuthStore } from '../../store/authStore';
import { useDownloadStore } from '../../store/useDownloadStore';
import { ReportOptions } from '../../types/download.types';
import { todayDate, formatDisplayDate } from '../../utils/dates';
import { DateRangeFilter, DateRange } from '../ui/DateRangeFilter';
import { REPORT_PRESETS, ReportPreset, presetPeriod, periodSlug, initialPeriod } from './reportPeriod';
import { Icon } from '../ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

export const DownloadOptionsModal = ({ route, navigation }: any) => {
  const { t } = useLanguageStore();
  // `date` (YYYY-MM-DD) is the day a day-view screen was showing when it opened this
  // sheet — the Cash Book's Day Book — so "daily cash in/out" is the default and the
  // preset pills / From–To still reach a week, a month or any custom span.
  // `period` is the range a report screen (Stock IN/OUT) is already showing.
  const { reportType, date: viewedDay, period: shownPeriod, itemId } = route.params as
    { reportType: ReportOptions['reportType']; date?: string; period?: { startDate?: string; endDate?: string }; itemId?: string };
  const { user } = useAuthStore();
  const { isGenerating, generateFile } = useDownloadStore();

  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf');

  // The period drives the report's SQL (pdfGenerator). Presets fill the same
  // from–to fields the books use; touching a field switches to Custom. Staff is a
  // roster with no date dimension, so the control is hidden for it and the
  // document prints "As of today" instead.
  const isRoster = reportType === 'staff';
  const initial = initialPeriod(viewedDay, shownPeriod);
  const [preset, setPreset] = useState<ReportPreset>(initial.preset);
  const [range, setRange] = useState<DateRange>(initial.range);

  const choosePreset = (next: ReportPreset) => {
    setPreset(next);
    if (next !== 'custom') setRange(presetPeriod(next));
  };
  const editRange = (next: DateRange) => {
    setPreset('custom');
    setRange(next);
  };

  const handleDownload = async () => {
    if (!user) return;

    const isPdf = format === 'pdf';
    const mimeType = isPdf ? 'application/pdf' : 'text/csv';
    const period = isRoster ? {} : range;
    const fileName = `${reportType}_report_${isRoster ? todayDate() : periodSlug(period)}.${isPdf ? 'pdf' : 'csv'}`;

    try {
      const fileUri = await generateFile({
        reportType,
        itemId,
        userId: user.id,
        startDate: period.startDate,
        endDate: period.endDate,
        format,
      });

      // Same save/share path as the working per-bill PDF (BillDetailScreen).
      if (Platform.OS === 'android') {
        const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!permissions.granted) {
          // Cancelling the folder picker used to leave the sheet sitting there with
          // no feedback at all — indistinguishable from the button doing nothing.
          Alert.alert(
            t('cannotSave'),
            t('folderHelp'),
            [
              { text: t('cancel'), style: 'cancel' },
              {
                text: t('shareInstead'),
                onPress: async () => {
                  await Sharing.shareAsync(fileUri, { mimeType, dialogTitle: t('shareReport') });
                  navigation.goBack();
                },
              },
            ]
          );
          return;
        }

        try {
          const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
          const newUri = await FileSystem.StorageAccessFramework.createFileAsync(
            permissions.directoryUri,
            fileName,
            mimeType
          );
          await FileSystem.writeAsStringAsync(newUri, base64, { encoding: FileSystem.EncodingType.Base64 });
          Alert.alert(t('success'), t('savedReport'), [
            { text: t('ok'), onPress: () => navigation.goBack() },
          ]);
        } catch (safErr) {
          if (__DEV__) console.error('[Download] SAF error:', safErr);
          Alert.alert(
            t('cannotSave'),
            t('folderHelp'),
            [
              { text: t('cancel'), style: 'cancel' },
              {
                text: t('shareInstead'),
                onPress: async () => {
                  await Sharing.shareAsync(fileUri, { mimeType, dialogTitle: t('shareReport') });
                  navigation.goBack();
                },
              },
            ]
          );
        }
      } else {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            UTI: isPdf ? '.pdf' : '.csv',
            mimeType,
            dialogTitle: t('saveReport'),
          });
        }
        navigation.goBack();
      }
    } catch (err: any) {
      // Do NOT goBack() here — the sheet stays open so the failure is visible.
      if (__DEV__) console.error('[Download] Failed to generate report:', err);
      Alert.alert(t('downloadFailed'), err?.message || t('reportFailed'));
    }
  };

  return (
    <View style={styles.modalBg}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('downloadReport')}</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} disabled={isGenerating} style={styles.close} accessibilityRole="button" accessibilityLabel={t('close')}>
            <Icon name="x" size={iconSize.md} tint={color.textSecondary} />
          </TouchableOpacity>
        </View>

        {isRoster ? (
          <>
            <Text style={styles.label}>{t('period')}</Text>
            <View style={styles.rosterLine}>
              <Text style={styles.dateText}>{t('rosterAsOf')}</Text>
              <Text style={styles.dateText}>{formatDisplayDate(todayDate())}</Text>
            </View>
            <Text style={styles.hint}>{t('rosterHelp')}</Text>
          </>
        ) : (
          <>
            <Text style={styles.label}>{t('period')}</Text>
            {/* NOT the two-up format row: four equal flex: 1 pills left "This month"
                about 56dp of text room on a 360dp phone, so it rendered as "Thi…" — the
                one preset whose meaning dies with its words. The pills are sized to
                their own label here and wrap when they must, which also leaves Urdu
                (~40% longer) somewhere to grow. */}
            <View style={styles.presetRow}>
              {REPORT_PRESETS.map(p => (
                <TouchableOpacity
                  key={p.key}
                  style={[styles.formatBtn, styles.presetBtn, preset === p.key && styles.formatBtnActive]}
                  onPress={() => choosePreset(p.key)}
                >
                  <Text style={preset === p.key ? styles.formatTextActive : styles.formatText} numberOfLines={1}>
                    {t(({ today: 'today', week: 'sevenDays', month: 'thisMonth', custom: 'custom' } as const)[p.key])}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <DateRangeFilter value={range} onChange={editRange}
              fieldStyle={styles.dateBox} textStyle={styles.dateLabel} />
          </>
        )}

        <Text style={styles.label}>{t('format')}</Text>
        <View style={styles.formatRow}>
          <TouchableOpacity 
            style={[styles.formatBtn, format === 'pdf' && styles.formatBtnActive]}
            onPress={() => setFormat('pdf')}
          >
            <Text style={format === 'pdf' ? styles.formatTextActive : styles.formatText}>{t('pdf')}</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.formatBtn, format === 'csv' && styles.formatBtnActive]}
            onPress={() => setFormat('csv')}
          >
            <Text style={format === 'csv' ? styles.formatTextActive : styles.formatText}>{t('csv')}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity 
          style={styles.downloadBtn} 
          onPress={handleDownload}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <ActivityIndicator color={color.textInverse} />
          ) : (
            <>
              <Icon name="download" size={iconSize.sm} tint={color.textInverse} />
              <Text style={styles.downloadBtnText}>{t('savePhone')}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  modalBg: { flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' },
  container: {
    backgroundColor: color.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: space.xl, paddingBottom: space.xxl,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
  title: { ...typeScale.title, fontSize: 18, color: color.textPrimary, flex: 1 },
  close: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center', marginRight: -space.md },

  label: { ...typeScale.label, color: color.textSecondary, marginBottom: space.sm, marginTop: space.md },
  rosterLine: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  dateText: { ...typeScale.bodyMedium, fontSize: 16, color: color.textPrimary },
  hint: { ...typeScale.caption, color: color.textSecondary, marginTop: space.xs },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // flex: 0 beats formatBtn's flex: 1 — a preset pill is as wide as its own label.
  presetBtn: { flex: 0, paddingHorizontal: space.md },
  dateBox: {
    minHeight: touchTarget, paddingHorizontal: space.md, borderRadius: radius.md,
    borderWidth: hairline, borderColor: color.border, backgroundColor: color.surfaceRaised, marginTop: space.sm,
  },
  dateLabel: { ...typeScale.label, color: color.textPrimary },

  formatRow: { flexDirection: 'row', gap: space.sm },
  formatBtn: {
    flex: 1, minHeight: touchTarget, borderRadius: radius.pill, borderWidth: hairline, borderColor: color.borderStrong,
    alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface,
  },
  formatBtnActive: { borderColor: color.accent, backgroundColor: color.accent },
  formatText: { ...typeScale.label, color: color.textSecondary },
  formatTextActive: { ...typeScale.label, fontWeight: typeScale.bodyMedium.fontWeight, color: color.textInverse },

  downloadBtn: {
    flexDirection: 'row', gap: space.sm, backgroundColor: color.accent, minHeight: 52, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', marginTop: space.xxl,
  },
  downloadBtnText: { ...typeScale.bodyMedium, fontSize: 16, color: color.textInverse },
});
