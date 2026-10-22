import {
  Button,
  Carousel,
  CarouselRenderInfo,
  ItemInfo,
} from '@amazon-devices/kepler-ui-components';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatClock, TitleEntry, TITLES } from '../catalog';
import { cuesUrl } from '../config';
import { loadCues } from '../engine/sensevtt';
import { Cue, LensSettings } from '../engine/types';
import { buildHeatmap } from '../lens/heatmap';
import { COLORS } from '../styles/palette';
import { scaleUxToDp } from '../utils/pixelUtils';

type Props = {
  couchNames: string;
  lens: LensSettings;
  onChangeCouch: () => void;
  onPick: (title: TitleEntry) => void;
};

type Item = TitleEntry & { moments: number | null };

const TILE_W = scaleUxToDp(560);
const TILE_H = scaleUxToDp(420);
const PAD = scaleUxToDp(20);

const momentsText = (n: number | null): string => {
  if (n === null) {
    return ' ';
  }
  if (n === 0) {
    return 'Nothing marked for this couch';
  }
  return n === 1
    ? '1 moment marked for this couch'
    : `${n} moments marked for this couch`;
};

const TitleTile = ({
  item,
  onPick,
}: {
  item: Item;
  onPick: (title: TitleEntry) => void;
}) => {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${item.name}. ${formatClock(
        item.durationS,
      )}. ${momentsText(item.moments)}`}
      onPress={() => onPick(item)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.tile, focused && styles.tileFocused]}>
      <View style={[styles.art, { backgroundColor: item.accent }]}>
        <Text style={styles.artName} numberOfLines={2}>
          {item.name}
        </Text>
      </View>
      <View style={styles.meta}>
        <Text style={styles.byline} numberOfLines={1}>
          {item.byline}
        </Text>
        <Text style={styles.runtime}>{formatClock(item.durationS)}</Text>
        <Text style={styles.moments} numberOfLines={1}>
          {momentsText(item.moments)}
        </Text>
      </View>
    </Pressable>
  );
};

const TitleScreen = ({ couchNames, lens, onChangeCouch, onPick }: Props) => {
  // The carousel is drawn once every cue list has been tried, so tiles never change after drawing.
  const [cues, setCues] = useState<Record<string, Cue[]> | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all(
      TITLES.map((t) =>
        loadCues(cuesUrl(t.folder))
          .then((file) => [t.folder, file ? file.cues : null] as const)
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

  const data: Item[] = useMemo(
    () =>
      TITLES.map((t) => ({
        ...t,
        moments:
          cues && cues[t.folder]
            ? buildHeatmap(cues[t.folder], lens, t.durationS * 1000).count
            : null,
      })),
    [cues, lens],
  );

  const ItemView = useCallback(
    ({ item }: CarouselRenderInfo<Item>) => (
      <TitleTile item={item} onPick={onPick} />
    ),
    [onPick],
  );
  const itemDimensions: ItemInfo[] = useMemo(
    () => [
      {
        view: ItemView,
        dimension: { width: TILE_W + PAD * 2, height: TILE_H },
      },
    ],
    [ItemView],
  );
  const getItemForIndex = useCallback(() => ItemView, [ItemView]);

  return (
    <View style={styles.root}>
      <Text style={styles.title} accessibilityRole="header">
        Choose a film
      </Text>
      <View style={styles.couchRow}>
        <Text style={styles.couch} numberOfLines={1}>
          On the couch: {couchNames}
        </Text>
        <Button
          label="Change couch"
          variant="secondary"
          mode="outlined"
          size="md"
          accessibilityLabel="Change who is on the couch"
          onPress={onChangeCouch}
        />
      </View>
      <View style={styles.carousel}>
        {cues && (
          <Carousel
            data={data}
            orientation="horizontal"
            itemDimensions={itemDimensions}
            itemPadding={PAD}
            renderItem={ItemView}
            getItemForIndex={getItemForIndex}
            keyProvider={(item: Item) => item.folder}
            focusIndicatorType="fixed"
            firstItemOffset={scaleUxToDp(80)}
            itemSelectionExpansion={{ widthScale: 1.08, heightScale: 1.08 }}
            hasTVPreferredFocus
          />
        )}
      </View>
      <Text style={styles.credit}>
        Films: Blender Foundation | studio.blender.org, CC BY, re-encoded for
        streaming. Dimming and comfort audio are applied on this device.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
    paddingTop: scaleUxToDp(70),
  },
  title: {
    color: COLORS.TEXT,
    fontSize: scaleUxToDp(64),
    fontWeight: '700',
    marginLeft: scaleUxToDp(100),
  },
  couchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: scaleUxToDp(100),
    marginTop: scaleUxToDp(24),
  },
  couch: {
    color: COLORS.ACCENT,
    fontSize: scaleUxToDp(34),
    marginRight: scaleUxToDp(36),
  },
  carousel: {
    height: scaleUxToDp(500),
    marginTop: scaleUxToDp(40),
  },
  tile: {
    width: TILE_W,
    height: TILE_H,
    marginHorizontal: PAD,
    borderRadius: scaleUxToDp(20),
    borderWidth: scaleUxToDp(6),
    borderColor: COLORS.TRANSPARENT,
    backgroundColor: COLORS.SURFACE,
    overflow: 'hidden',
  },
  tileFocused: {
    borderColor: COLORS.TEXT,
  },
  art: {
    height: scaleUxToDp(230),
    padding: scaleUxToDp(28),
    justifyContent: 'flex-end',
  },
  artName: {
    color: COLORS.TEXT,
    fontSize: scaleUxToDp(48),
    fontWeight: '700',
  },
  meta: {
    padding: scaleUxToDp(24),
  },
  byline: {
    color: COLORS.MUTED,
    fontSize: scaleUxToDp(26),
  },
  runtime: {
    color: COLORS.TEXT,
    fontSize: scaleUxToDp(30),
    marginTop: scaleUxToDp(6),
  },
  moments: {
    color: COLORS.ACCENT,
    fontSize: scaleUxToDp(28),
    marginTop: scaleUxToDp(10),
  },
  credit: {
    position: 'absolute',
    left: scaleUxToDp(100),
    right: scaleUxToDp(100),
    bottom: scaleUxToDp(40),
    color: COLORS.MUTED,
    fontSize: scaleUxToDp(24),
  },
});

export default TitleScreen;
