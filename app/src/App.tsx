import { ThemeProvider } from '@amazon-devices/kepler-ui-components';
import { useHideSplashScreenCallback } from '@amazon-devices/react-native-kepler';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BackHandler } from 'react-native';
import { TitleEntry } from './catalog';
import { combineLens, couchNames } from './lens/lens';
import { PEOPLE, Person, personById } from './lens/people';
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
  const [couch, setCouch] = useState<string[]>([]);
  const [title, setTitle] = useState<TitleEntry | null>(null);

  const people = useMemo(
    () => couch.map(personById).filter((p): p is Person => p !== undefined),
    [couch],
  );
  const lens = useMemo(() => combineLens(people), [people]);

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

  const acceptNotice = useCallback(() => {
    markNoticeSeen();
    setRoute('couch');
  }, []);

  const toggle = useCallback((id: string) => {
    setCouch((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      return PEOPLE.map((p) => p.id).filter((x) => next.includes(x));
    });
  }, []);

  const pick = useCallback((entry: TitleEntry) => {
    setTitle(entry);
    setRoute('player');
  }, []);

  const leavePlayer = useCallback(() => setRoute('titles'), []);

  return (
    <ThemeProvider theme={theme}>
      <>
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
      </>
    </ThemeProvider>
  );
};

export default App;
