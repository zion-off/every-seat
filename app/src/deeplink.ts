import { Linking } from 'react-native';
import { TitleEntry, TITLES } from './catalog';
import { personId } from './lens/household';

export interface LensLink {
  /** Id of the person whose settings become tonight's couch. */
  person: string;
  /** The film to open straight away, when the link names one. */
  title: TitleEntry | null;
}

const LINK =
  /^everyseat:\/\/lens(?:\/([^/?#]+)(?:\/([^/?#]+))?)?\/?(?:\?([^#]*))?(?:#.*)?$/i;

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
 * Reads `everyseat://lens/<person>` or `everyseat://lens/<person>/<film>`. The person can also come
 * as the one query parameter `everyseat://lens?person=<person>`, which is the safe form for a
 * shell, where an `&` would cut the link short. Returns null for anything else. RN 0.72's `URL`
 * is incomplete, so this does not use it.
 */
export const parseLensLink = (
  url: string | null | undefined,
): LensLink | null => {
  const match = url ? LINK.exec(url.trim()) : null;
  if (!match) {
    return null;
  }
  const [, pathPerson, pathTitle, query] = match;
  let person = pathPerson ? personId(decode(pathPerson)) : '';
  let slug = pathTitle;
  if (!person && query) {
    for (const pair of query.split('&')) {
      const [key, value = ''] = pair.split('=');
      if (key === 'person') {
        person = personId(decode(value));
      } else if (key === 'title') {
        slug = value;
      }
    }
  }
  return person ? { person, title: slug ? findTitle(slug) : null } : null;
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
      console.info('link', 'lens', link.person, link.title?.folder ?? '');
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
