import { CameraView } from 'expo-camera';
import { File } from 'expo-file-system';
import type { ScanPhoto } from '../sync/scorecard';

/** The most photos one scan of one card takes: the front and back nines, and the other side. */
export const MAX_PHOTOS = 4;

export type Capture =
  | { kind: 'photos'; photos: ScanPhoto[] }
  /** The golfer closed the scanner, or the phone has none. */
  | { kind: 'cancelled' }
  | { kind: 'too-many'; count: number };

const mediaType = (uri: string): ScanPhoto['mediaType'] => (/\.png$/i.test(uri) ? 'image/png' : 'image/jpeg');

/**
 * The phone's system document scanner (#385): VisionKit on iOS, ML Kit on Android,
 * which crops and flattens each page as it's taken. The pages come back as files in
 * the app's cache, read here as base64 to send, and deleted at once either way: Press
 * keeps no photo of a scorecard. Needs a development build, not Expo Go.
 */
export async function scanScorecard(): Promise<Capture> {
  const result = await CameraView.scanDocumentAsync({ quality: 0.8 });
  if (!result || result.pages.length === 0) return { kind: 'cancelled' };
  try {
    if (result.pages.length > MAX_PHOTOS) return { kind: 'too-many', count: result.pages.length };
    const photos = await Promise.all(
      result.pages.map(async (uri) => ({ mediaType: mediaType(uri), data: await new File(uri).base64() })),
    );
    return { kind: 'photos', photos };
  } finally {
    for (const uri of result.pages) {
      try {
        new File(uri).delete();
      } catch {
        // Already gone, or the cache was cleared under it: nothing is left to keep.
      }
    }
  }
}
