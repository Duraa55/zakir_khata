import { useLanguageStore } from '../../store/useLanguageStore';
import type { TKey } from '../../i18n/en';
import { formatDisplayDate } from '../../utils/dates';
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { EntryAuditRow, getEntryHistory } from '../../services/database/entryAuditDb';
import { formatCurrency } from '../../utils/calculations';
import { Icon } from './primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

export function groupAuditRows(rows: EntryAuditRow[]): EntryAuditRow[][] {
  const groups = new Map<string, EntryAuditRow[]>();
  for (const row of rows) {
    const group = groups.get(row.change_group_id) || [];
    group.push(row);
    groups.set(row.change_group_id, group);
  }
  return [...groups.values()];
}
const labels: Record<string, TKey> = { amount_paisa: 'amount', partyName: 'partyName', notes: 'note', date: 'date', type: 'type', isDeleted: 'deleted' };
function valueText(json: string, kind: EntryAuditRow['value_kind'], t: ReturnType<typeof useLanguageStore.getState>['t']): string {
  const value = JSON.parse(json);
  if (value === null || value === '') return t('empty');
  if (kind === 'money_paisa') return formatCurrency(value);
  if (kind === 'date') return formatDisplayDate(String(value));
  if (kind === 'boolean') return value ? t('yes') : t('no');
  return String(value);
}
export const AuditFields = ({ rows }: { rows: EntryAuditRow[] }) => {
  const { t } = useLanguageStore();
  return <>{rows.map(row => <View key={row.id} style={styles.fieldLine}>
    <Text style={styles.fieldLabel}>{labels[row.field_name] ? t(labels[row.field_name]) : row.field_name}: </Text>
    <Text style={styles.fieldOld}>{valueText(row.old_value_json, row.value_kind, t)}</Text>
    <Text style={styles.fieldArrow}> → </Text>
    <Text style={styles.fieldNew}>{valueText(row.new_value_json, row.value_kind, t)}</Text>
  </View>)}</>;
};

type Props = { table: string; entryId: string; visible: boolean; onClose: () => void };
export const EntryHistoryModal = ({ table, entryId, visible, onClose }: Props) => {
  const { t } = useLanguageStore();
  const userId = useAuthStore(s => s.user?.id);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getEntryHistory>> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setHistory(null);
    setError('');
    if (visible) {
      setLoading(true);
      getEntryHistory(table, entryId).then(result => { if (active) setHistory(result); })
        .catch(e => { if (active) setError(e?.message || t('historyFailed')); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [table, entryId, visible, userId]);
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('entryHistory')}</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button">
          <Text style={styles.closeText}>{t('close')}</Text>
        </TouchableOpacity>
      </View>
      {loading ? <ActivityIndicator style={styles.spinner} color={color.accent} /> : error ? <Text style={styles.error}>{error}</Text> : history && <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.entryTitle}>{String(history.entry.partyName || t('khataEntry'))}</Text>
          <View style={styles.entryLine}>
            <Text style={styles.entryText}>{formatCurrency(Number(history.entry.amount_paisa))}</Text>
            <Text style={styles.entryText}> · </Text>
            <Text style={styles.entryText}>{formatDisplayDate(String(history.entry.date))}</Text>
          </View>
          <Text style={styles.entryText}>{history.entry.type === 'lena' || history.entry.type === 'dena' ? t(history.entry.type) : String(history.entry.type)} · {String(history.entry.notes || t('emptyNote'))}</Text>
          <Text style={styles.entryState}>{history.entry.isDeleted || history.entry.is_deleted ? t('deletedKept') : t('currentEntry')}</Text>
        </View>
        {!history.rows.length && <Text style={styles.noChanges}>{t('noChanges')}</Text>}
        {groupAuditRows(history.rows).map(rows => <View key={rows[0].change_group_id} style={styles.card}>
          <Text style={styles.eventTitle}>{t(rows[0].action === 'deleted' ? 'deletedEvent' : 'editedEvent', { name: rows[0].actor_name })}</Text>
          <Text style={styles.eventTime}>{formatDisplayDate(rows[0].changed_at)} {new Date(rows[0].changed_at).toLocaleTimeString('en-PK')}</Text>
          <AuditFields rows={rows} />
        </View>)}
      </ScrollView>}
    </SafeAreaView>
  </Modal>;
};

export const EntryHistoryMarker = ({ entryId }: { entryId: string }) => {
  const { t } = useLanguageStore();
  const userId = useAuthStore(s => s.user?.id);
  const [visible, setVisible] = useState(false);
  const [hasHistory, setHasHistory] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setHasHistory(false);
    setError('');
    getEntryHistory('transactions', entryId).then(h => { if (active) setHasHistory(h.rows.length > 0); })
      .catch(e => { if (active) setError(e?.message || t('historyFailed')); });
    return () => { active = false; };
  }, [entryId, userId]);
  if (!hasHistory && !error) return null;
  return <View style={styles.marker}>
    <TouchableOpacity onPress={() => error ? Alert.alert(t('entryHistory'), error) : setVisible(true)} style={styles.markerBtn} accessibilityRole="button">
      <Icon name="clock" size={iconSize.sm} tint={error ? color.attention : color.accent} />
      <Text style={[styles.markerText, !!error && styles.markerTextError]}>{error ? t('historyUnavailable') : t('editedHistory')}</Text>
    </TouchableOpacity>
    <EntryHistoryModal table="transactions" entryId={entryId} visible={visible} onClose={() => setVisible(false)} />
  </View>;
};

const styles = StyleSheet.create({
  fieldLine: { flexDirection: 'row', flexWrap: 'wrap' },
  fieldLabel: { ...typeScale.body, fontSize: 14, lineHeight: 22, color: color.textSecondary },
  fieldOld: { ...typeScale.body, fontSize: 14, lineHeight: 22, color: color.textMuted },
  fieldArrow: { ...typeScale.body, fontSize: 14, lineHeight: 22, color: color.textMuted },
  fieldNew: { ...typeScale.bodyMedium, fontSize: 14, lineHeight: 22, color: color.textPrimary },
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingLeft: space.lg, paddingRight: space.sm, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1 },
  closeBtn: { minHeight: touchTarget, paddingHorizontal: space.md, justifyContent: 'center' },
  closeText: { ...typeScale.bodyMedium, color: color.accent },
  spinner: { margin: space.xxl },
  error: { ...typeScale.body, padding: space.lg, color: color.attention },
  content: { padding: space.md },
  card: {
    backgroundColor: color.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.sm,
    borderWidth: hairline, borderColor: color.border,
  },
  entryTitle: { ...typeScale.bodyMedium, fontSize: 16, color: color.textPrimary },
  entryLine: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.xs },
  entryText: { ...typeScale.body, color: color.textPrimary },
  entryState: { ...typeScale.label, color: color.textSecondary, marginTop: space.xs },
  noChanges: { ...typeScale.body, color: color.textSecondary, padding: space.md },
  eventTitle: { ...typeScale.bodyMedium, color: color.textPrimary, marginBottom: space.xs },
  eventTime: { ...typeScale.caption, color: color.textMuted, marginBottom: space.sm },
  marker: { marginBottom: space.lg },
  markerBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: touchTarget },
  markerText: { ...typeScale.bodyMedium, fontSize: 13, color: color.accent },
  markerTextError: { color: color.attention },
});
