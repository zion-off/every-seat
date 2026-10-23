import demo from '../../../fixtures/demo-household.json';
import { LensSettings } from '../engine/types';
import { personId } from './household';
import { Person } from './people';

/** The demo household, from fixtures/demo-household.json. Used only when the viewer asks for it. */
export const demoPeople = (): Person[] =>
  (demo.people as Array<{ name: string; settings: LensSettings }>).map((p) => ({
    id: personId(p.name),
    name: p.name,
    settings: p.settings,
  }));
