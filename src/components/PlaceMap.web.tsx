import React from 'react';
import { Body, Card } from './primitives';
import type { PlaceMapProps } from './PlaceMap';

/** react-native-maps has no web version; the web build says so instead of breaking. */
export function PlaceMap(_props: PlaceMapProps) {
  return (
    <Card style={{ padding: 16 }}>
      <Body style={{ lineHeight: 19 }}>
        The map works in the app on a phone. On the web, set the course where you’re standing instead.
      </Body>
    </Card>
  );
}
