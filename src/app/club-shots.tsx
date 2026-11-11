import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, Chip, EmptyState } from '../components/primitives';
import { trackedShots, whyNot, type TrackedShot } from '../domain/tracked-shots';
import { useStore } from '../store/AppStore';
import { makeStyles, useTheme } from '../theme/theme';
import { fonts, radius } from '../theme/tokens';

/**
 * A club's tracked shots (#298), newest first, opened from its name in the bag:
 * where and when each was hit, how far it went and carried, why one that doesn't
 * count doesn't, and a way to delete one marked with the wrong club.
 */
export default function ClubShotsScreen() {
  const params = useLocalSearchParams<{ club: string }>();
  const store = useStore();
  const router = useRouter();
  const { ink } = useTheme();
  const club = store.clubs.find((c) => c.id === params.club);
  const { marks, rounds, courses, clubs } = store;
  const tracked = useMemo(() => trackedShots({ marks, rounds, courses, clubs }), [marks, rounds, courses, clubs]);

  if (!club) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="Club not found" onClose={() => router.back()} closeLabel="Back" />
      </Screen>
    );
  }

  const { shots } = tracked[club.id];
  // Every tracked shot has its round and course: `trackedShots` leaves out any that don't.
  const courseOf = (shot: TrackedShot) => {
    const round = rounds.find((r) => r.id === shot.start.roundId)!;
    return courses.find((c) => c.id === round.courseId)!.name;
  };
  const remove = (shot: TrackedShot) =>
    Alert.alert('Delete this tracked shot?', `It won’t count for ${club.name} again.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => store.deleteTrackedShot(shot.start.id) },
    ]);

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader eyebrow={club.name} title="Tracked shots" onClose={() => router.back()} closeLabel="Back" />
      {shots.length === 0 ? (
        <EmptyState
          title="No tracked shots yet"
          body={`Mark your ball in a live round before a full swing with your ${club.name}, and the shot shows here once its round has closed.`}
        />
      ) : (
        <>
          <Body style={{ color: ink.soft, lineHeight: 19 }}>
            Newest first. Delete a tracked shot marked with the wrong club, and it stops counting.
          </Body>
          {shots.map((shot) => (
            <ShotRow key={shot.start.id} shot={shot} clubName={club.name} courseName={courseOf(shot)} onDelete={() => remove(shot)} />
          ))}
        </>
      )}
    </Screen>
  );
}

/** One tracked shot: when and where, how far, and why it doesn't count if it doesn't. */
function ShotRow({ shot, clubName, courseName, onDelete }: { shot: TrackedShot; clubName: string; courseName: string; onDelete: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const date = new Date(shot.start.at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const reason = whyNot(shot);
  const yards = shot.yards == null ? null : Math.round(shot.yards);

  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.title}>{`${date} · ${courseName} · Hole ${shot.start.hole}`}</Text>
        {yards != null ? (
          <Text style={styles.figures}>{`${yards} yd measured · ${Math.round(shot.carry!)} yd carry`}</Text>
        ) : null}
        {reason ? <Text style={[styles.figures, { color: colors.clay }]}>{`Doesn’t count: ${reason}`}</Text> : null}
      </View>
      <Chip label="DELETE" accessibilityLabel={`Delete the ${clubName} tracked shot on hole ${shot.start.hole}, ${date}, ${yards == null ? 'no finish' : `${yards} yards`}`} onPress={onDelete} />
    </View>
  );
}

const useStyles = makeStyles(({ colors, ink, line }) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.cardDeep,
      borderWidth: 1,
      borderColor: line.card,
      borderRadius: radius.card,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    text: { flexGrow: 1, flexShrink: 1, flexBasis: 180, gap: 2 },
    title: { fontFamily: fonts.sansSemi, fontSize: 14, color: ink.full },
    figures: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: ink.soft },
  }),
);
