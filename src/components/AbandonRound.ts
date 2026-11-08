import { Alert } from 'react-native';

/**
 * Asks how to abandon a round (#259): keep it in History without counting it
 * in the season ledger, or delete it after a second confirm. Settle and
 * History's open-round prompt both ask this, so they ask it the same way.
 */
export function askToAbandon({ onKeep, onDelete }: { onKeep: () => void; onDelete: () => void }) {
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
            { text: 'Delete', style: 'destructive', onPress: onDelete },
          ]),
      },
      { text: 'Keep in History', onPress: onKeep },
    ],
  );
}
