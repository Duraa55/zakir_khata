import React from 'react';
import { Feather } from '@expo/vector-icons';
import { color, hairline, iconSize, type as typeScale } from '../theme/tokens';

/**
 * One definition for both navigators. The admin and staff tab bars were byte-identical
 * copies, so any change had to be made twice or the two roles silently drifted apart.
 *
 * The bar is FIXED and flush to the bottom edge: no `position: 'absolute'`, so it sits
 * in normal layout flow and the navigator shrinks each screen's viewport by its height.
 * Nothing scrolls underneath it, and screens no longer hand-compensate for a floating
 * pill. It is also flat — no radius, no shadow, no elevation.
 */
export const tabBarScreenOptions = {
  tabBarHideOnKeyboard: true,
  /** Cyan is "interactive"; the inactive tint is ordinary secondary text. */
  tabBarActiveTintColor: color.accent,
  tabBarInactiveTintColor: color.textSecondary,
  headerShown: false,
  tabBarStyle: {
    backgroundColor: color.surface,
    borderTopWidth: hairline,
    borderTopColor: color.border,
    // Height is the bar itself; react-navigation adds the safe-area inset below it.
    height: 60,
    paddingTop: 6,
    paddingBottom: 6,
  },
  tabBarLabelStyle: {
    ...typeScale.caption,
    // No fixed width anywhere on the label: Urdu runs far longer than English.
    marginBottom: 2,
  },
} as const;

/** Outline icons at one weight — the same treatment as the rest of the app. */
export const tabBarIcon =
  (name: keyof typeof Feather.glyphMap) =>
  ({ color: tint }: { color: string }) =>
    <Feather name={name} size={iconSize.md} color={tint} />;
