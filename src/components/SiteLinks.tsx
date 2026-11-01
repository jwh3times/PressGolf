import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { makeStyles, useTheme } from '../theme/theme';
import { fonts, radius } from '../theme/tokens';
import { Mono } from './primitives';

const LINKS = [
  { label: 'Privacy policy', url: 'https://pressgolf.cc/privacy/' },
  { label: 'Support', url: 'https://pressgolf.cc/' },
];

/**
 * Apple wants both reachable inside the app, signed in or not. Settings can't be
 * reached from behind the sign-in screen, so this goes on both.
 */
export function SiteLinks() {
  const styles = useStyles();
  const { ink } = useTheme();
  return (
    <View style={{ gap: 10 }}>
      {LINKS.map((item) => (
        <Pressable
          key={item.url}
          accessibilityRole="link"
          accessibilityLabel={item.label}
          onPress={() => void Linking.openURL(item.url)}
          style={styles.link}
        >
          <Text style={styles.linkText}>{item.label}</Text>
          <Mono size={11} style={{ color: ink.quiet }}>
            ›
          </Mono>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles(({ colors, ink, line }) =>
  StyleSheet.create({
    link: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.cardDeep,
      borderWidth: 1,
      borderColor: line.card,
      borderRadius: radius.card,
      paddingVertical: 14,
      paddingHorizontal: 15,
    },
    linkText: { flex: 1, fontFamily: fonts.sans, fontSize: 14, color: ink.full },
  }),
);
