import React, { useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import { View, Text, TextInput, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { useAuthStore } from '../../store/authStore';
import { addReminder } from '../../services/database/reminderDb';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { DateField } from '../../components/ui/DateField';
import { todayDate } from '../../utils/dates';
import { Icon, Button, IconName } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

type Props = StackScreenProps<any, any>;

const REMINDER_TYPES: { id: string; label: string; icon: IconName }[] = [
  { id: 'payment', label: 'Payment', icon: 'dollar-sign' },
  { id: 'invoice', label: 'Invoice', icon: 'file-text' },
  { id: 'rent', label: 'Rent', icon: 'home' },
  { id: 'utility', label: 'Utility', icon: 'zap' },
  { id: 'low_stock', label: 'Low stock', icon: 'package' },
  { id: 'backup', label: 'Backup', icon: 'hard-drive' },
];

export const AddReminderScreen: React.FC<Props> = ({ navigation }) => {
  const user = useAuthStore(state => state.user);
  const { t } = useLanguageStore();
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<any>('payment');
  
  const [dueDate, setDueDate] = useState(todayDate());

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert(t('remTitleNeededTitle'), t('remTitleNeeded'));
      return;
    }
    if (!user) return;

    try {
      await addReminder({
        user_id: user.id,
        title: title.trim(),
        description: description.trim() || null,
        type,
        due_date: dueDate
      });
      navigation.goBack();
    } catch (err) {
      Alert.alert(t('commonError'), t('remSaveFailed'));
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('remNewTitle')}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScreenContainer scrollable={true} hasTabBar={true} contentContainerStyle={styles.content}>
        <View style={styles.field}>
          <Text style={styles.label}>{t('remTitleLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('remTitlePlaceholder')}
            placeholderTextColor={color.textMuted}
            value={title}
            onChangeText={setTitle}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t('commonCategory')}</Text>
          <View style={styles.types}>
            {REMINDER_TYPES.map(rt => {
              const active = type === rt.id;
              return (
                <TouchableOpacity
                  key={rt.id}
                  onPress={() => setType(rt.id)}
                  style={[styles.typeBtn, active && styles.typeBtnActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Icon name={rt.icon} size={iconSize.sm} tint={active ? color.textInverse : color.textSecondary} />
                  <Text style={[styles.typeText, active && styles.typeTextActive]}>{rt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t('remDueDate')}</Text>
          <DateField style={styles.input} textStyle={styles.inputText} value={dueDate} onChange={setDueDate} />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t('poNotesLabel')}</Text>
          <TextInput
            style={[styles.input, styles.notes]}
            placeholder={t('remNotesPlaceholder')}
            placeholderTextColor={color.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            textAlignVertical="top"
          />
        </View>

        <Button label={t('remSave')} icon="bell" onPress={handleSave} fullWidth style={styles.save} />
      </ScreenContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },
  content: { paddingHorizontal: space.lg, paddingTop: space.xl },
  field: { marginBottom: space.xl },
  label: { ...typeScale.label, color: color.textSecondary, marginBottom: space.sm },
  input: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border, borderRadius: radius.md,
    paddingHorizontal: space.lg, minHeight: 48, justifyContent: 'center', ...typeScale.body, color: color.textPrimary,
  },
  inputText: { ...typeScale.body, color: color.textPrimary },
  notes: { minHeight: 100, paddingTop: space.md },
  types: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  typeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touchTarget, flexBasis: '48%', flexGrow: 1,
    paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: hairline, borderColor: color.borderStrong, backgroundColor: color.surface,
  },
  typeBtnActive: { backgroundColor: color.accent, borderColor: color.accent },
  typeText: { ...typeScale.bodyMedium, color: color.textPrimary },
  typeTextActive: { color: color.textInverse },
  save: { minHeight: 52, marginBottom: space.xxxl },
});
