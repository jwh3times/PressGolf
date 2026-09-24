import { useWindowDimensions } from 'react-native';

/**
 * Switch dense horizontal layouts to a stacked form before accessibility text
 * reaches the sizes that make two-column rows unreadable on a phone.
 */
export const LARGE_TEXT_SCALE = 1.8;
export const MAX_CONTROL_SCALE = 2.25;

export function needsLargeTextLayout(fontScale: number): boolean {
  return fontScale >= LARGE_TEXT_SCALE;
}

export function useLargeText(): boolean {
  return needsLargeTextLayout(useWindowDimensions().fontScale);
}

/** Grow fixed controls with Dynamic Type, while keeping dense mobile layouts usable. */
export function accessibilityControlScale(fontScale: number, max = MAX_CONTROL_SCALE): number {
  return Math.min(Math.max(fontScale, 1), max);
}

export function useAccessibilityControlScale(max = MAX_CONTROL_SCALE): number {
  return accessibilityControlScale(useWindowDimensions().fontScale, max);
}
