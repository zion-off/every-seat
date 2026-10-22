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
import PlayerScreen from './screens/PlayerScreen';
import TitleScreen from './screens/TitleScreen';
import { createTheme } from './styles/theme';

type Route = 'couch' | 'titles' | 'player';

const App = () => {
  const hideSplashScreen = useHideSplashScreenCallback();
  const theme = useMemo(() => createTheme(), []);
  const [route, setRoute] = useState<Route>('couch');
  const [couch, setCouch] = useState<string[]>([]);
  const [title, setTitle] = useState<TitleEntry | null>(null);

  const people = useMemo(
    () => couch.map(personById).filter((p): p is Person => p !== undefined),
    [couch],
  );
  const lens = useMemo(() => combineLens(people), [people]);

  useEffect(() => {
    hideSplashScreen();
  }, [hideSplashScreen]);

  const routeRef = useRef<Route>(route);
  routeRef.current = route;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (routeRef.current === 'titles') {
        setRoute('couch');
        return true;
      }
      // The couch screen leaves the app; the player handles its own back first.
      return routeRef.current === 'player';
    });
    return () => sub.remove();
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
        {route === 'couch' && (
          <CouchScreen
            selected={couch}
            lens={lens}
            onToggle={toggle}
            onContinue={() => setRoute('titles')}
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
            lens={lens}
            onExit={leavePlayer}
          />
        )}
      </>
    </ThemeProvider>
  );
};

export default App;
