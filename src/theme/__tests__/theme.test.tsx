import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { eyebrowStyle, makeStyles, ThemeProvider, useTheme } from '../theme';
import { darkTheme, moneyColor, type Theme } from '../themes';

const other: Theme = { ...darkTheme, ink: { ...darkTheme.ink, full: '#FFFFFF' } };

const build = jest.fn(({ ink }: Theme) => StyleSheet.create({ title: { color: ink.full } }));
const useStyles = makeStyles(build);

function Title() {
  const styles = useStyles();
  return <Text style={styles.title}>Press</Text>;
}

describe('the theme', () => {
  it('is the dark one where nothing provides another', async () => {
    await render(<Title />);
    expect(screen.getByText('Press')).toHaveStyle({ color: darkTheme.ink.full });
  });

  it('reaches styles and components through the provider', async () => {
    function Accent() {
      return <Text>{useTheme().ink.full}</Text>;
    }
    await render(
      <ThemeProvider theme={other}>
        <Title />
        <Accent />
      </ThemeProvider>,
    );
    expect(screen.getByText('Press')).toHaveStyle({ color: '#FFFFFF' });
    expect(screen.getByText('#FFFFFF')).toBeOnTheScreen();
  });

  it('builds a style sheet once for each theme', async () => {
    build.mockClear();
    const tree = (theme: Theme) => (
      <ThemeProvider theme={theme}>
        <Title />
        <Title />
      </ThemeProvider>
    );
    const view = await render(tree(darkTheme));
    await view.rerender(tree(other));
    await view.rerender(tree(darkTheme));
    // Both were built by the tests above, and are kept.
    expect(build).not.toHaveBeenCalled();
  });

  it('colours money and eyebrows from the theme it is given', () => {
    expect(moneyColor(other, 100)).toBe(other.colors.accent);
    expect(moneyColor(other, -100)).toBe(other.colors.clay);
    expect(moneyColor(other, 0)).toBe(other.ink.soft);
    expect(eyebrowStyle(other).color).toBe(other.ink.soft);
  });
});
