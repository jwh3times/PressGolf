import React from 'react';
import { Card, Body } from './primitives';
import type { GreenMapProps } from './GreenMap';

/** react-native-maps has no web version; the web build says so instead of breaking. */
export function GreenMap(_props: GreenMapProps) {
  return (
    <Card style={{ padding: 16 }}>
      <Body style={{ lineHeight: 19 }}>
        The satellite map works in the app on a phone. On the web, find greens on OpenStreetMap instead.
      </Body>
    </Card>
  );
}
