import React from 'react';
import { act, render, screen, userEvent } from '@testing-library/react-native';
import * as SystemUI from 'expo-system-ui';
import { Appearance, Pressable, Text } from 'react-native';
import { loadThemeChoice, saveThemeChoice } from '../../store/persistence';
import { ChosenThemeProvider } from '../ChosenTheme';
import { useTheme, useThemeSetting } from '../theme';
import { themeFor } from '../themes';

jest.mock('../../store/persistence', () => ({
  loadThemeChoice: jest.fn(),
  saveThemeChoice: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn(() => Promise.resolve()) }));

const mockLoad = loadThemeChoice as jest.MockedFunction<typeof loadThemeChoice>;
const mockSave = saveThemeChoice as jest.MockedFunction<typeof saveThemeChoice>;

function Probe() {
  const theme = useTheme();
  const { setBase, setAccent } = useThemeSetting();
  return (
    <>
      <Text>{`${theme.base} ${theme.accent} ${theme.scheme}`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Go light" onPress={() => setBase('light')} />
      <Pressable accessibilityRole="button" accessibilityLabel="Go blue" onPress={() => setAccent('blue')} />
    </>
  );
}

beforeEach(() => jest.clearAllMocks());

describe('the chosen theme', () => {
  it('draws nothing until the saved choice is read, then draws in it', async () => {
    let resolve: (value: Awaited<ReturnType<typeof loadThemeChoice>>) => void = () => {};
    mockLoad.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const setScheme = jest.spyOn(Appearance, 'setColorScheme');
    await render(
      <ChosenThemeProvider>
        <Probe />
      </ChosenThemeProvider>,
    );
    expect(screen.queryByText(/dark|light/)).not.toBeOnTheScreen();

    await act(async () => resolve({ base: 'darkContrast', accent: 'gold' }));
    expect(screen.getByText('darkContrast gold dark')).toBeOnTheScreen();
    expect(setScheme).toHaveBeenLastCalledWith('dark');
    expect(SystemUI.setBackgroundColorAsync).toHaveBeenLastCalledWith(
      themeFor({ base: 'darkContrast', accent: 'gold' }).colors.screen,
    );
  });

  it('changes at once when a new base or accent is chosen, and remembers it', async () => {
    const user = userEvent.setup();
    mockLoad.mockResolvedValueOnce({ base: 'dark', accent: 'green' });
    const setScheme = jest.spyOn(Appearance, 'setColorScheme');
    await render(
      <ChosenThemeProvider>
        <Probe />
      </ChosenThemeProvider>,
    );
    expect(await screen.findByText('dark green dark')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Go light' }));
    expect(screen.getByText('light green light')).toBeOnTheScreen();
    expect(mockSave).toHaveBeenLastCalledWith({ base: 'light', accent: 'green' });
    expect(setScheme).toHaveBeenLastCalledWith('light');

    await user.press(screen.getByRole('button', { name: 'Go blue' }));
    expect(screen.getByText('light blue light')).toBeOnTheScreen();
    expect(mockSave).toHaveBeenLastCalledWith({ base: 'light', accent: 'blue' });
  });

  it('keeps a choice it could not save, for this session at least', async () => {
    const user = userEvent.setup();
    mockLoad.mockResolvedValueOnce({ base: 'dark', accent: 'green' });
    mockSave.mockRejectedValueOnce(new Error('disk full'));
    await render(
      <ChosenThemeProvider>
        <Probe />
      </ChosenThemeProvider>,
    );
    await screen.findByText('dark green dark');
    await user.press(screen.getByRole('button', { name: 'Go light' }));
    expect(screen.getByText('light green light')).toBeOnTheScreen();
  });

  it('stops listening for the saved choice when it goes away first', async () => {
    let resolve: (value: Awaited<ReturnType<typeof loadThemeChoice>>) => void = () => {};
    mockLoad.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const view = await render(
      <ChosenThemeProvider>
        <Probe />
      </ChosenThemeProvider>,
    );
    await view.unmount();
    await act(async () => resolve({ base: 'light', accent: 'green' }));
    expect(SystemUI.setBackgroundColorAsync).not.toHaveBeenCalled();
  });
});
