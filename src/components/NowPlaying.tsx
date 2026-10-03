// Album art, song info, progress bar, playback controls and the device picker.
import { useRef, useState } from 'react';
import { formatTime, useFrame } from '../hooks/hooks';
import type { DeviceInfo, Engine, EngineState } from '../lib/engine';
import { BROWSER_PLAYER_NAME } from '../lib/engine';
import { friendlyError } from '../lib/spotify';
import { DeviceIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, VolumeDownIcon, VolumeUpIcon } from './Icons';
import { toast } from './Toasts';

const run = (p: Promise<unknown>) => p.catch((e) => toast(friendlyError(e), 'error'));

export function NowPlaying({ engine, state }: { engine: Engine; state: EngineState }) {
  const [brokenArt, setBrokenArt] = useState<string | null>(null);
  const track = state.track;
  if (!track) return null;
  const artUrl = track.artUrl !== brokenArt ? track.artUrl : null;
  return (
    <section className="np" aria-label="Now playing">
      <div className="np-art-wrap">
        {artUrl ? (
          <img
            key={track.key}
            className="np-art"
            src={artUrl}
            alt={`${track.album} cover`}
            onError={() => {
              setBrokenArt(artUrl);
              engine.coverFailed?.(artUrl);
            }}
          />
        ) : (
          <div className="np-art np-art-empty">♪</div>
        )}
      </div>
      <div className="np-meta">
        <div className="np-title" title={track.name}>
          {track.name}
        </div>
        <div className="np-artist" title={track.artists.join(', ')}>
          {track.artists.join(', ')}
        </div>
      </div>
      <Progress engine={engine} durationMs={track.durationMs} />
      <div className="np-controls">
        <button className="icon-btn" onClick={() => run(engine.previous())} aria-label="Previous">
          <PrevIcon width={26} height={26} />
        </button>
        <button className="icon-btn big" onClick={() => run(engine.togglePlay())} aria-label={state.isPlaying ? 'Pause' : 'Play'}>
          {state.isPlaying ? <PauseIcon width={34} height={34} /> : <PlayIcon width={34} height={34} />}
        </button>
        <button className="icon-btn" onClick={() => run(engine.next())} aria-label="Next">
          <NextIcon width={26} height={26} />
        </button>
      </div>
      <Volume engine={engine} volume={state.volume} />
      <DevicePicker engine={engine} state={state} />
    </section>
  );
}

/** How much one press of − or + changes Spotify's volume (percentage points). */
export const VOLUME_STEP = 10;

function Volume({ engine, volume }: { engine: Engine; volume: number | null }) {
  const change = (delta: number) => run(engine.changeVolume(delta));
  return (
    <div className="np-volume">
      <button className="icon-btn small" onClick={() => change(-VOLUME_STEP)} aria-label="Spotify volume down" title="Volume down (−)">
        <VolumeDownIcon width={20} height={20} />
      </button>
      <div
        className={`bar vol-bar${volume === null ? ' unknown' : ''}`}
        role="slider"
        aria-label="Spotify volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={volume ?? undefined}
        title={volume === null ? 'Spotify volume' : `Spotify volume ${volume}%`}
        onClick={(e) => {
          if (volume === null) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const target = Math.round(((e.clientX - rect.left) / rect.width) * 100);
          change(Math.min(100, Math.max(0, target)) - volume);
        }}
      >
        <div className="bar-track">
          <div className="bar-fill" style={{ transform: `scaleX(${(volume ?? 0) / 100})` }} />
        </div>
      </div>
      <button className="icon-btn small" onClick={() => change(VOLUME_STEP)} aria-label="Spotify volume up" title="Volume up (+)">
        <VolumeUpIcon width={20} height={20} />
      </button>
    </div>
  );
}

function Progress({ engine, durationMs }: { engine: Engine; durationMs: number }) {
  const fill = useRef<HTMLDivElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const left = useRef<HTMLSpanElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  useFrame((now) => {
    const pos = drag ?? engine.clock.now(now);
    const f = durationMs > 0 ? Math.min(1, pos / durationMs) : 0;
    if (fill.current) fill.current.style.transform = `scaleX(${f.toFixed(4)})`;
    if (elapsed.current) elapsed.current.textContent = formatTime(pos);
    if (left.current) left.current.textContent = `-${formatTime(durationMs - pos)}`;
  });

  const posFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * durationMs;
  };

  return (
    <div className="np-progress">
      <div
        className={`bar${drag !== null ? ' dragging' : ''}`}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowRight' ? 5000 : e.key === 'ArrowLeft' ? -5000 : 0;
          if (step) {
            e.stopPropagation();
            run(engine.seek(Math.max(0, engine.clock.now() + step)));
          }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(posFromEvent(e));
        }}
        onPointerMove={(e) => drag !== null && setDrag(posFromEvent(e))}
        onPointerUp={(e) => {
          if (drag === null) return;
          const target = posFromEvent(e);
          setDrag(null);
          run(engine.seek(target));
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="bar-track">
          <div className="bar-fill" ref={fill} />
        </div>
      </div>
      <div className="np-times">
        <span ref={elapsed}>0:00</span>
        <span ref={left}>-0:00</span>
      </div>
    </div>
  );
}

function DevicePicker({ engine, state }: { engine: Engine; state: EngineState }) {
  if (engine.kind === 'desktop') {
    return (
      <div className="devices">
        <span className="device-btn static">
          <DeviceIcon width={16} height={16} />
          <span>Spotify app on this computer</span>
        </span>
      </div>
    );
  }
  return <DeviceMenu engine={engine} state={state} />;
}

function DeviceMenu({ engine, state }: { engine: Engine; state: EngineState }) {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);

  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    setDevices(null);
    try {
      setDevices(await engine.listDevices());
    } catch (e) {
      toast(friendlyError(e), 'error');
      setDevices([]);
    }
  };

  const playHere = async () => {
    setOpen(false);
    try {
      await engine.enableBrowserPlayer();
      const id = engine.getState().browserPlayer.deviceId;
      if (id) await engine.transferTo(id);
      else toast('Starting the browser player… try again in a second.');
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  const bp = state.browserPlayer;
  const hasBrowserInList = devices?.some((d) => d.isThisBrowser);

  return (
    <div className="devices">
      <button className="device-btn" onClick={toggle} aria-expanded={open}>
        <DeviceIcon width={16} height={16} />
        <span>{state.device ? state.device.name : 'No device'}</span>
      </button>
      {open && (
        <div className="device-menu glass" role="menu">
          <div className="menu-title">Play on</div>
          {devices === null && <div className="menu-empty">Looking for devices…</div>}
          {devices?.map((d) => (
            <button
              key={d.id ?? d.name}
              role="menuitem"
              className={`menu-item${d.isActive ? ' active' : ''}`}
              disabled={!d.id}
              onClick={() => {
                setOpen(false);
                if (d.id) void run(engine.transferTo(d.id));
              }}
            >
              <span>{d.isThisBrowser ? `${BROWSER_PLAYER_NAME} (this browser)` : d.name}</span>
              <small>{d.isActive ? 'Playing' : d.type}</small>
            </button>
          ))}
          {!engine.isDemo && engine.canPlayHere && !hasBrowserInList && (
            <button role="menuitem" className="menu-item" onClick={playHere} disabled={bp.status === 'loading'}>
              <span>Play here (this browser)</span>
              <small>{bp.status === 'error' ? bp.message : bp.status === 'loading' ? 'Starting…' : 'Needs Premium'}</small>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
