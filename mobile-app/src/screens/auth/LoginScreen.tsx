import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Alert,
  KeyboardAvoidingView, Platform, StyleSheet,
  ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { CountryCodePicker } from '../../components/CountryCodePicker';
import { AmbientBackground } from '../../components/AmbientBackground';
import { Icon, Button } from '../../components/ui/primitives';
import { color, space, radius, hairline, iconSize, type as typeScale } from '../../theme/tokens';

export const LoginScreen = ({ navigation }: any) => {
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+92');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [passError, setPassError] = useState('');
  const { login, loading } = useAuthStore();
  const { language, setLanguage, t } = useLanguageStore();


  const isUrdu = language === 'ur';

  const validate = () => {
    let ok = true;
    const cleanPhone = phone.replace(/\s/g, '');
    if (!cleanPhone) { setPhoneError(t('errPhone')); ok = false; } else { setPhoneError(''); }
    if (!password) { setPassError(t('errPass')); ok = false; } else { setPassError(''); }
    return ok;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    
    const cleanPhone = phone.replace(/\s/g, '');
    const result = await login(countryCode + cleanPhone, password);
    if (result === 'invalid') {
      Alert.alert(t('errorTitle'), t('wrongCreds'));
    }
  };

  return (
    <AmbientBackground style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >

            {/* ── Top bar: Language Toggle ── */}
            <View style={styles.topBar}>
              <View style={styles.langLabelRow}>
                <Icon name="globe" size={iconSize.sm} tint={color.textSecondary} />
                <Text style={styles.topBarLabel}>{t('loginLanguage')}</Text>
              </View>
              <View style={styles.segmented}>
                <TouchableOpacity
                  style={[styles.segBtn, language === 'en' && styles.segBtnActive]}
                  onPress={() => setLanguage('en')}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: language === 'en' }}
                >
                  <Text style={[styles.segBtnText, language === 'en' && styles.segBtnTextActive]}>
                    English
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segBtn, language === 'ur' && styles.segBtnActive]}
                  onPress={() => setLanguage('ur')}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: language === 'ur' }}
                >
                  <Text style={[styles.segBtnText, language === 'ur' && styles.segBtnTextActive]}>
                    اردو
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ── Header ── */}
            <View style={styles.header}>
              <View style={styles.logoCircle}>
                <Image
                  source={require('../../../assets/favicon.png')}
                  style={styles.logoImage}
                  resizeMode="cover"
                />
              </View>
              <Text style={styles.appName}>AL-REEF</Text>
              <Text style={styles.appTagline}>{t('appTagline')}</Text>
            </View>

            {/* ── Sign-in card ── */}
            <View style={styles.card}>
              <Text style={[styles.cardTitle, isUrdu && styles.rtl]}>{t('cardTitle')}</Text>
              <Text style={[styles.cardSub, isUrdu && styles.rtl]}>{t('cardSub')}</Text>

              {/* Phone */}
              <View style={styles.fieldWrap}>
                <Text style={[styles.label, isUrdu && styles.rtl]}>{t('labelPhone')}</Text>
                <View style={{ flexDirection: isUrdu ? 'row-reverse' : 'row' }}>
                  <CountryCodePicker selectedCode={countryCode} onSelect={setCountryCode} />
                  <TextInput
                    style={[styles.input, phoneError ? styles.inputError : null, styles.flex]}
                    placeholder="3001234567"
                    placeholderTextColor={color.textMuted}
                    value={phone}
                    onChangeText={v => { setPhone(v); setPhoneError(''); }}
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    textAlign={isUrdu ? 'right' : 'left'}
                  />
                </View>
                {!!phoneError && (
                  <Text style={[styles.errText, isUrdu && styles.rtl]}>{phoneError}</Text>
                )}
              </View>

              {/* Password */}
              <View style={styles.fieldWrap}>
                <Text style={[styles.label, isUrdu && styles.rtl]}>{t('labelPassword')}</Text>
                <View style={styles.passRow}>
                  <TextInput
                    style={[
                      styles.input,
                      styles.flex,
                      passError ? styles.inputError : null,
                    ]}
                    placeholder="••••••••"
                    placeholderTextColor={color.textMuted}
                    value={password}
                    onChangeText={v => { setPassword(v); setPassError(''); }}
                    secureTextEntry={!showPassword}
                    textAlign={isUrdu ? 'right' : 'left'}
                  />
                  <TouchableOpacity
                    style={styles.eyeBtn}
                    onPress={() => setShowPassword(v => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <Icon name={showPassword ? 'eye-off' : 'eye'} size={iconSize.md} tint={color.textSecondary} />
                  </TouchableOpacity>
                </View>
                {!!passError && (
                  <Text style={[styles.errText, isUrdu && styles.rtl]}>{passError}</Text>
                )}
              </View>

              <Button
                label={t('loginBtn')}
                onPress={handleLogin}
                loading={loading}
                disabled={loading}
                fullWidth
                style={styles.loginBtn}
              />

            </View>

          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AmbientBackground>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: color.surface },
  scroll: { flexGrow: 1 },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, minHeight: 56,
    borderBottomWidth: hairline, borderBottomColor: color.border,
  },
  langLabelRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  topBarLabel: { ...typeScale.label, color: color.textSecondary },
  segmented: {
    flexDirection: 'row', backgroundColor: color.surfaceRaised, borderRadius: radius.pill,
    padding: 3, borderWidth: hairline, borderColor: color.border,
  },
  segBtn: { paddingHorizontal: space.lg, minHeight: 38, borderRadius: radius.pill, justifyContent: 'center' },
  segBtnActive: { backgroundColor: color.accent },
  segBtnText: { ...typeScale.label, color: color.textSecondary },
  segBtnTextActive: { color: color.textInverse, fontWeight: typeScale.bodyMedium.fontWeight },

  header: { alignItems: 'center', paddingTop: space.xxxl, paddingBottom: space.xxl },
  logoCircle: {
    width: 88, height: 88, borderRadius: radius.pill, overflow: 'hidden', marginBottom: space.md,
    borderWidth: hairline, borderColor: color.border,
  },
  logoImage: { width: 88, height: 88 },
  appName: { ...typeScale.hero, fontSize: 28, color: color.textPrimary },
  appTagline: { ...typeScale.label, color: color.textSecondary, marginTop: space.xs },

  rtl: { textAlign: 'right' },

  card: {
    flex: 1, backgroundColor: color.surfaceRaised,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingHorizontal: space.xxl, paddingTop: space.xxl, paddingBottom: 40,
    borderTopWidth: hairline, borderColor: color.border,
  },
  cardTitle: { ...typeScale.title, fontSize: 22, color: color.textPrimary, marginBottom: space.xs },
  cardSub: { ...typeScale.label, color: color.textSecondary, marginBottom: space.xxl },

  fieldWrap: { marginBottom: space.lg },
  label: { ...typeScale.label, color: color.textSecondary, marginBottom: space.sm },
  input: {
    backgroundColor: color.surface, borderWidth: hairline, borderColor: color.borderStrong,
    borderRadius: radius.md, paddingHorizontal: space.lg, minHeight: 48,
    ...typeScale.body, color: color.textPrimary,
  },
  inputError: { borderColor: color.moneyOut },
  errText: { ...typeScale.caption, color: color.moneyOut, marginTop: space.xs },

  passRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  eyeBtn: {
    backgroundColor: color.surface, borderWidth: hairline, borderColor: color.borderStrong,
    borderRadius: radius.md, width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
  },

  loginBtn: { minHeight: 50, marginTop: space.sm },
});
