import React from 'react';
import type { TextStyle } from 'react-native';
import {
  darkTheme,
  DEFAULT_THEME_CHOICE,
  type Theme,
  type ThemeAccent,
  type ThemeBase,
  type ThemeChoice,
} from './themes';
import { fonts } from './tokens';

// Outside a provider the theme is the dark one, so a component rendered alone
// in a test looks as it does in the app by default.
export const ThemeContext = React.createContext<Theme>(darkTheme);

export function ThemeProvider({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export interface ThemeSetting {
  choice: ThemeChoice;
  setBase: (base: ThemeBase) => void;
  setAccent: (accent: ThemeAccent) => void;
}

export const ThemeSettingContext = React.createContext<ThemeSetting>({
  choice: DEFAULT_THEME_CHOICE,
  setBase: () => {},
  setAccent: () => {},
});

/** The chosen theme and the means to change it. */
export function useThemeSetting(): ThemeSetting {
  return React.useContext(ThemeSettingContext);
}

export function useTheme(): Theme {
  return React.useContext(ThemeContext);
}

/**
 * A style sheet that depends on the theme. Returns the hook that reads it; the
 * sheet is built once for each theme and kept.
 */
export function makeStyles<T>(build: (theme: Theme) => T): () => T {
  const built = new WeakMap<Theme, T>();
  return function useStyles() {
    const theme = useTheme();
    let styles = built.get(theme);
    if (!styles) {
      styles = build(theme);
      built.set(theme, styles);
    }
    return styles;
  };
}

/**
 * The prototype's eyebrow label: 10-unit mono, wide tracking, uppercase.
 * It appears above nearly every section, so it lives here rather than being
 * re-typed a dozen times.
 */
export function eyebrowStyle(theme: Theme): TextStyle {
  return {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: theme.ink.soft,
  };
}
