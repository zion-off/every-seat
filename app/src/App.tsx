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
import { LensLink, watchLensLinks } from './deeplink';
import { LensSettings } from './engine/types';
import { demoPeople } from './lens/demo';
import {
  HouseholdContext,
  personId,
  sameIds,
  useStableValue,
} from './lens/household';
import { combineLens, couchNames } from './lens/lens';
import { Person } from './lens/people';
import {
  HouseholdMessage,
  LensMessage,
  RelayClient,
} from './relay/RelayClient';
import { RelayContext } from './relay/RelayContext';
import CouchScreen from './screens/CouchScreen';
import NoticeScreen from './screens/NoticeScreen';
import PersonEditorScreen from './screens/PersonEditorScreen';
import PlayerScreen from './screens/PlayerScreen';
import SetupScreen from './screens/SetupScreen';
import TitleScreen from './screens/TitleScreen';
import {
  hasSeenNotice,
  loadHousehold,
  markNoticeSeen,
  saveHousehold,
  StoredHousehold,
} from './storage';
import { createTheme } from './styles/theme';

type Route =
  | 'notice'
  | 'setup'
  | 'about'
  | 'couch'
  | 'editor'
  | 'titles'
  | 'player';

const App = () => {
  const hideSplashScreen = useHideSplashScreenCallback();
  const theme = useMemo(() => createTheme(), []);
  // Null until the first-run check resolves, so the notice never flashes after the couch screen.
  const [route, setRoute] = useState<Route | null>(null);
  const [household, setHouseholdState] = useState<StoredHousehold>({
    people: [],
    updatedAt: 0,
  });
  // Settings the companion set for tonight's couch only; any household change clears them.
  const [tonight, setTonight] = useState<Record<string, LensSettings>>({});
  const [couch, setCouch] = useState<string[]>([]);
  const [title, setTitle] = useState<TitleEntry | null>(null);
  // The person being edited (null for a new one) and the screen the editor leaves to.
  const [editing, setEditing] = useState<string | null>(null);
  const [editorBack, setEditorBack] = useState<Route>('couch');
  // The card that takes focus back on the couch screen after the editor closes.
  const [lastEdited, setLastEdited] = useState<string | undefined>();

  const householdRef = useRef(household);
  householdRef.current = household;
  // True once a household has been stored on this TV or received from the companion.
  const hasHousehold = useRef(false);

  const people = useMemo(
    () =>
      household.people
        .filter((p) => couch.includes(p.id))
        .map((p) => (tonight[p.id] ? { ...p, settings: tonight[p.id] } : p)),
    [household, couch, tonight],
  );
  // The same object while the settings are the same, so an identical lens from the relay changes nothing.
  const lens = useStableValue(useMemo(() => combineLens(people), [people]));

  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([hasSeenNotice(), loadHousehold()]).then(([seen, stored]) => {
      if (!live) {
        return;
      }
      if (stored) {
        hasHousehold.current = true;
        householdRef.current = stored;
        setHouseholdState(stored);
      }
      setRoute(!seen ? 'notice' : stored ? 'couch' : 'setup');
      setLoaded(true);
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
      // The couch and first-run screens leave the app; the editor and the player handle their own back first.
      return routeRef.current === 'player' || routeRef.current === 'editor';
    });
    return () => sub.remove();
  }, []);

  // A lens from the companion names tonight's couch: the people it names are on the couch, with its settings.
  const lastLens = useRef('');
  const applyLens = useCallback((message: LensMessage) => {
    const incoming = message.people.map((p) => ({
      id: personId(p.name),
      name: p.name,
      settings: p.settings,
    }));
    const ids = incoming.map((p) => p.id);
    const overrides: Record<string, LensSettings> = {};
    incoming.forEach((p) => {
      overrides[p.id] = p.settings;
    });
    setTonight(overrides);
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

  const relayRef = useRef<RelayClient | null>(null);
  /** Takes a new household as the current one, keeps it on the TV and, unless it came from the relay, sends it. */
  const adopt = useCallback((next: StoredHousehold, send: boolean) => {
    hasHousehold.current = true;
    householdRef.current = next;
    setHouseholdState(next);
    setTonight({});
    const ids = next.people.map((p) => p.id);
    setCouch((prev) => prev.filter((id) => ids.includes(id)));
    saveHousehold(next);
    if (send) {
      relayRef.current?.sendHousehold({
        t: 'household',
        people: next.people.map(({ name, settings }) => ({ name, settings })),
        updatedAt: next.updatedAt,
      });
    }
  }, []);
  /** The latest writer wins: a household that is not newer than ours is ignored. */
  const applyHousehold = useCallback(
    (message: HouseholdMessage) => {
      if (message.updatedAt <= householdRef.current.updatedAt) {
        return;
      }
      adopt(
        {
          updatedAt: message.updatedAt,
          people: message.people.map((p) => ({
            id: personId(p.name),
            name: p.name,
            settings: p.settings,
          })),
        },
        false,
      );
      setRoute((prev) => (prev === 'setup' ? 'couch' : prev));
      AccessibilityInfo.announceForAccessibility('The household was updated');
    },
    [adopt],
  );
  const applyHouseholdRef = useRef(applyHousehold);
  applyHouseholdRef.current = applyHousehold;
  const change = useCallback(
    (next: Person[]) =>
      adopt(
        {
          people: next,
          updatedAt: Math.max(Date.now(), householdRef.current.updatedAt + 1),
        },
        true,
      ),
    [adopt],
  );

  const relay = useMemo(
    () =>
      new RelayClient({
        url: RELAY_URL,
        household: HOUSEHOLD,
        onLens: (message) => applyLensRef.current(message),
        onHousehold: (message) => applyHouseholdRef.current(message),
        // On every connection the TV offers its household; the relay keeps whichever is newer.
        onStatus: (connected) => {
          const mine = householdRef.current;
          if (connected && hasHousehold.current) {
            relayRef.current?.sendHousehold({
              t: 'household',
              people: mine.people.map(({ name, settings }) => ({
                name,
                settings,
              })),
              updatedAt: mine.updatedAt,
            });
          }
        },
      }),
    [],
  );
  relayRef.current = relay;
  // The relay starts once the stored household is read, so its first message never races the load.
  useEffect(() => {
    if (!loaded) {
      return undefined;
    }
    relay.start();
    return () => relay.stop();
  }, [relay, loaded]);

  // A link waits here until the first-run notice is out of the way, so it never skips that screen.
  const [pendingLink, setPendingLink] = useState<LensLink | null>(null);
  useEffect(() => watchLensLinks(setPendingLink), []);
  useEffect(() => {
    if (
      !pendingLink ||
      route === null ||
      route === 'notice' ||
      route === 'setup'
    ) {
      return;
    }
    setPendingLink(null);
    const person = householdRef.current.people.find(
      (p) => p.id === pendingLink.person,
    );
    if (!person) {
      console.info('link', 'no such person', pendingLink.person);
      return;
    }
    setCouch([person.id]);
    lastLens.current = '';
    AccessibilityInfo.announceForAccessibility(
      `Tonight's couch is now ${person.name}`,
    );
    if (pendingLink.title) {
      setTitle(pendingLink.title);
      setRoute('player');
    } else if (route !== 'player') {
      setRoute('titles');
    }
  }, [pendingLink, route]);

  const acceptNotice = useCallback(() => {
    markNoticeSeen();
    setRoute(hasHousehold.current ? 'couch' : 'setup');
  }, []);

  const openEditor = useCallback((id: string | null, back: Route) => {
    setEditing(id);
    setLastEdited(id ?? undefined);
    setEditorBack(back);
    setRoute('editor');
  }, []);

  const chooseDemo = useCallback(() => {
    change(demoPeople());
    setRoute('couch');
  }, [change]);

  const savePerson = useCallback(
    (person: Person) => {
      const current = householdRef.current.people;
      const at = current.findIndex((p) => p.id === editing);
      change(
        at === -1
          ? [...current, person]
          : current.map((p, i) => (i === at ? person : p)),
      );
      setLastEdited(person.id);
      if (at === -1) {
        setCouch((prev) => [...prev, person.id]);
      } else if (editing !== person.id) {
        setCouch((prev) => prev.map((id) => (id === editing ? person.id : id)));
      }
      setRoute('couch');
    },
    [change, editing],
  );

  const deletePerson = useCallback(() => {
    change(householdRef.current.people.filter((p) => p.id !== editing));
    setRoute('couch');
  }, [change, editing]);

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
      <RelayContext.Provider value={relay}>
        <HouseholdContext.Provider value={household.people}>
          {route === 'notice' && (
            <NoticeScreen mode="first-run" onDone={acceptNotice} />
          )}
          {route === 'setup' && (
            <SetupScreen
              onSetUp={() => openEditor(null, 'setup')}
              onDemo={chooseDemo}
            />
          )}
          {route === 'editor' && (
            <PersonEditorScreen
              key={editing ?? 'new'}
              person={
                household.people.find((p) => p.id === editing) ?? undefined
              }
              others={household.people.filter((p) => p.id !== editing)}
              onSave={savePerson}
              onCancel={() => setRoute(editorBack)}
              onDelete={deletePerson}
            />
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
              onAdd={() => openEditor(null, 'couch')}
              onEdit={(id) => openEditor(id, 'couch')}
              focusId={lastEdited}
            />
          )}
          {route === 'titles' && (
            <TitleScreen
              couchNames={couchNames(people)}
              lens={lens}
              initialFolder={title?.folder}
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
      </RelayContext.Provider>
    </ThemeProvider>
  );
};

export default App;
