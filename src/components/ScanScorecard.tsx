import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { AccessibilityInfo, Alert, Platform, View } from 'react-native';
import { draftFromScan } from '../domain/course-draft';
import { MAX_PHOTOS, scanScorecard, type Capture } from '../hooks/scanner';
import { useStore } from '../store/AppStore';
import { readScorecard } from '../sync/scorecard';
import { useTheme } from '../theme/theme';
import { Body, GhostButton } from './primitives';

/** From how few scans left the golfer is told the count. */
export const SCANS_LOW = 3;

/** Whether this phone has a document scanner to offer: the web has none. */
export const CAN_SCAN = Platform.OS !== 'web';

/** The once-only notice before a first scan: where the photos go, and that Press keeps none of them. */
export const SCAN_NOTICE =
  'The photos go to Press’s server and are read by Claude, an AI model from Anthropic. Press keeps no copy of them, and Anthropic doesn’t use them to train its models. Each account has 10 scans a day.';

/** Asks once, before the first scan ever on this phone. Resolves true when the golfer agrees to go ahead. */
function agreedToScan(seen: boolean, note: () => void): Promise<boolean> {
  if (seen) return Promise.resolve(true);
  return new Promise((resolve) => {
    Alert.alert('Before you scan', SCAN_NOTICE, [
      { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
      {
        text: 'Scan',
        onPress: () => {
          note();
          resolve(true);
        },
      },
    ]);
  });
}

function scansLeftText(left: number): string {
  if (left === 0) return 'No scans left today. Type the course in, or scan again tomorrow.';
  return left === 1 ? '1 scan left today.' : `${left} scans left today.`;
}

/**
 * Scanning the scorecard (#385), for a course the library doesn't have: the phone's
 * document scanner takes up to 4 photos of one card, the server reads them, and what it
 * read opens as a new course in the editor, each value marked until the golfer checks
 * it and every blank left blank. Over the day's limit, or with no signal, it says so,
 * and Type it in is right below it. Phones only: the web has no document scanner.
 */
export function ScanScorecard({ name }: { name: string }) {
  const { ink } = useTheme();
  const store = useStore();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!CAN_SCAN) return null;

  // Shown, and said: iOS has no live regions, so VoiceOver hears it only this way.
  const say = (text: string) => {
    setMessage(text);
    AccessibilityInfo.announceForAccessibility(text);
  };

  const scan = async () => {
    setMessage(null);
    if (!(await agreedToScan(store.scanNoticeSeen, store.noteScanNotice))) return;
    let capture: Capture;
    try {
      capture = await scanScorecard();
    } catch {
      say('The scanner didn’t open. Type the course in instead.');
      return;
    }
    if (capture.kind === 'cancelled') return;
    if (capture.kind === 'too-many') {
      say(`That’s ${capture.count} photos. A scan takes up to ${MAX_PHOTOS} of one card: scan it again with fewer.`);
      return;
    }
    setBusy(true);
    try {
      const read = await readScorecard(capture.photos);
      if (read.outcome === 'read') {
        store.noteScansLeft(read.scansLeft);
        const draft = draftFromScan(name, read.card);
        store.startNewCourse(draft.course, draft.marks);
        router.push(`/course/${draft.course.id}`);
        return;
      }
      if (read.outcome === 'unreadable') {
        store.noteScansLeft(read.scansLeft);
        say(`${read.reason} Try again with the card flat and well lit, or type it in.`);
        return;
      }
      if (read.outcome === 'limit') store.noteScansLeft(0);
      say(read.reason);
    } finally {
      setBusy(false);
    }
  };

  const left = store.scansLeft;
  return (
    <View style={{ gap: 8 }}>
      <GhostButton label={busy ? 'Reading the card…' : 'Scan the scorecard'} disabled={busy} onPress={() => void scan()} />
      {message ? (
        <Body style={{ color: ink.soft, lineHeight: 19 }} accessibilityLiveRegion="polite">
          {message}
        </Body>
      ) : null}
      {/* Over the limit, the server's reason has just said so: no need to say it twice. */}
      {left !== null && left <= SCANS_LOW && !(left === 0 && message) ? (
        <Body style={{ color: ink.quiet, lineHeight: 18 }}>{scansLeftText(left)}</Body>
      ) : null}
    </View>
  );
}
