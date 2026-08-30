/**
 * Sonora design tokens. Canon world: familiar streaming app (Spotify craft bar)
 * on Material 3 structure. Identity = fixed amber accent; light & dark both
 * first-class. No raw hex outside this file.
 */
import { DarkTheme, DefaultTheme } from '@react-navigation/native';
import type { Theme } from '@react-navigation/native';

export const ACCENT = '#F59E0B'; // amber-500; Sonora signature

export interface Palette {
  background: string;
  surface: string;
  surfaceVariant: string;
  text: string;
  textSecondary: string;
  outline: string;
  accent: string;
  onAccent: string;
  error: string;
}

export const lightPalette: Palette = {
  background: '#FAFAF9',
  surface: '#FFFFFF',
  surfaceVariant: '#F1F0EC',
  text: '#1A1917',
  textSecondary: '#6B6862',
  outline: '#E0DED8',
  accent: ACCENT,
  onAccent: '#1A1917',
  error: '#B3261E',
};

export const darkPalette: Palette = {
  background: '#121110',
  surface: '#1C1B19',
  surfaceVariant: '#272522',
  text: '#F4F2EE',
  textSecondary: '#A8A49C',
  outline: '#38352F',
  accent: ACCENT,
  onAccent: '#1A1917',
  error: '#F2B8B5',
};

export const navLightTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: ACCENT,
    background: lightPalette.background,
    card: lightPalette.surface,
    text: lightPalette.text,
    border: lightPalette.outline,
  },
};

export const navDarkTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: ACCENT,
    background: darkPalette.background,
    card: darkPalette.surface,
    text: darkPalette.text,
    border: darkPalette.outline,
  },
};

/** Material type scale roles; sp-based sizes only. */
export const typeScale = {
  display: 28,
  headline: 24,
  titleLarge: 20,
  title: 16,
  body: 15,
  label: 13,
  small: 11,
} as const;

/** 4dp grid. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
} as const;

/** Minimum touch target per Android guidance. */
export const TOUCH_TARGET = 48;
