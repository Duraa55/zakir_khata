import React, { useState, useEffect } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { categoryLabel } from '../../i18n/categoryLabel';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Platform, Image, Keyboard
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../store/authStore';
import { useActivityStore } from '../../store/useActivityStore';
import { useExpenseStore } from '../../store/useExpenseStore';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { Icon, Button } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';
import { rupeesToPaisa, paisaToRupeesString } from '../../utils/calculations';
import { persistAttachment } from '../../utils/durableFile';
import { evaluateExpression } from '../../utils/safeCalc';
import { DateField } from '../../components/ui/DateField';
import { todayDate } from '../../utils/dates';
import { CurrencyPicker } from '../../components/ui/CurrencyPicker';
import { resolveCurrency, type CurrencyCode } from '../../utils/currency';

export const AddExpenseModal = ({ navigation, route }: any) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { addExpense, updateExpense, fetchExpenses, loadMonthlyTotal } = useExpenseStore();
  const { logActivity } = useActivityStore();
  // Opened from Expense detail → Edit: this exact expense, saved IN PLACE.
  const editing = route?.params?.expense;
  const isEdit = !!editing?.id;
  // Opens on the account default EVERY time — never the last currency used. On an edit
  // it opens on what that expense was actually entered in, so saving cannot relabel it.
  const [currency, setCurrency] = useState<CurrencyCode>(
    isEdit ? resolveCurrency(editing?.currency).code : resolveCurrency(user?.defaultCurrency).code
  );

  const [amountStr, setAmountStr] = useState(isEdit ? paisaToRupeesString(editing.amount) : '');
  const [description, setDescription] = useState(isEdit ? editing.description || '' : '');
  const [note, setNote] = useState(isEdit ? editing.note || '' : '');
  const [date, setDate] = useState(isEdit && editing.expense_date ? String(editing.expense_date).slice(0, 10) : todayDate());
  const [category, setCategory] = useState(isEdit ? editing.category || '' : '');
  const [receiptUrl, setReceiptUrl] = useState<string | null>(isEdit ? editing.receipt_url || null : null);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setIsKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setIsKeyboardVisible(false)
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const CATEGORIES = [
    'Rent', 'Electricity', 'Salary', 'Fuel', 'Internet',
    'Transport', 'Maintenance', 'Marketing', 'Miscellaneous'
  ];

  const handleCalculatorPress = (val: string) => {
    if (val === 'AC') {
      setAmountStr('');
    } else if (val === '←' || val === '✕') {
      setAmountStr(p => p.slice(0, -1));
    } else if (val === '=') {
      const result = evaluateExpression(amountStr);
      if (result.ok) {
        setAmountStr(String(result.value));
      } else {
        setAmountStr('Error');
        setTimeout(() => setAmountStr(''), 1000);
      }
    } else {
      if (amountStr === '0' && val !== '.') {
        setAmountStr(val);
      } else {
        setAmountStr(p => p + val);
      }
    }
  };

  const handlePickReceipt = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
    });

    if (!result.canceled && result.assets[0].uri) {
      setReceiptUrl(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    // Always evaluate the display as an expression. Never parseFloat it: that read
    // "12+5" as 12 and silently saved the wrong amount whenever the user hadn't
    // pressed "=" first. Going through the evaluator makes that impossible.
    const calc = evaluateExpression(amountStr);
    if (!calc.ok) {
      Alert.alert(t('commonAmountInvalid'), t('expenseFinishCalculation'));
      return;
    }
    const finalAmount = calc.value;

    if (finalAmount <= 0) {
      Alert.alert(t('commonError'), t('commonAmountInvalid'));
      return;
    }

    if (!description.trim()) {
      Alert.alert(t('commonError'), t('expenseDescriptionRequired'));
      return;
    }

    if (!user) return;

    // expenses.amount is stored as integer paisa.
    // A calculator result like 100/3 has more than two decimals; round it to paisa first.
    const amountPaisa = rupeesToPaisa(finalAmount.toFixed(2));
    if (amountPaisa === null) {
      Alert.alert(t('commonError'), t('commonAmountInvalid'));
      return;
    }

    try {
      // Durable copy first — the picker's cache path can vanish (see durableFile.ts).
      const durableReceipt = receiptUrl ? await persistAttachment('expense', receiptUrl) : undefined;
      if (isEdit) {
        await updateExpense(editing.id, user.id, {
          amount: amountPaisa,
          currency,
          description: description.trim(),
          category: category.trim() || undefined,
          note: note.trim() || undefined,
          receipt_url: durableReceipt,
          expense_date: date,
        });
        await loadMonthlyTotal(user.id);
        Alert.alert(t('commonSaved'), t('expenseSaved'), [{ text: t('commonOk'), onPress: () => navigation.goBack() }]);
        return;
      }
      await addExpense({
        user_id: user.id,
        amount: amountPaisa,
        currency,
        description: description.trim(),
        category: category.trim() || undefined,
        note: note.trim() || undefined,
        receipt_url: durableReceipt,
        expense_date: date,
      });

      // Refresh parent data
      await fetchExpenses(user.id);
      await loadMonthlyTotal(user.id);

      // Log Activity
      await logActivity({
        user_id: user.id,
        user_name: user.name || 'User',
        action: 'create',
        entity_type: 'expense',
        description: `added an expense for ${description.trim()}`,
        amount: amountPaisa
      });

      Alert.alert(t('commonSuccess'), t('expenseSaved'), [
        { text: t('commonOk'), onPress: () => navigation.goBack() }
      ]);
    } catch (err: any) {
      if (__DEV__) console.error(err);
      Alert.alert(t('commonError'), isEdit && err?.message ? err.message : t('commonSaveFailed'));
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t(isEdit ? 'expenseEdit' : 'expenseAdd')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScreenContainer scrollable={true} hasTabBar={true}>
        <View style={styles.formContainer}>
            {/* Amount */}
            <View style={styles.amountBox}>
              <CurrencyPicker value={currency} onChange={setCurrency} style={styles.currencyChip} />
              <TextInput
                style={styles.amountInput}
                value={amountStr}
                placeholder="0"
                placeholderTextColor={color.textMuted}
                editable={false} // Managed by custom calculator below
              />
              <TouchableOpacity onPress={() => handleCalculatorPress('AC')} style={styles.clearBtn} accessibilityRole="button" accessibilityLabel={t('commonClearAmount')}>
                <Icon name="x" size={iconSize.md} tint={color.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Receipt & Date */}
            <View style={styles.receiptDateRow}>
              <TouchableOpacity style={[styles.receiptBtn, receiptUrl ? styles.receiptBtnFilled : null]} onPress={handlePickReceipt}>
                {receiptUrl ? (
                  <Image source={{ uri: receiptUrl }} style={styles.receiptThumb} />
                ) : (
                  <Icon name="camera" size={iconSize.md} tint={color.accent} />
                )}
                <Text style={styles.receiptText} numberOfLines={1}>
                  {t(receiptUrl ? 'expenseChangeReceipt' : 'expenseAttachReceipt')}
                </Text>
              </TouchableOpacity>

              <View style={[styles.fieldWrap, styles.dateWrap]}>
                <DateField
                  style={styles.input}
                  value={date}
                  onChange={setDate}
                />
              </View>
            </View>

            {/* Description */}
            <View style={[styles.fieldWrap, styles.spaced]}>
              <TextInput
                style={styles.input}
                placeholder={t('expenseDescriptionPlaceholder')}
                placeholderTextColor={color.textMuted}
                value={description}
                onChangeText={setDescription}
                maxLength={50}
              />
            </View>

            {/* Category Dropdown (Chips) */}
            <View style={[styles.fieldWrap, styles.spaced]}>
              <Text style={styles.fieldLabel}>{t('commonCategory')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.chip, category === cat && styles.chipActive]}
                    onPress={() => setCategory(cat)}
                  >
                    <Text style={[styles.chipText, category === cat && styles.chipTextActive]}>{categoryLabel(t, cat)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Note */}
            <View style={[styles.fieldWrap, styles.spaced]}>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder={t('expenseNotePlaceholder')}
                placeholderTextColor={color.textMuted}
                value={note}
                onChangeText={setNote}
                multiline
                numberOfLines={4}
              />
            </View>

            {/* Save Button */}
            <Button label={t(isEdit ? 'commonSaveChanges' : 'expenseSave')} onPress={handleSave} fullWidth style={styles.saveBtn} />
          </View>
        </ScreenContainer>

        {/* Persistent Calculator Keypad at Bottom */}
        {!isKeyboardVisible && (
          <View style={[styles.calculator, { paddingBottom: space.lg + Math.max(insets.bottom, space.sm) }]}>
            {/* M+ and M- were dead keys: neither had a branch in handleCalculatorPress, so
                they fell through to the digit case and typed themselves into the amount,
                which then failed to evaluate. Removed. Their two cells stay empty rather
                than reflowing the grid, so ÷ keeps its column above × - + and AC keeps its
                width — an AC spanning the gap sits right above the digits and would turn a
                mistyped 7 into a cleared amount. */}
            {[
              ['AC', null, null, '÷'],
              ['7', '8', '9', '×'],
              ['4', '5', '6', '-'],
              ['1', '2', '3', '+'],
              ['.', '0', '←', '=']
            ].map((row, rIdx) => (
              <View key={rIdx} style={styles.calcRow}>
                {row.map((btn, cIdx) => {
                  if (!btn) return <View key={`gap${cIdx}`} style={styles.calcBtn} />;
                  const isOp = ['AC','÷','×','-','+','=','←'].includes(btn);
                  return (
                    <TouchableOpacity
                      key={btn}
                      style={[styles.calcBtn, isOp ? styles.calcBtnOp : styles.calcBtnNum]}
                      onPress={() => handleCalculatorPress(btn)}
                    >
                      {btn === '←'
                        ? <Icon name="delete" size={iconSize.md} tint={color.accent} />
                        : <Text style={[styles.calcBtnText, isOp && styles.calcBtnTextOp]}>{btn}</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        )}

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

  formContainer: { padding: space.lg },

  amountBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingLeft: space.md, minHeight: 56,
  },
  currencyChip: { marginRight: space.sm },
  // Expense is money out, but the amount is still being typed — neutral ink until saved.
  amountInput: { ...typeScale.title, fontSize: 24, flex: 1, color: color.textPrimary },
  clearBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },

  receiptDateRow: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  receiptBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    backgroundColor: color.surface, borderWidth: hairline, borderColor: color.borderStrong,
    borderRadius: radius.md, minHeight: 50, paddingHorizontal: space.sm,
  },
  receiptBtnFilled: { borderColor: color.accent },
  receiptThumb: { width: 36, height: 36, borderRadius: radius.sm },
  receiptText: { ...typeScale.bodyMedium, color: color.accent, flexShrink: 1 },
  dateWrap: { flex: 1, marginBottom: 0 },
  spaced: { marginTop: space.lg },

  fieldWrap: { marginBottom: space.lg },
  fieldLabel: { ...typeScale.bodyMedium, color: color.textPrimary, marginBottom: space.sm },
  input: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 50,
    ...typeScale.body, color: color.textPrimary,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top', paddingTop: space.md },

  chip: {
    backgroundColor: color.surface, borderWidth: hairline, borderColor: color.borderStrong,
    paddingHorizontal: space.md, minHeight: touchTarget, justifyContent: 'center',
    borderRadius: radius.pill, marginRight: space.sm,
  },
  chipActive: { backgroundColor: color.accent, borderColor: color.accent },
  chipText: { ...typeScale.label, color: color.textSecondary },
  chipTextActive: { color: color.textInverse, fontWeight: typeScale.bodyMedium.fontWeight },

  saveBtn: { minHeight: 50, marginTop: space.sm, marginBottom: space.lg },

  calculator: {
    backgroundColor: color.surfaceRaised, borderTopWidth: hairline, borderTopColor: color.border,
    padding: space.sm,
  },
  calcRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.xs },
  calcBtn: {
    flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center',
    marginHorizontal: 3, borderRadius: radius.sm,
  },
  calcBtnNum: { backgroundColor: color.surface, borderWidth: hairline, borderColor: color.border },
  calcBtnOp: { backgroundColor: color.surfacePressed, borderWidth: hairline, borderColor: color.border },
  calcBtnText: { ...typeScale.title, fontSize: 18, fontWeight: typeScale.body.fontWeight, color: color.textPrimary },
  calcBtnTextOp: { fontWeight: typeScale.bodyMedium.fontWeight, color: color.accent },
});
