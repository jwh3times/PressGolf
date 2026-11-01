import React from 'react';
import { Linking, View } from 'react-native';
import { ChevronRow } from './primitives';

const LINKS = [
  { label: 'Privacy policy', url: 'https://pressgolf.cc/privacy/' },
  { label: 'Support', url: 'https://pressgolf.cc/' },
];

/**
 * Apple wants both reachable inside the app, signed in or not. Settings can't be
 * reached from behind the sign-in screen, so this goes on both.
 */
export function SiteLinks() {
  return (
    <View style={{ gap: 10 }}>
      {LINKS.map((item) => (
        <ChevronRow
          key={item.url}
          label={item.label}
          role="link"
          accessibilityLabel={item.label}
          onPress={() => void Linking.openURL(item.url)}
        />
      ))}
    </View>
  );
}
