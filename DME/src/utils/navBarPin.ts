// src/utils/navBarPin.ts
import { NativeModules } from 'react-native';
const { NavBarPin } = NativeModules;

export const pinNavBarColor = (color: string) => {
  try { NavBarPin?.setColor(color); } catch (_) {}
};

export const clearNavBarPin = () => {
  try { NavBarPin?.clear(); } catch (_) {}
};