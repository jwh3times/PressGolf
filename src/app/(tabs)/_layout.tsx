import { Tabs } from 'expo-router/js-tabs';
import React from 'react';
import { TabBar } from '../../components/TabBar';
import { colors } from '../../theme/tokens';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.screen },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="format" options={{ title: 'Format' }} />
      <Tabs.Screen name="score" options={{ title: 'Score' }} />
      <Tabs.Screen name="settle" options={{ title: 'Settle' }} />
    </Tabs>
  );
}
