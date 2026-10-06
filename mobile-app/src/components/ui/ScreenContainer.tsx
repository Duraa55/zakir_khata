import React from 'react';
import { ScrollView, View, KeyboardAvoidingView, Platform, StyleProp, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ScreenContainerProps {
  children: React.ReactNode;
  scrollable?: boolean;
  hasTabBar?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

// Inner component: renders the scrolling (or static) body with the given clearance.
const ScreenContainerInner = ({
  children,
  scrollable,
  style,
  contentContainerStyle,
  bottomPadding,
}: {
  children: React.ReactNode;
  scrollable: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  bottomPadding: number;
}) => {
  if (!scrollable) {
    return (
      <View style={[style, { flex: 1, paddingBottom: bottomPadding }]}>
        {children}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={style}
        contentContainerStyle={[contentContainerStyle, { flexGrow: 1, paddingBottom: bottomPadding }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export const ScreenContainer = ({
  children,
  scrollable = true,
  hasTabBar = false,
  style,
  contentContainerStyle,
}: ScreenContainerProps) => {
  const insets = useSafeAreaInsets();

  /**
   * With a flush tab bar the navigator has already shrunk this screen's viewport by
   * the bar's height, and the bar itself absorbs the safe-area inset — so a tab
   * screen needs no compensation at all, only ordinary breathing room. Adding the
   * bar height back (as this used to) left ~147px of dead space under every
   * scrollable tab screen.
   *
   * A screen with no tab bar underneath still has to clear the home indicator.
   */
  const bottomPadding = hasTabBar ? 16 : Math.max(insets.bottom, 16) + 35;

  return (
    <ScreenContainerInner
      scrollable={scrollable}
      style={style}
      contentContainerStyle={contentContainerStyle}
      bottomPadding={bottomPadding}
    >
      {children}
    </ScreenContainerInner>
  );
};
