import * as SystemUI from 'expo-system-ui';
import React from 'react';
import { Appearance } from 'react-native';
import { loadThemeChoice, saveThemeChoice } from '../store/persistence';
import { ThemeContext, ThemeSettingContext, type ThemeSetting } from './theme';
import { themeFor, type ThemeChoice } from './themes';

/**
 * Provides the theme the player chose, and remembers a new choice. Renders
 * nothing until the saved choice has been read, so the app never draws in one
 * theme and then another; the splash screen is still up while it waits.
 */
export function ChosenThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoice] = React.useState<ThemeChoice | null>(null);

  React.useEffect(() => {
    let live = true;
    void loadThemeChoice().then((saved) => {
      if (live) setChoice(saved);
    });
    return () => {
      live = false;
    };
  }, []);

  const theme = choice ? themeFor(choice) : null;

  // The system's own furniture follows: keyboard and alerts by scheme, and the
  // colour behind the app, which shows through during navigation.
  React.useEffect(() => {
    if (!theme) return;
    Appearance.setColorScheme?.(theme.scheme);
    void SystemUI.setBackgroundColorAsync(theme.colors.screen).catch(() => {});
  }, [theme]);

  const setting = React.useMemo<ThemeSetting | null>(() => {
    if (!choice) return null;
    const choose = (next: ThemeChoice) => {
      setChoice(next);
      void saveThemeChoice(next).catch(() => {});
    };
    return {
      choice,
      setBase: (base) => choose({ ...choice, base }),
      setAccent: (accent) => choose({ ...choice, accent }),
    };
  }, [choice]);

  if (!theme || !setting) return null;
  return (
    <ThemeSettingContext.Provider value={setting}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </ThemeSettingContext.Provider>
  );
}
