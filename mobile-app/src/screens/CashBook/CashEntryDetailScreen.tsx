import React, { useState } from 'react';
import { categoryLabel } from '../../i18n/categoryLabel';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView, Image
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useTransactionStore } from '../../store/transactionStore';
import { deleteCashEntry } from '../../services/database/cashbookDb';
import { CashEntry } from '../../types';
import { Icon, AmountText } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';
import { useAttachmentOpener } from '../../components/ui/AttachmentViewer';

interface Props {
  navigation: any;
  route: {
    params: {
      entry: CashEntry;
      /** Opened from a staff member's Entries: no Edit, no Delete. */
      readOnly?: boolean;
    };
  };
}

export const CashEntryDetailScreen = ({ navigation, route }: Props) => {
  const insets = useSafeAreaInsets();
  // One shared opener: images preview in-app, other files go to the phone, a missing
  // file says so — the same behaviour in every book.
  const { openAttachment, attachmentViewer } = useAttachmentOpener();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { loadCashBook } = useTransactionStore();
  const [deleting, setDeleting] = useState(false);

  const entry = route?.params?.entry;
  // Opened from a staff member's Entries: look, never change.
  const readOnly = !!route?.params?.readOnly;

  if (!entry) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation?.goBack?.()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
            <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('entryDetailTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={[styles.container, styles.centered]}>
          <Text style={styles.emptyText}>{t('entryNoneSelected')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isIn = entry.direction === 'in';
  const category = entry.category?.trim() || '';
  const note = entry.note?.trim() || '';
  // Honest about backup: this app is push-only and often runs without the cloud
  // configured, so "backed up" is shown only when the row actually synced.
  const isBackedUp = (entry as any).synced === 1 || entry.syncStatus === 'synced';

  const formatDetailDateTime = (dateStr?: string, createdAt?: string) => {
    const ts = createdAt || dateStr;
    if (!ts) return '';
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return dateStr || '';
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNum = d.getDate().toString().padStart(2, '0');
      const monthName = d.toLocaleDateString('en-US', { month: 'short' });
      const yearShort = d.getFullYear().toString().slice(-2);
      const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      return `${dayName}, ${dayNum} ${monthName} ${yearShort} • ${timeStr}`;
    } catch {
      return dateStr || '';
    }
  };

  const handleEdit = () => {
    navigation.navigate('EditCashEntryModal', {
      mode: entry.direction,
      entry: entry,
    });
  };

  const handleDelete = () => {
    Alert.alert(t('entryDelete'), t('entryDeleteConfirm'), [
      { text: t('commonCancel'), style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!user) return;
          setDeleting(true);
          try {
            await deleteCashEntry(entry.id, user.id);
            await loadCashBook(user.id);
            navigation.goBack();
          } catch (err) {
            Alert.alert(t('commonError'), t('entryDeleteFailed'));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('entryDetailTitle')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.containerContent,
          { paddingBottom: readOnly ? space.xxl : space.xxl + 72 },
        ]}
        showsVerticalScrollIndicator={true}
      >
        {/* Entry card — the amount is coloured by meaning: green in, red out. */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.leftMeta}>
              <View style={[styles.circleIcon, { borderColor: isIn ? color.moneyIn : color.moneyOut }]}>
                <Icon name={isIn ? 'arrow-down-left' : 'arrow-up-right'} size={iconSize.md} tint={isIn ? color.moneyIn : color.moneyOut} />
              </View>
              {/* flex: 1 so a long date line wraps before it squeezes the amount */}
              <View style={styles.metaText}>
                <Text style={styles.directionTitle}>{isIn ? 'Cash in' : 'Cash out'}</Text>
                <Text style={styles.dateSubText}>{formatDetailDateTime(entry.date, entry.createdAt)}</Text>
              </View>
            </View>

            <AmountText paisa={entry.amount_paisa || 0} tone={isIn ? 'in' : 'out'} size="title" />
          </View>

          {!!entry.description && (
            <View style={styles.descWrap}>
              <Text style={styles.descText}>{entry.description}</Text>
            </View>
          )}

          {/* Category and note (columns since v30). An empty value hides its row —
              never a label with nothing beside it. */}
          {(!!category || !!note) && (
            <View style={styles.fieldList}>
              {!!category && (
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>{t('commonCategory')}</Text>
                  <Text style={styles.fieldValue}>{categoryLabel(t, category)}</Text>
                </View>
              )}
              {!!note && (
                <View style={[styles.fieldRow, !!category && styles.fieldRowDivided]}>
                  <Text style={styles.fieldLabel}>{t('commonNote')}</Text>
                  <Text style={styles.fieldValue}>{note}</Text>
                </View>
              )}
            </View>
          )}

          {!!entry.attachment_url && (
            <View style={styles.attachmentWrap}>
              <Text style={styles.attachmentLabel}>{t('entryAttachment')}</Text>
              <TouchableOpacity onPress={() => openAttachment(entry.attachment_url)} activeOpacity={0.85} accessibilityRole="imagebutton">
                <Image source={{ uri: entry.attachment_url }} style={styles.attachmentImage} resizeMode="cover" />
                <View style={styles.viewHint}>
                  <Icon name="maximize-2" size={iconSize.sm} tint={color.textPrimary} />
                  <Text style={styles.viewHintText}>{t('entryTapToView')}</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

          {/* EDIT ENTRY button — never offered on someone else's entry (read-only drill-down) */}
          {!readOnly && (
          <TouchableOpacity style={styles.editBtn} onPress={handleEdit} accessibilityRole="button">
            <Icon name="edit-2" size={iconSize.sm} tint={color.accent} />
            <Text style={styles.editText}>{t('entryEdit')}</Text>
          </TouchableOpacity>
          )}
        </View>

        {/* Where the entry lives */}
        <View style={styles.backupCard}>
          <Icon name={isBackedUp ? 'check-circle' : 'smartphone'} size={iconSize.md} tint={color.textSecondary} />
          <Text style={styles.backupText}>{isBackedUp ? 'Backed up' : 'Saved on this phone'}</Text>
        </View>
      </ScrollView>

      {/* Bottom Fixed Action: Delete — pinned to the bottom edge of the screen. */}
      {!readOnly && (
      <View style={[styles.bottomContainer, { marginBottom: 0 }]}>
        <TouchableOpacity style={styles.deleteOutlineBtn} onPress={handleDelete} disabled={deleting} accessibilityRole="button">
          {deleting ? (
            <ActivityIndicator color={color.moneyOut} />
          ) : (
            <>
              <Icon name="trash-2" size={iconSize.sm} tint={color.moneyOut} />
              <Text style={styles.deleteBtnText}>{t('entryDelete')}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
      )}
      {attachmentViewer}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: color.surface, paddingHorizontal: space.md, height: 56,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },

  container: { flex: 1, backgroundColor: color.surfaceRaised },
  containerContent: { padding: space.lg, gap: space.md },
  centered: { justifyContent: 'center', alignItems: 'center' },
  emptyText: { ...typeScale.body, color: color.textSecondary },

  card: {
    backgroundColor: color.surface, borderRadius: radius.lg,
    borderWidth: hairline, borderColor: color.border,
    padding: space.lg,
  },
  cardHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md,
  },
  leftMeta: { flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1 },
  circleIcon: {
    width: 44, height: 44, borderRadius: radius.pill, borderWidth: hairline,
    backgroundColor: color.surface, justifyContent: 'center', alignItems: 'center',
  },
  metaText: { flex: 1 },
  directionTitle: { ...typeScale.bodyMedium, color: color.textPrimary },
  dateSubText: { ...typeScale.caption, color: color.textSecondary, marginTop: 2 },

  descWrap: {
    backgroundColor: color.surfaceRaised, padding: space.md, borderRadius: radius.sm,
    marginTop: space.lg, borderWidth: hairline, borderColor: color.border,
  },
  descText: { ...typeScale.body, color: color.textPrimary },

  fieldList: {
    marginTop: space.lg, borderRadius: radius.sm,
    borderWidth: hairline, borderColor: color.border, paddingHorizontal: space.md,
  },
  fieldRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.md },
  fieldRowDivided: { borderTopWidth: hairline, borderTopColor: color.border },
  fieldLabel: { ...typeScale.label, color: color.textSecondary, flexShrink: 0, minWidth: 72 },
  fieldValue: { ...typeScale.body, color: color.textPrimary, flex: 1, textAlign: 'right' },

  attachmentWrap: { marginTop: space.lg },
  attachmentLabel: { ...typeScale.label, color: color.textSecondary, marginBottom: space.sm },
  attachmentImage: {
    width: '100%', height: 220, borderRadius: radius.md,
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
  },
  viewHint: {
    position: 'absolute', right: space.sm, bottom: space.sm,
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.pill,
    backgroundColor: color.surface, borderWidth: hairline, borderColor: color.border,
  },
  viewHintText: { ...typeScale.caption, color: color.textPrimary },

  editBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.sm,
    minHeight: touchTarget, marginTop: space.lg,
    borderTopWidth: hairline, borderTopColor: color.border, paddingTop: space.md,
  },
  editText: { ...typeScale.bodyMedium, color: color.accent },

  backupCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: color.surface, borderRadius: radius.lg,
    borderWidth: hairline, borderColor: color.border,
    padding: space.lg,
  },
  backupText: { ...typeScale.body, color: color.textSecondary, flex: 1 },

  bottomContainer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    backgroundColor: color.surface, borderTopWidth: hairline, borderTopColor: color.border,
  },
  deleteOutlineBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.sm,
    minHeight: touchTarget + 4, borderRadius: radius.md, borderWidth: hairline, borderColor: color.moneyOut,
    backgroundColor: color.surface,
  },
  deleteBtnText: { ...typeScale.bodyMedium, color: color.moneyOut },
});
