import { ThemeProvider } from '@amazon-devices/kepler-ui-components';
import { useHideSplashScreenCallback } from '@amazon-devices/react-native-kepler';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AccessibilityInfo, BackHandler } from 'react-native';
import { TitleEntry } from './catalog';
import { HOUSEHOLD, RELAY_URL } from './config';
import {
  HouseholdContext,
  mergePeople,
  personId,
  sameIds,
  useStableValue,
} from './lens/household';
import { combineLens, couchNames } from './lens/lens';
import { PEOPLE, Person } from './lens/people';
import { LensMessage, RelayClient } from './relay/RelayClient';
import CouchScreen from './screens/CouchScreen';
import NoticeScreen from './screens/NoticeScreen';
import PlayerScreen from './screens/PlayerScreen';
import TitleScreen from './screens/TitleScreen';
import { hasSeenNotice, markNoticeSeen } from './storage';
import { createTheme } from './styles/theme';

type Route = 'notice' | 'about' | 'couch' | 'titles' | 'player';

const App = () => {
  const hideSplashScreen = useHideSplashScreenCallback();
  const theme = useMemo(() => createTheme(), []);
  // Null until the first-run check resolves, so the notice never flashes after the couch screen.
  const [route, setRoute] = useState<Route | null>(null);
  const [household, setHousehold] = useState<Person[]>(PEOPLE);
  const [couch, setCouch] = useState<string[]>([]);
  const [title, setTitle] = useState<TitleEntry | null>(null);

  const people = useMemo(
    () => household.filter((p) => couch.includes(p.id)),
    [household, couch],
  );
  // The same object while the settings are the same, so an identical lens from the relay changes nothing.
  const lens = useStableValue(useMemo(() => combineLens(people), [people]));

  useEffect(() => {
    let live = true;
    hasSeenNotice().then((seen) => {
      if (live) {
        setRoute(seen ? 'couch' : 'notice');
      }
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (route !== null) {
      hideSplashScreen();
    }
  }, [route, hideSplashScreen]);

  const routeRef = useRef<Route | null>(route);
  routeRef.current = route;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (routeRef.current === 'titles' || routeRef.current === 'about') {
        setRoute('couch');
        return true;
      }
      // The couch and first-run screens leave the app; the player handles its own back first.
      return routeRef.current === 'player';
    });
    return () => sub.remove();
  }, []);

  // A lens from the companion names tonight's couch: known people take its settings, new names join.
  const lastLens = useRef('');
  const applyLens = useCallback((message: LensMessage) => {
    const incoming = message.people.map((p) => ({
      id: personId(p.name),
      name: p.name,
      settings: p.settings,
    }));
    const ids = incoming.map((p) => p.id);
    setHousehold((prev) => mergePeople(prev, incoming));
    setCouch((prev) => (sameIds(prev, ids) ? prev : ids));
    const key = JSON.stringify(incoming);
    if (key !== lastLens.current) {
      lastLens.current = key;
      AccessibilityInfo.announceForAccessibility(
        `Tonight's couch is now ${couchNames(incoming)}`,
      );
    }
  }, []);
  const applyLensRef = useRef(applyLens);
  applyLensRef.current = applyLens;
  useEffect(() => {
    const client = new RelayClient({
      url: RELAY_URL,
      household: HOUSEHOLD,
      onLens: (message) => applyLensRef.current(message),
    });
    client.start();
    return () => client.stop();
  }, []);

  const acceptNotice = useCallback(() => {
    markNoticeSeen();
    setRoute('couch');
  }, []);

  const toggle = useCallback((id: string) => {
    setCouch((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const pick = useCallback((entry: TitleEntry) => {
    setTitle(entry);
    setRoute('player');
  }, []);

  const leavePlayer = useCallback(() => setRoute('titles'), []);

  return (
    <ThemeProvider theme={theme}>
      <HouseholdContext.Provider value={household}>
        {route === 'notice' && (
          <NoticeScreen mode="first-run" onDone={acceptNotice} />
        )}
        {route === 'about' && (
          <NoticeScreen mode="about" onDone={() => setRoute('couch')} />
        )}
        {route === 'couch' && (
          <CouchScreen
            selected={couch}
            lens={lens}
            onToggle={toggle}
            onContinue={() => setRoute('titles')}
            onAbout={() => setRoute('about')}
          />
        )}
        {route === 'titles' && (
          <TitleScreen
            key={JSON.stringify(lens)}
            couchNames={couchNames(people)}
            lens={lens}
            onChangeCouch={() => setRoute('couch')}
            onPick={pick}
          />
        )}
        {route === 'player' && title && (
          <PlayerScreen
            key={title.folder}
            title={title.folder}
            name={title.name}
            lens={lens}
            selected={couch}
            couchLabel={couchNames(people)}
            onToggle={toggle}
            onExit={leavePlayer}
          />
        )}
      </HouseholdContext.Provider>
    </ThemeProvider>
  );
};

export default App;
