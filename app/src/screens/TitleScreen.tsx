import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Cue, loadSenseVtt } from 'sensevtt';
import { formatClock, TitleEntry, TITLES } from '../catalog';
import Backdrop from '../components/Backdrop';
import FilmTile from '../components/FilmTile';
import HeroStill from '../components/HeroStill';
import Mark from '../components/Mark';
import Pill, { PillButton } from '../components/Pill';
import { cuesUrl } from '../config';
import { LensSettings } from '../engine/types';
import { CueSummary, intensityWord, summarizeCues } from '../lens/lens';
import {
  colors,
  heat,
  safe,
  size,
  space,
  type,
  weight,
} from '../styles/tokens';

type Props = {
  couchNames: string;
  lens: LensSettings;
  /** The film last watched, so Back from the player lands on it again. */
  initialFolder?: string;
  onChangeCouch: () => void;
  onPick: (title: TitleEntry) => void;
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

const marked = (summary: CueSummary) =>
  summary.flashes + summary.loud + summary.scares;

const spokenSummary = (summary: CueSummary | null): string => {
  if (summary === null) {
    return 'Not analysed yet';
  }
  const n = marked(summary);
  if (n === 0) {
    return 'Nothing marked for this couch';
  }
  return `${plural(n, 'moment', 'moments')} marked for this couch`;
};

const pillLabels = (summary: CueSummary): string[] => {
  const labels: string[] = [];
  if (summary.flashes > 0) {
    labels.push(plural(summary.flashes, 'flash', 'flashes'));
  }
  if (summary.loud > 0) {
    labels.push(plural(summary.loud, 'loud sound', 'loud sounds'));
  }
  if (summary.scares > 0) {
    labels.push(plural(summary.scares, 'scare', 'scares'));
  }
  return labels;
};

const TitleScreen = ({
  couchNames,
  lens,
  initialFolder,
  onChangeCouch,
  onPick,
}: Props) => {
  const start = TITLES.find((t) => t.folder === initialFolder) ?? TITLES[0];
  const [focusedFolder, setFocusedFolder] = useState(start.folder);
  // Null until every cue list has been tried, so the summary never flashes a wrong answer.
  const [cues, setCues] = useState<Record<string, Cue[]> | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all(
      TITLES.map((t) =>
        loadSenseVtt(cuesUrl(t.folder))
          .then((file) => [t.folder, file.cues] as const)
          .catch(() => [t.folder, null] as const),
      ),
    ).then((entries) => {
      if (!live) {
        return;
      }
      const found: Record<string, Cue[]> = {};
      entries.forEach(([folder, list]) => {
        if (list) {
          found[folder] = list;
        }
      });
      setCues(found);
    });
    return () => {
      live = false;
    };
  }, []);

  const summaries = useMemo(() => {
    const result: Record<string, CueSummary | null> = {};
    TITLES.forEach((t) => {
      result[t.folder] =
        cues && cues[t.folder] ? summarizeCues(cues[t.folder], lens) : null;
    });
    return result;
  }, [cues, lens]);

  const hero = TITLES.find((t) => t.folder === focusedFolder) ?? TITLES[0];
  const heroSummary = summaries[hero.folder];
  const labels = heroSummary ? pillLabels(heroSummary) : [];

  return (
    <Backdrop plain>
      <HeroStill source={hero.still} id={hero.folder} />
      <View style={styles.layout}>
        <View style={styles.topBar}>
          <View style={styles.brand}>
            <Mark size={size.mark} />
            <Text style={styles.brandName}>Every Seat</Text>
          </View>
          <PillButton
            style={styles.couchPill}
            label={`On the couch: ${couchNames}`}
            accessibilityLabel={`On the couch: ${couchNames}. Press to change.`}
            onPress={onChangeCouch}
          />
        </View>

        <View style={styles.hero}>
          <View style={styles.heroText}>
            <Text style={styles.heroTitle} numberOfLines={1}>
              {hero.name}
            </Text>
            <Text style={styles.heroMeta}>
              {hero.byline} · {formatClock(hero.durationS)}
            </Text>
            <Text style={styles.blurb}>{hero.blurb}</Text>
            <Text style={styles.label}>For this couch</Text>
            <View style={styles.pills}>
              {cues !== null && heroSummary === null && (
                <Pill label="Not analysed yet" />
              )}
              {cues !== null && heroSummary !== null && labels.length === 0 && (
                <Pill label="Nothing marked for this couch" />
              )}
              {labels.map((label) => (
                <Pill key={label} label={label} style={styles.pillGap} />
              ))}
              {heroSummary !== null && heroSummary.strongest > 0 && (
                <Pill
                  label={`Strongest: ${intensityWord(heroSummary.strongest)}`}
                  dot={heat[heroSummary.strongest - 1].base}
                />
              )}
            </View>
          </View>
        </View>

        <Text style={styles.section} accessibilityRole="header">
          Choose a film
        </Text>
        <View style={styles.row}>
          {TITLES.map((t, i) => (
            <FilmTile
              key={t.folder}
              title={t}
              current={t.folder === hero.folder}
              spoken={`${formatClock(t.durationS)}. ${spokenSummary(
                summaries[t.folder],
              )}`}
              autoFocus={t.folder === start.folder}
              marginRight={i < TITLES.length - 1 ? space.lg : 0}
              onFocus={() => setFocusedFolder(t.folder)}
              onPress={() => onPick(t)}
            />
          ))}
        </View>

        <Text style={styles.credit}>
          Films: Blender Foundation | studio.blender.org, CC BY, re-encoded for
          streaming. Dimming and comfort audio are applied on this device.
        </Text>
      </View>
    </Backdrop>
  );
};

const styles = StyleSheet.create({
  layout: {
    flex: 1,
    paddingHorizontal: safe.x,
    paddingVertical: safe.y,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: size.buttonMd,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandName: {
    ...type.title,
    color: colors.text,
    fontWeight: weight.bold,
    marginLeft: space.sm,
  },
  couchPill: {
    maxWidth: size.couchPill,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
  },
  heroText: {
    width: size.heroText,
  },
  heroTitle: {
    ...type.display,
    color: colors.text,
    fontWeight: weight.bold,
  },
  heroMeta: {
    ...type.body,
    color: colors.textMuted,
    marginTop: space.xs,
  },
  blurb: {
    ...type.body,
    color: colors.text,
    marginTop: space.md,
  },
  label: {
    ...type.small,
    color: colors.textMuted,
    marginTop: space.lg,
    marginBottom: space.xs,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    minHeight: size.pill,
  },
  pillGap: {
    marginRight: space.xs,
  },
  section: {
    ...type.title,
    color: colors.text,
    fontWeight: weight.bold,
    marginBottom: space.xl,
  },
  row: {
    flexDirection: 'row',
    marginBottom: space.xs,
  },
  credit: {
    ...type.small,
    color: colors.textMuted,
  },
});

export default TitleScreen;
