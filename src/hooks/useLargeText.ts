import { useWindowDimensions } from 'react-native';

/**
 * Switch dense horizontal layouts to a stacked form before accessibility text
 * reaches the sizes that make two-column rows unreadable on a phone.
 */
export const LARGE_TEXT_SCALE = 1.8;

export function needsLargeTextLayout(fontScale: number): boolean {
  return fontScale >= LARGE_TEXT_SCALE;
}

export function useLargeText(): boolean {
  return needsLargeTextLayout(useWindowDimensions().fontScale);
}
