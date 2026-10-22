import { PlaybackEngine } from '../engine/PlaybackEngine';
import { MediaEventName, MediaSession } from '../media/MediaSession';
import { RelayClient } from './RelayClient';

/** Phones treat a clock that has been quiet for 6 s as lost, so it is repeated well within that. */
const HEARTBEAT_MS = 2000;
/** Timeupdates sent after each `playing`, once the clock has been re-anchored on real progress. */
const SETTLE_UPDATES = 2;

/** Events after which the picture's position or whether it is moving may have changed. */
const CLOCK_EVENTS: MediaEventName[] = [
  'play',
  'playing',
  'pause',
  'seeking',
  'seeked',
  'waiting',
  'ended',
];

/** The media folder name as the phone's catalog spells it: `tears_of_steel` is `tears-of-steel`. */
export const phoneTitleId = (folder: string): string =>
  folder.replace(/_/g, '-');

/**
 * Tells phones where the film is: on every play, pause, seek and stall, and every 2 s while the
 * player is open. The time is the clock of the frame on screen and the rate is 1 only while the
 * picture is moving, so a phone following it stops when the film stops. Returns a function that
 * sends a final stopped clock and ends the messages.
 */
export const startClockMessages = (
  session: MediaSession,
  engine: PlaybackEngine,
  relay: RelayClient,
  folder: string,
): (() => void) => {
  const title = phoneTitleId(folder);
  const sendNow = (reason: string, quiet = false) => {
    const mediaTime = engine.clock.now();
    const rate = engine.clock.moving ? 1 : 0;
    const sent = relay.sendClock(mediaTime, rate, title);
    if (!quiet) {
      console.info('clock', 'sent', reason, mediaTime.toFixed(3), rate, sent);
    }
  };

  // Registered after the engine's own listener, so the clock has taken the event before it is read.
  // `playing` can fire a little before the picture moves, which leaves the clock ahead by up to
  // about 0.15 s until the next `timeupdate` anchors it again, so the first two of those are sent.
  let settling = 0;
  const off = session.addListener((name) => {
    if (name === 'playing') {
      settling = SETTLE_UPDATES;
    }
    if (CLOCK_EVENTS.includes(name)) {
      sendNow(name);
    } else if (name === 'timeupdate' && settling > 0) {
      settling -= 1;
      sendNow('settle');
    }
  });
  const timer = setInterval(() => sendNow('heartbeat', true), HEARTBEAT_MS);
  sendNow('open');

  return () => {
    off();
    clearInterval(timer);
    relay.sendClock(engine.clock.now(), 0, title);
  };
};
