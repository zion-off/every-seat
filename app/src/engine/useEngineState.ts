import { useEffect, useState } from 'react';
import { EngineState, PlaybackEngine } from './PlaybackEngine';

/** The engine's published state, so small components redraw without the whole screen. */
export const useEngineState = (engine: PlaybackEngine): EngineState => {
  const [state, setState] = useState(engine.getState());
  useEffect(() => {
    setState(engine.getState());
    return engine.subscribe(setState);
  }, [engine]);
  return state;
};
