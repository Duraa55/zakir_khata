import { useLanguageStore } from '../store/useLanguageStore';
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';
import { AuthNavigator } from './AuthNavigator';
import { AdminNavigator } from './AdminNavigator';
import { getDatabase } from '../services/database/db';
import { seedDatabase, seedTestUsers } from '../services/database/seedData';
import { initializeOfflineSync, stopOfflineSync } from '../services/firebase/offlineSync';
import { IS_FIREBASE_CONFIGURED } from '../services/firebase/firebaseConfig';
import { AmbientBackground } from '../components/AmbientBackground';
import { Icon } from '../components/ui/primitives';
import { color, space, iconSize, touchTarget, hairline, type as typeScale } from '../theme/tokens';

// The light design's navigation theme: every transition, card and default background
// is the token surface — the old dark navigation theme flashed dark behind screens in motion.
const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: color.surface,
    card: color.surface,
    text: color.textPrimary,
    border: color.border,
    primary: color.accent,
    notification: color.attention,
  },
};

export const AppNavigator = () => {
  const { t, isLoaded, loadLanguage, language } = useLanguageStore();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, user, checkSession, loading } = useAuthStore();
  const [showFirebaseWarning, setShowFirebaseWarning] = useState(!IS_FIREBASE_CONFIGURED);

  useEffect(() => {
    const boot = async () => {
      if (__DEV__) console.log('[DB] Starting database initialization...');
      try {
        await loadLanguage();
        const db = await getDatabase();
        if (__DEV__) console.log('[DB] Database ready.');
        
        await seedTestUsers();
        if (__DEV__) console.log('[DB] Seed users complete.');
        
        await seedDatabase();
        if (__DEV__) console.log('[DB] Seed database complete.');
        
        await checkSession();
        if (__DEV__) console.log('[Auth] Check session complete.');
      } catch (error: any) {
        // Startup used to log this and carry on, so a stalled migration stayed invisible
        // until some screen hit a table that was never created. Say it out loud.
        if (__DEV__) console.error('[DB] Initialization failed:', error);
        Alert.alert(t('dbProblemTitle'), error?.message || t('dbProblemBody'));
      }
    };
    boot();
  }, []);

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      initializeOfflineSync(user.id);
    }
    return () => { stopOfflineSync(); };
  }, [isAuthenticated, user?.id]);

  if (!isLoaded) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: color.surface }}><ActivityIndicator color={color.accent} /></View>;

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: color.surface }}>
        <ActivityIndicator size="large" color={color.accent} />
        <Text style={{ ...typeScale.body, color: color.textSecondary, marginTop: space.md }}>{t('loading')}</Text>
      </View>
    );
  }

  return (
    <AmbientBackground>
      {/* key={language}: switching the language REMOUNTS everything, so every screen
          re-reads its names through the shared helper instead of half-updating. */}
      <NavigationContainer key={language} theme={navigationTheme}>
        {showFirebaseWarning && (
          <View style={{
            backgroundColor: color.surfaceRaised, borderBottomWidth: hairline, borderColor: color.borderAttention,
            // Clear the status bar / notch, exactly as OfflineBanner does. Without this
            // the text renders underneath it and its opening words are unreadable.
            paddingTop: Math.max(insets.top, space.sm),
            paddingBottom: space.sm, paddingLeft: space.lg,
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm,
          }}>
            <Icon name="cloud-off" size={iconSize.sm} tint={color.attention} />
            <Text style={{ ...typeScale.caption, color: color.attention, flex: 1 }}>
              {t('cloudDisabled')}
            </Text>
            <TouchableOpacity onPress={() => setShowFirebaseWarning(false)} style={{ width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel={t('close')}>
              <Icon name="x" size={iconSize.sm} tint={color.attention} />
            </TouchableOpacity>
          </View>
        )}
        {/* One portal for every account — an admin and their staff see the same
            screens and the same design. What DIFFERS is only the data each account
            owns (every book is own-only) and what the data layer allows them to do. */}
        {!isAuthenticated ? <AuthNavigator /> : <AdminNavigator />}
      </NavigationContainer>
    </AmbientBackground>
  );
};
