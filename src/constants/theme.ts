/**
 * Design tokens shared across the app: colors (light/dark), fonts, and spacing.
 * Alternatives if this grows too simple for the project: Nativewind, Tamagui,
 * or unistyles.
 */

import '@/global.css';

import { Platform } from 'react-native';

/** Active color palette variant. */
export type ThemeScheme = 'light' | 'dark';

/** Named color tokens available in every palette. */
export interface ColorTokens {
  text: string;
  background: string;
  backgroundElement: string;
  backgroundSelected: string;
  textSecondary: string;
  primary: string;
}

const lightColors: ColorTokens = {
  text: '#000000',
  background: '#ffffff',
  backgroundElement: '#F0F0F3',
  backgroundSelected: '#E0E1E6',
  textSecondary: '#60646C',
  primary: '#208AEF',
};

const darkColors: ColorTokens = {
  text: '#ffffff',
  background: '#000000',
  backgroundElement: '#212225',
  backgroundSelected: '#2E3135',
  textSecondary: '#B0B4BA',
  primary: '#208AEF',
};

/** Color palettes keyed by theme scheme. */
export const Colors: Record<ThemeScheme, ColorTokens> = {
  light: lightColors,
  dark: darkColors,
};

/** Any color token name usable with `themeColor`/`type` props. */
export type ThemeColor = keyof ColorTokens;

/** Font family stacks for the four design categories. */
export interface FontStacks {
  sans: string;
  serif: string;
  rounded: string;
  mono: string;
}

const iosFonts: FontStacks = {
  /** iOS `UIFontDescriptorSystemDesignDefault` */
  sans: 'system-ui',
  /** iOS `UIFontDescriptorSystemDesignSerif` */
  serif: 'ui-serif',
  /** iOS `UIFontDescriptorSystemDesignRounded` */
  rounded: 'ui-rounded',
  /** iOS `UIFontDescriptorSystemDesignMonospaced` */
  mono: 'ui-monospace',
};

const webFonts: FontStacks = {
  sans: 'var(--font-display)',
  serif: 'var(--font-serif)',
  rounded: 'var(--font-rounded)',
  mono: 'var(--font-mono)',
};

const androidFonts: FontStacks = {
  sans: 'normal',
  serif: 'serif',
  rounded: 'normal',
  mono: 'monospace',
};

/** Platform-specific font stacks, resolved once at module load. */
export const Fonts: FontStacks =
  Platform.OS === 'ios'
    ? iosFonts
    : Platform.OS === 'web'
      ? webFonts
      : androidFonts;

/** Spacing scale in logical pixels. */
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Any spacing token name. */
export type SpacingToken = keyof typeof Spacing;
