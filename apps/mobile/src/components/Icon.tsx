/**
 * Icon system: Material Design Icons via @expo/vector-icons — one consistent
 * stroke/weight family (Material rules), tinted from the palette.
 */
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';

import { TOUCH_TARGET, spacing } from '../theme';

export type IconName = keyof typeof MaterialIcons.glyphMap;

export function Icon({
  name,
  size = 24,
  color,
}: {
  name: IconName;
  size?: number;
  color: string;
}) {
  return <MaterialIcons name={name} size={size} color={color} />;
}

/** 48dp-min touch target wrapping an icon; ripple comes from Pressable. */
export function IconButton({
  name,
  size = 24,
  color,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  name: IconName;
  size?: number;
  color: string;
  onPress: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={0}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.target, pressed && styles.pressed]}
    >
      <Icon name={name} size={size} color={disabled ? color : color} />
    </Pressable>
  );
}

/** Section header: Spotify-canon large shelf title, no eyebrow/kicker. */
export function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

const styles = StyleSheet.create({
  target: {
    minWidth: TOUCH_TARGET,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.5 },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.2,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
});

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth }} />;
}
