import React from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { TabBar, tabBarClearance, tabBarHeight, tabIconFonts, tabIconSize } from '../TabBar';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 4, left: 0 }),
}));

// Records each symbol a tab asks for; the native view itself does not render under Jest.
const mockSymbolView = jest.fn((_symbol: { name: unknown; size: number }) => null);
jest.mock('expo-symbols', () => ({
  SymbolView: (symbol: { name: unknown; size: number }) => mockSymbolView(symbol),
}));

const routes = [
  { key: 'home-key', name: 'index', params: undefined },
  { key: 'format-key', name: 'format', params: undefined },
  { key: 'score-key', name: 'score', params: undefined },
  { key: 'settle-key', name: 'settle', params: undefined },
  { key: 'other-key', name: 'other', params: undefined },
];

function props(index = 0) {
  return {
    state: { index, routes },
    navigation: { navigate: jest.fn() },
    descriptors: {},
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
}

describe('TabBar', () => {
  it('scales its height and clearance with accessibility type', () => {
    expect(tabBarHeight(1)).toBe(62);
    expect(tabBarHeight(3)).toBe(99.5);
    expect(tabBarClearance(3)).toBe(147.5);
    expect(tabIconSize(1)).toBe(24);
    expect(tabIconSize(3)).toBe(36);
  });

  it('names known and unknown tabs and navigates only away from the focused tab', async () => {
    const value = props();
    const impact = jest.spyOn(Haptics, 'impactAsync').mockResolvedValue(undefined);
    const user = userEvent.setup();
    await render(<TabBar {...(value as unknown as React.ComponentProps<typeof TabBar>)} />);

    await user.press(screen.getByRole('tab', { name: 'Home' }));
    expect(value.navigation.navigate).not.toHaveBeenCalled();
    await user.press(screen.getByRole('tab', { name: 'Format' }));
    await user.press(screen.getByRole('tab', { name: 'Score' }));
    await user.press(screen.getByRole('tab', { name: 'Settle' }));
    await user.press(screen.getByRole('tab', { name: 'other' }));
    expect(value.navigation.navigate).toHaveBeenCalledTimes(4);
    expect(impact).toHaveBeenCalledTimes(4);
  });

  it('preloads the icon font only where the icons are drawn from it', () => {
    expect(tabIconFonts('ios')).toEqual({});
    expect(Object.keys(tabIconFonts('android'))).toEqual(['MaterialSymbols_400Regular']);
    expect(tabIconFonts('web')).toEqual(tabIconFonts('android'));
  });

  it('draws every tab a vector icon at tab-icon size instead of a text glyph', async () => {
    mockSymbolView.mockClear();
    await render(<TabBar {...(props() as unknown as React.ComponentProps<typeof TabBar>)} />);
    const symbols = mockSymbolView.mock.calls.map(([symbol]) => symbol);
    expect(symbols).toHaveLength(routes.length);
    const sizes = new Set(symbols.map((symbol) => symbol.size));
    expect(sizes.size).toBe(1);
    expect([...sizes][0]).toBeGreaterThanOrEqual(24);
    expect(new Set(symbols.map((symbol) => JSON.stringify(symbol.name))).size).toBe(routes.length);
    for (const glyph of ['◆', '≡', '●', '$']) expect(screen.queryByText(glyph)).toBeNull();
  });

  it('swallows a haptic failure while still navigating', async () => {
    const value = props(1);
    jest.spyOn(Haptics, 'impactAsync').mockRejectedValueOnce(new Error('no haptics'));
    await render(<TabBar {...(value as unknown as React.ComponentProps<typeof TabBar>)} />);
    await userEvent.setup().press(screen.getByRole('tab', { name: 'Home' }));
    expect(value.navigation.navigate).toHaveBeenCalledWith('index');
  });
});
