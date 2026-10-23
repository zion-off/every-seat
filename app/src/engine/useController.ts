import { useEffect, useRef, useState } from 'react';
import { ControllerState, MediaAdapter, SenseController } from 'sensevtt';
import { preferencesFor } from './comfort';
import { LensSettings } from './types';

/**
 * One scheduler per player: it dims the picture, raises heads-up cards and ducks the volume for
 * the couch's lens. It is null until the player exists, and a new lens updates it in place.
 */
export const useController = (
  adapter: MediaAdapter | null,
  lens: LensSettings,
): SenseController | null => {
  const [controller, setController] = useState<SenseController | null>(null);
  const first = useRef(lens);

  useEffect(() => {
    if (!adapter) {
      return undefined;
    }
    const made = new SenseController({
      adapter,
      preferences: preferencesFor(first.current),
      log: (scope, ...args) => console.info(scope, ...args),
    });
    made.start();
    setController(made);
    return () => {
      made.destroy();
      setController(null);
    };
  }, [adapter]);

  useEffect(() => {
    if (!controller) {
      return;
    }
    console.info(
      'lens',
      JSON.stringify(lens),
      controller.clock.now().toFixed(3),
    );
    controller.setPreferences(preferencesFor(lens));
  }, [controller, lens]);

  return controller;
};

/** The controller's published state, so small components redraw without the whole screen. */
export const useControllerState = (
  controller: SenseController,
): ControllerState => {
  const [state, setState] = useState(controller.state);
  useEffect(() => {
    setState(controller.state);
    return controller.subscribe(setState);
  }, [controller]);
  return state;
};
