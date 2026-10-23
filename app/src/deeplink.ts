import { Linking } from 'react-native';
import { TitleEntry, TITLES } from './catalog';
import { personId } from './lens/household';

export interface LensLink {
  /** Ids of the people whose settings become tonight's couch. */
  people: string[];
  /** The film to open straight away, when the link names one. */
  title: TitleEntry | null;
  /** Where to start the film, in seconds, when the link names a time. */
  at: number | null;
}

const LINK =
  /^everyseat:\/\/lens(?:\/([^/?#]+)(?:\/([^/?#]+)(?:\/([^/?#]+))?)?)?\/?(?:\?([^#]*))?(?:#.*)?$/i;

/** Reads `445`, `7:25` or `1:07:25` as seconds. */
const parseTime = (part: string | undefined): number | null => {
  if (!part || !/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(part)) {
    return null;
  }
  return part
    .split(':')
    .reduce((total, piece) => total * 60 + parseFloat(piece), 0);
};

const parsePeople = (part: string): string[] =>
  decode(part)
    .split(',')
    .map((p) => personId(p))
    .filter((p) => p.length > 0);

const decode = (part: string): string => {
  try {
    return decodeURIComponent(part.replace(/\+/g, ' '));
  } catch (e) {
    return part;
  }
};

const findTitle = (slug: string): TitleEntry | null => {
  const wanted = personId(decode(slug));
  return (
    TITLES.find(
      (t) => personId(t.folder) === wanted || personId(t.name) === wanted,
    ) ?? null
  );
};

/**
 * Reads `everyseat://lens/<people>`, `everyseat://lens/<people>/<film>` or
 * `everyseat://lens/<people>/<film>/<time>`, where `<people>` is one id or several joined by
 * commas and `<time>` is seconds or `m:ss`. The person can also come as the one query parameter
 * `everyseat://lens?person=<people>`, which is the safe form for a shell, where an `&` would cut
 * the link short. Returns null for anything else. RN 0.72's `URL` is incomplete, so this does not
 * use it.
 */
export const parseLensLink = (
  url: string | null | undefined,
): LensLink | null => {
  const match = url ? LINK.exec(url.trim()) : null;
  if (!match) {
    return null;
  }
  const [, pathPeople, pathTitle, pathTime, query] = match;
  let people = pathPeople ? parsePeople(pathPeople) : [];
  let slug = pathTitle;
  let time = pathTime;
  if (people.length === 0 && query) {
    for (const pair of query.split('&')) {
      const [key, value = ''] = pair.split('=');
      if (key === 'person') {
        people = parsePeople(value);
      } else if (key === 'title') {
        slug = value;
      } else if (key === 'at') {
        time = decode(value);
      }
    }
  }
  const title = slug ? findTitle(slug) : null;
  return people.length > 0
    ? { people, title, at: title ? parseTime(time) : null }
    : null;
};

type Listener = (link: LensLink) => void;

/**
 * Hands every lens link to `listener`: the one that launched the app, then each one that
 * arrives while it runs. Returns a function that stops listening.
 */
export const watchLensLinks = (listener: Listener): (() => void) => {
  let live = true;
  const handle = (url: string | null | undefined) => {
    const link = parseLensLink(url);
    if (!live) {
      return;
    }
    if (link) {
      console.info(
        'link',
        'lens',
        link.people.join(','),
        link.title?.folder ?? '',
        link.at ?? '',
      );
    } else if (url) {
      console.info('link', 'ignored a link that is not a lens link');
    }
    if (link) {
      listener(link);
    }
  };
  Linking.getInitialURL()
    .then(handle)
    .catch(() => undefined);
  const sub = Linking.addEventListener('url', (event: { url: string }) =>
    handle(event.url),
  );
  return () => {
    live = false;
    sub.remove();
  };
};
