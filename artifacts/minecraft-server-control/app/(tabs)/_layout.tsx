import React from 'react';
import { View } from 'react-native';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Redirect, Slot } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { TabPagerShell } from '@/components/TabPagerShell';
import { useControlAuth } from '@/context/ControlAuth';

// IMPORTANT: iOS 26 uses NativeTabs for native tabs with liquid glass support.
function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="servers">
        <NativeTabs.Trigger.Icon sf={{ default: 'server.rack', selected: 'server.rack' }} />
        <NativeTabs.Trigger.Label>Servers</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="console">
        <NativeTabs.Trigger.Icon sf={{ default: 'terminal', selected: 'terminal.fill' }} />
        <NativeTabs.Trigger.Label>Console</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tools">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'wrench.and.screwdriver', selected: 'wrench.and.screwdriver.fill' }}
        />
        <NativeTabs.Trigger.Label>Tools</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  // Real side-by-side pager on Android. Slot stays mounted (hidden) so Expo Router
  // keeps route registration; route files return null on this path.
  return (
    <View style={{ flex: 1 }}>
      <TabPagerShell />
      <View
        style={{ width: 0, height: 0, overflow: 'hidden', position: 'absolute', opacity: 0 }}
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
      >
        <Slot />
      </View>
    </View>
  );
}

export default function TabLayout() {
  const { isUnlocked } = useControlAuth();
  if (!isUnlocked) return <Redirect href="/sign-in" />;
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
