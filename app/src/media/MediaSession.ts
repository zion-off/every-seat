import { VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { createShakaPlayer, ShakaError } from './shaka';

export const MEDIA_EVENTS = [
  'loadedmetadata',
  'canplay',
  'play',
  'playing',
  'pause',
  'seeking',
  'seeked',
  'waiting',
  'ended',
  'error',
  'timeupdate',
  'volumechange',
] as const;

export type MediaEventName = (typeof MEDIA_EVENTS)[number];

export type MediaListener = (name: MediaEventName) => void;

export type AudioRendition = {
  id: number;
  label: string;
  language: string;
  active: boolean;
  raw: any;
};

/** Owns the W3C video element and the Shaka player, and fans media events out to listeners. */
export class MediaSession {
  private video: VideoPlayer | null = null;
  private shaka: any = null;
  private surface: string | null = null;
  private pendingPlay = false;
  private listeners = new Set<MediaListener>();
  private destroyed = false;
  onError: (e: ShakaError | Error) => void = () => undefined;

  addListener(l: MediaListener) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  private emit(name: MediaEventName) {
    this.listeners.forEach((l) => l(name));
  }

  get element(): VideoPlayer | null {
    return this.video;
  }

  get currentTime(): number {
    return this.video ? this.video.currentTime : 0;
  }

  get duration(): number {
    return this.video && Number.isFinite(this.video.duration)
      ? this.video.duration
      : 0;
  }

  get paused(): boolean {
    return this.video ? this.video.paused : true;
  }

  get volume(): number {
    return this.video ? this.video.volume : 1;
  }

  set volume(v: number) {
    if (this.video) {
      this.video.volume = Math.min(1, Math.max(0, v));
    }
  }

  /** `audioLabel` picks the audio rendition from the first buffered second, so nothing switches later. */
  async load(url: string, audioLabel?: string): Promise<void> {
    const video = new VideoPlayer();
    await video.initialize();
    if (this.destroyed) {
      video.deinitializeSync(1500);
      return;
    }
    MEDIA_EVENTS.forEach((n) => video.addEventListener(n, () => this.emit(n)));
    video.autoplay = false;
    this.video = video;
    if (this.surface) {
      video.setSurfaceHandle(this.surface);
    }
    this.shaka = createShakaPlayer(video, (e) => this.onError(e));
    if (audioLabel) {
      this.shaka.configure({ preferredAudioLabel: audioLabel });
    }
    await this.shaka.load(url);
  }

  onSurfaceViewCreated(handle: string) {
    this.surface = handle;
    if (this.video) {
      this.video.setSurfaceHandle(handle);
      if (this.pendingPlay) {
        this.pendingPlay = false;
        this.video.play();
      }
    }
  }

  onSurfaceViewDestroyed(handle: string) {
    this.video?.clearSurfaceHandle(handle);
    this.surface = null;
  }

  /** Playback waits for the surface so the first frames are not dropped. */
  play() {
    if (!this.video) {
      return;
    }
    if (this.surface) {
      this.video.play();
    } else {
      this.pendingPlay = true;
    }
  }

  pause() {
    this.pendingPlay = false;
    this.video?.pause();
  }

  seek(t: number) {
    if (this.video) {
      this.video.currentTime = Math.max(0, t);
    }
  }

  audioRenditions(): AudioRendition[] {
    if (!this.shaka) {
      return [];
    }
    return this.shaka.getVariantTracks().map((t: any) => ({
      id: t.id,
      label: t.label || '',
      language: t.language,
      active: t.active,
      raw: t,
    }));
  }

  activeAudioLabel(): string | null {
    return this.audioRenditions().find((r) => r.active)?.label ?? null;
  }

  /**
   * Switches the audio rendition without flushing the buffer, so playback continues seamlessly.
   * The change takes effect after about one buffer length.
   */
  selectAudio(label: string): boolean {
    const target = this.audioRenditions().find((r) => r.label === label);
    if (!target || !this.shaka) {
      return false;
    }
    if (!target.active) {
      this.shaka.selectVariantTrack(target.raw, false);
    }
    return true;
  }

  destroy() {
    this.destroyed = true;
    this.listeners.clear();
    try {
      this.video?.pause();
      if (this.shaka) {
        this.shaka.detach();
        this.shaka.destroy();
        this.shaka = null;
      }
      this.video?.clearSurfaceHandle('');
      this.video?.deinitializeSync(1500);
    } catch (e) {
      console.error('media teardown failed', e);
    }
    this.video = null;
  }
}
