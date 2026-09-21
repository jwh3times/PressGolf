import React from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, fonts, ink, line, radius } from '../theme/tokens';

/** Labelled text input in the app's dark palette. */
export function Field({
  label,
  hint,
  style,
  ...rest
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={ink.trace}
        selectionColor={colors.accent}
        {...rest}
        style={[styles.input, style]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: ink.faint,
  },
  input: {
    backgroundColor: colors.cardDeep,
    borderWidth: 1,
    borderColor: line.control,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: ink.full,
  },
  hint: { fontFamily: fonts.sans, fontSize: 11, color: ink.ghost },
});
