import React from 'react';
import { Feather } from '@expo/vector-icons';
import { color, iconSize } from '../../../theme/tokens';

export type IconName = keyof typeof Feather.glyphMap;

/**
 * The only icon in the app. Everything goes through here so the outline weight
 * stays consistent and there is one place to swap the set — emoji are not icons:
 * they render at the OS's whim, carry their own colour, and look different on
 * every Android build.
 */
export const Icon = ({
  name,
  size = iconSize.md,
  tint = color.textSecondary,
}: {
  name: IconName;
  size?: number;
  tint?: string;
}) => <Feather name={name} size={size} color={tint} />;
