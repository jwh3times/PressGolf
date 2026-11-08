import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import type { Round } from '../domain/types';
import { useStore } from '../store/AppStore';

/**
 * Whether a round can be abandoned (#259): a live round outside an outing. A
 * round in an outing ends when the outing closes, and a card being typed in
 * has Discard card instead.
 */
export function canAbandon(round: Round): boolean {
  return round.entry === 'live' && !round.outingId;
}

/**
 * Asks how to abandon a round: keep it in History without counting it in the
 * season ledger, or delete it after a second confirm. Either way the app goes
 * Home. Settle and History's open-round prompt both ask this way.
 */
export function useAbandonRound(): (round: Round) => void {
  const store = useStore();
  const router = useRouter();
  return (round) => {
    const finish = (close: (id: string) => void) => {
      close(round.id);
      router.replace('/');
    };
    Alert.alert(
      'Abandon this round?',
      'Keep it in History without counting it in the season ledger, or delete it.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Delete round',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Delete this round?', 'Every score in it is gone for good. This can’t be undone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => finish(store.deleteRound) },
            ]),
        },
        { text: 'Keep in History', onPress: () => finish(store.abandonRound) },
      ],
    );
  };
}
