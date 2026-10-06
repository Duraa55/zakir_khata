import React, { useCallback, useState } from 'react';
import { categoryLabel } from '../../i18n/categoryLabel';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import { getExpenseById } from '../../services/database/expenseDb';
import { formatDisplayDate } from '../../utils/dates';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { useAttachmentOpener } from '../../components/ui/AttachmentViewer';
import { Icon, AmountText } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

export const ExpenseDetail = ({ route, navigation }: any) => {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  // Re-read on focus so an edit made from here shows as soon as you come back.
  const [expense, setExpense] = useState<any>(route.params?.expense);
  useFocusEffect(useCallback(() => {
    const id = route.params?.expense?.id;
    if (id) getExpenseById(id).then(e => { if (e) setExpense(e); }).catch(() => {});
  }, [route.params?.expense?.id]));
  // One shared opener: images preview in-app, other files go to the phone, a missing
  // file says so — the same behaviour in every book.
  const { openAttachment, attachmentViewer } = useAttachmentOpener();

  if (!expense) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
            <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('expenseDetailTitle')}</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.center}>
          <Text style={styles.emptyText}>{t('expenseNotFound')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('expenseDetailTitle')}</Text>
        {/* Only the person who recorded it may edit it (enforced again in expenseDb). */}
        {expense.user_id === user?.id ? (
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.navigate('AddExpenseModal', { expense })} accessibilityRole="button" accessibilityLabel={t('expenseEditAction')}>
            <Icon name="edit-2" size={iconSize.md} tint={color.accent} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
      </View>

      <ScreenContainer scrollable={true} hasTabBar={true} contentContainerStyle={styles.content}>

        {/* Main Details Card — an expense is money out, so its amount is red. */}
        <View style={styles.card}>
          <View style={styles.amountWrap}>
            <AmountText paisa={expense.amount} tone="out" size="hero" fit currency={expense.currency} />
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>{t('expenseDescriptionLabel')}</Text>
            <Text style={styles.value}>{expense.description}</Text>
          </View>

          {!!expense.category && (
            <View style={styles.row}>
              <Text style={styles.label}>{t('commonCategory')}</Text>
              <Text style={styles.value}>{categoryLabel(t, expense.category)}</Text>
            </View>
          )}

          <View style={[styles.row, styles.rowLast]}>
            <Text style={styles.label}>{t('commonDate')}</Text>
            <Text style={styles.value}>{formatDisplayDate(String(expense.expense_date).slice(0, 10))}</Text>
          </View>
        </View>

        {/* Note Card */}
        {expense.note ? (
          <View style={[styles.card, styles.cardSpaced]}>
            <Text style={styles.sectionTitle}>{t('commonNote')}</Text>
            <Text style={styles.noteText}>{expense.note}</Text>
          </View>
        ) : null}

        {/* Receipt Card */}
        {expense.receipt_url ? (
          <View style={[styles.card, styles.cardSpaced]}>
            <Text style={styles.sectionTitle}>{t('expenseReceipt')}</Text>
            <TouchableOpacity
              style={styles.receiptPlaceholder}
              onPress={() => openAttachment(expense.receipt_url)}
              activeOpacity={0.8}
            >
              <Image
                source={{ uri: expense.receipt_url }}
                style={styles.receiptImage}
              />
              <View style={styles.viewHint}>
                <Icon name="maximize-2" size={iconSize.sm} tint={color.textPrimary} />
                <Text style={styles.viewHintText}>{t('entryTapToView')}</Text>
              </View>
            </TouchableOpacity>
          </View>
        ) : null}


      </ScreenContainer>
      {attachmentViewer}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: color.surface, paddingHorizontal: space.md, minHeight: 56,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { ...typeScale.body, color: color.textSecondary },
  content: { padding: space.lg },

  card: {
    backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg,
    borderWidth: hairline, borderColor: color.border,
  },
  cardSpaced: { marginTop: space.md },
  amountWrap: { alignItems: 'center', marginBottom: space.lg },

  divider: { height: hairline, backgroundColor: color.border, marginBottom: space.lg },

  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.lg, marginBottom: space.md },
  rowLast: { marginBottom: 0 },
  label: { ...typeScale.body, color: color.textSecondary, flexShrink: 0 },
  value: { ...typeScale.bodyMedium, color: color.textPrimary, flex: 1, textAlign: 'right' },

  sectionTitle: { ...typeScale.bodyMedium, color: color.textPrimary, marginBottom: space.sm },
  noteText: { ...typeScale.body, color: color.textSecondary, lineHeight: 20 },

  receiptPlaceholder: {
    backgroundColor: color.surfaceRaised, minHeight: 150, borderRadius: radius.sm,
    justifyContent: 'center', alignItems: 'center', borderWidth: hairline,
    borderColor: color.border,
  },
  receiptImage: { width: '100%', height: 200, borderRadius: radius.sm, resizeMode: 'cover' },
  viewHint: {
    position: 'absolute', right: space.sm, bottom: space.sm,
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.pill,
    backgroundColor: color.surface, borderWidth: hairline, borderColor: color.border,
  },
  viewHintText: { ...typeScale.caption, color: color.textPrimary },
});
