import React from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { MAX_CONTROL_SCALE } from '../../hooks/useLargeText';
import { Avatar, CHIP_ROW_GAP, Chip, Mono, PrimaryButton, Stepper, StepperButton, Switch } from '../primitives';

// The first tests in the tree that mount anything (#10). They hold the
// primitives to what a screen reader is told, since every screen builds on them.

describe('PrimaryButton', () => {
  it('is a named button that fires when pressed', async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await render(<PrimaryButton label="Post to ledger" onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Post to ledger' });
    const label = screen.getByText('Post to ledger');
    expect(button).toBeEnabled();
    expect(label).toHaveProp('allowFontScaling', false);
    expect(label).toHaveStyle({ fontSize: 30, lineHeight: 40 });
    await user.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('reports disabled and ignores presses when disabled', async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await render(<PrimaryButton label="Post to ledger" onPress={onPress} disabled />);

    const button = screen.getByRole('button', { name: 'Post to ledger' });
    expect(button).toBeDisabled();
    await user.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Stepper', () => {
  it('names its glyph buttons, so a screen reader does not read "minus" and "plus"', async () => {
    const user = userEvent.setup();
    const onDecrement = jest.fn();
    const onIncrement = jest.fn();
    await render(<Stepper value="4" onDecrement={onDecrement} onIncrement={onIncrement} />);

    await user.press(screen.getByRole('button', { name: 'decrease' }));
    await user.press(screen.getByRole('button', { name: 'increase' }));
    await user.press(screen.getByRole('button', { name: 'increase' }));

    expect(onDecrement).toHaveBeenCalledTimes(1);
    expect(onIncrement).toHaveBeenCalledTimes(2);
    expect(screen.getByText('4')).toBeOnTheScreen();
    expect(screen.getByText('4')).toHaveProp('maxFontSizeMultiplier', MAX_CONTROL_SCALE);
  });

  it('accepts a contextual name when several steppers share a screen', async () => {
    await render(
      <StepperButton
        label="+"
        accessibilityLabel="Increase score for Marcus"
        onPress={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Increase score for Marcus' })).toBeOnTheScreen();
  });
});

describe('scaled text', () => {
  it('owns both font size and line height so custom fonts cannot clip at Dynamic Type sizes', async () => {
    await render(<Mono size={12}>$2</Mono>);
    const amount = screen.getByText('$2');
    const style = StyleSheet.flatten(amount.props.style);
    expect(amount).toHaveProp('allowFontScaling', false);
    expect(style.fontSize).toBe(24);
    expect(style.lineHeight).toBeCloseTo(33.6);
  });
});

describe('Avatar', () => {
  it('keeps initials inside the fixed-size player bubble', async () => {
    await render(<Avatar initials="JD" color="#fff" size={24} />);
    expect(screen.getByText('JD')).toHaveProp('maxFontSizeMultiplier', 1.5);
  });
});

describe('Switch', () => {
  it('is a named switch that reports its state', async () => {
    const user = userEvent.setup();
    const onToggle = jest.fn();
    await render(<Switch on label="Skins" onToggle={onToggle} />);

    const toggle = screen.getByRole('switch', { name: 'Skins' });
    expect(toggle).toBeChecked();
    await user.press(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('reports off when off', async () => {
    await render(<Switch on={false} label="Skins" onToggle={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Skins' })).not.toBeChecked();
  });

  it('carries a test ID from its label, so a native flow can tell it from the title beside it', async () => {
    const view = await render(<Switch on label="Wolf" onToggle={() => {}} />);
    expect(screen.getByTestId('switch-Wolf')).toBe(screen.getByRole('switch'));
    await view.unmount();

    await render(<Switch on onToggle={() => {}} />);
    expect(screen.getByRole('switch').props.testID).toBeUndefined();
  });
});

describe('Chip', () => {
  it('takes its name from its label and reports selection', async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await render(<Chip label="SANDY" active onPress={onPress} />);

    const chip = screen.getByRole('button', { name: 'SANDY' });
    expect(chip).toBeSelected();
    await user.press(chip);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is a full-size tap target around a pill drawn at its own size', async () => {
    await render(<Chip label="OFF" onPress={jest.fn()} />);

    const chip = screen.getByRole('button', { name: 'OFF' });
    expect(chip).toHaveStyle({ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' });
    expect(chip.props.hitSlop).toBeUndefined();
    expect(screen.getByTestId('chip-pill')).toHaveStyle({ paddingVertical: 4, paddingHorizontal: 9, borderWidth: 1 });
  });

  it('takes no more room in a row than its pill, and wrapped lines keep their tap boxes off each other', async () => {
    await render(<Chip label="OFF" onPress={jest.fn()} />);

    // The padding that makes the box is given back as margin.
    const { paddingVertical, marginVertical } = StyleSheet.flatten(
      screen.getByRole('button', { name: 'OFF' }).props.style,
    );
    expect(paddingVertical).toBeGreaterThan(0);
    expect(marginVertical).toBe(-paddingVertical);
    // The box of a chip on the next line reaches up no further than the gap.
    expect(CHIP_ROW_GAP).toBeGreaterThanOrEqual(paddingVertical);
  });

  it('reports disabled and ignores presses when disabled', async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await render(<Chip label="SANDY" onPress={onPress} disabled />);

    const chip = screen.getByRole('button', { name: 'SANDY' });
    expect(chip).toBeDisabled();
    expect(chip).not.toBeSelected();
    await user.press(chip);
    expect(onPress).not.toHaveBeenCalled();
  });
});
