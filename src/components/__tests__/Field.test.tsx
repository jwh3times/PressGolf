import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Field } from '../Field';

describe('Field', () => {
  it('names its input after the visible label, so a screen reader says what to type', async () => {
    await render(<Field label="Group name" value="Saturday Dogs" />);
    expect(screen.getByLabelText('Group name')).toHaveDisplayValue('Saturday Dogs');
  });

  it('lets a caller give a more specific name', async () => {
    await render(<Field label="Handicap index" accessibilityLabel="Handicap index for Marcus" value="" />);
    expect(screen.getByLabelText('Handicap index for Marcus')).toBeOnTheScreen();
  });
});
