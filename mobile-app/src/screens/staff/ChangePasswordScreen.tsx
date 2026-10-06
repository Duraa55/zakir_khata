import React, { useState } from 'react';
import { useLanguageStore } from '../../store/useLanguageStore';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { changeOwnPassword, accountPasswordProblem } from '../../services/database/userDb';
import { useAuthStore } from '../../store/authStore';
import { Icon, Button } from '../../components/ui/primitives';
import { color, space, radius, hairline, touchTarget, iconSize, type as typeScale } from '../../theme/tokens';

/**
 * Change your own password. The current password is required, and the new one must
 * meet the same rule as account creation (8+ characters, a capital, a number) — it
 * used to accept any 6 characters without asking who you were.
 */
export const ChangePasswordScreen = ({ navigation }: any) => {
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUpdate = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert(t('cpMissingTitle'), t('cpMissing'));
      return;
    }
    const problem = accountPasswordProblem(newPassword);
    if (problem) {
      Alert.alert(t('cpWeakTitle'), problem + '.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert(t('cpMismatchTitle'), t('cpMismatch'));
      return;
    }
    if (!user) return;

    Alert.alert(t('cpConfirmTitle'), t('cpConfirm'), [
      { text: t('commonCancel'), style: 'cancel' },
      {
        text: 'Update',
        onPress: async () => {
          setLoading(true);
          try {
            await changeOwnPassword(user.id, currentPassword, newPassword);
            Alert.alert(t('cpDoneTitle'), t('cpDone'), [
              { text: 'OK', onPress: () => navigation.goBack() }
            ]);
          } catch (e: any) {
            if (__DEV__) console.error(e);
            Alert.alert(t('commonError'), e?.message || t('cpFailed'));
          } finally {
            setLoading(false);
          }
        }
      }
    ]);
  };

  const Field = ({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) => (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={color.textMuted}
        secureTextEntry
        autoCapitalize="none"
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('commonBack')}>
          <Icon name="chevron-left" size={iconSize.lg} tint={color.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('cpTitle')}</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <View style={styles.infoBox}>
            <Icon name="lock" size={iconSize.sm} tint={color.textSecondary} />
            <Text style={styles.infoText}>
              At least 8 characters, with a capital letter and a number. Next time you log in, use the new password.
            </Text>
          </View>

          {Field({ label: 'Current password', value: currentPassword, onChange: setCurrentPassword, placeholder: 'Enter current password' })}
          {Field({ label: 'New password', value: newPassword, onChange: setNewPassword, placeholder: 'Enter new password' })}
          {Field({ label: 'Confirm new password', value: confirmPassword, onChange: setConfirmPassword, placeholder: 'Enter new password again' })}

          <Button label={t('cpUpdate')} onPress={handleUpdate} loading={loading} disabled={loading} fullWidth style={styles.btn} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.surface },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md, minHeight: 56, borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  backBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typeScale.heading, fontSize: 18, color: color.textPrimary, flex: 1, textAlign: 'center' },
  form: { padding: space.xl },
  infoBox: {
    flexDirection: 'row', gap: space.sm, alignItems: 'flex-start',
    backgroundColor: color.surfaceRaised, padding: space.lg, borderRadius: radius.md, marginBottom: space.xl,
    borderWidth: hairline, borderColor: color.border,
  },
  infoText: { ...typeScale.label, color: color.textSecondary, lineHeight: 20, flex: 1 },
  fieldWrap: { marginBottom: space.lg },
  label: { ...typeScale.label, color: color.textSecondary, marginBottom: space.sm },
  input: {
    backgroundColor: color.surfaceRaised, borderWidth: hairline, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: touchTarget, ...typeScale.body, color: color.textPrimary,
  },
  btn: { minHeight: 52, marginTop: space.md },
});
