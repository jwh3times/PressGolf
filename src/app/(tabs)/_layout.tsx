import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import React from 'react';
import { TabBar } from '../../components/TabBar';
import { useTheme } from '../../theme/theme';

function renderTabBar(props: BottomTabBarProps) {
  return <TabBar {...props} />;
}

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      tabBar={renderTabBar}
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
