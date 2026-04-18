/**
 * BYPASS ENTRY — skips expo-router entirely.
 * Registers a raw React Native component directly.
 * Used to confirm React Native rendering pipeline works.
 */
import { AppRegistry } from 'react-native';
import React from 'react';
import { View, Text } from 'react-native';

console.log('[bypass-entry] loaded');

function BypassScreen() {
  console.log('[bypass-entry] BypassScreen render');
  return React.createElement(
    View,
    { style: { flex: 1, backgroundColor: '#00aa00', justifyContent: 'center', alignItems: 'center' } },
    React.createElement(Text, { style: { color: '#ffffff', fontSize: 36, fontWeight: 'bold' } }, 'BYPASS OK'),
    React.createElement(Text, { style: { color: '#ccffcc', fontSize: 16, marginTop: 12 } }, 'expo-router bypassed'),
  );
}

AppRegistry.registerComponent('main', () => BypassScreen);
