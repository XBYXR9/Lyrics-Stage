// Windows: reads the Spotify app through Windows' media controls (the same
// info the volume/media pop-up shows: "System Media Transport Controls").
// A small PowerShell script (built into Windows) prints the state 4 times a
// second and takes commands (play, pause, skip, seek) on its input, one per line.
import type { DesktopSnapshot } from '../../src/lib/desktopTypes';
import { JsonLineProcess } from './child';
import type { CommandReply, DesktopCommand, SpotifyBridge } from './types';

export const SMTC_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
# No "Preparing modules for first use." progress notes on the error output.
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(5000)
  return $task.Result
}
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
$mgr = Await ($mgrType::RequestAsync()) $mgrType

function Get-Spotify {
  $mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -like '*spotify*' } | Select-Object -First 1
}

function Read-Art($props) {
  try {
    if ($null -eq $props.Thumbnail) { return $null }
    $ras = Await ($props.Thumbnail.OpenReadAsync()) $streamType
    if ($null -eq $ras -or $ras.Size -eq 0) { return $null }
    $type = if ($ras.ContentType) { $ras.ContentType } else { 'image/jpeg' }
    $size = [uint32]$ras.Size
    try {
      # Windows' own reader (works in plain Windows PowerShell).
      $reader = [Windows.Storage.Streams.DataReader]::new($ras.GetInputStreamAt(0))
      $null = Await ($reader.LoadAsync($size)) ([uint32])
      $bytes = New-Object byte[] $size
      $reader.ReadBytes($bytes)
      $reader.Dispose()
    } catch {
      # Fallback: .NET stream wrapper.
      $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($ras.GetInputStreamAt(0))
      $ms = New-Object System.IO.MemoryStream
      $stream.CopyTo($ms)
      $bytes = $ms.ToArray()
    }
    if ($bytes.Length -eq 0) { return $null }
    return "data:$type;base64," + [Convert]::ToBase64String($bytes)
  } catch { return $null }
}

# Spotify's volume: Windows' media controls have no volume, so we use the
# per-app volume in Windows' Volume Mixer (Core Audio). Compiled the first
# time it's needed, so a problem here can't stop the rest of the script.
$volumeCode = @'
using System;
using System.Runtime.InteropServices;

namespace LyricsStage {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorCom {}

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
  }

  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int Item(int index, out IMMDevice device);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }

  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int streamFlags, out IntPtr sessionControl);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int streamFlags, out IntPtr audioVolume);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
  }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
  }

  // Only GetProcessId is called; the methods before it keep the order Windows expects.
  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName(out IntPtr name);
    [PreserveSig] int SetDisplayName(IntPtr name, IntPtr eventContext);
    [PreserveSig] int GetIconPath(out IntPtr path);
    [PreserveSig] int SetIconPath(IntPtr path, IntPtr eventContext);
    [PreserveSig] int GetGroupingParam(out Guid grouping);
    [PreserveSig] int SetGroupingParam(IntPtr grouping, IntPtr eventContext);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
    [PreserveSig] int GetSessionIdentifier(out IntPtr id);
    [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
    [PreserveSig] int GetProcessId(out uint pid);
  }

  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    [PreserveSig] int SetMasterVolume(float level, ref Guid eventContext);
    [PreserveSig] int GetMasterVolume(out float level);
  }

  public static class AppVolume {
    // Changes the volume of these processes' audio (on every speaker/headphone) by delta (-1..1).
    // Returns the new level (0..1), or -1 if they aren't playing through any device.
    public static float Change(int[] pids, float delta) {
      IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
      IMMDeviceCollection devices;
      if (enumerator.EnumAudioEndpoints(0, 1, out devices) != 0) return -1; // speakers, active only
      int deviceCount;
      devices.GetCount(out deviceCount);
      Guid managerId = typeof(IAudioSessionManager2).GUID;
      float result = -1;
      float target = -1;
      for (int d = 0; d < deviceCount; d++) {
        IMMDevice device;
        if (devices.Item(d, out device) != 0) continue;
        object o;
        if (device.Activate(ref managerId, 23, IntPtr.Zero, out o) != 0) continue;
        IAudioSessionEnumerator sessions;
        if (((IAudioSessionManager2)o).GetSessionEnumerator(out sessions) != 0) continue;
        int sessionCount;
        sessions.GetCount(out sessionCount);
        for (int i = 0; i < sessionCount; i++) {
          IAudioSessionControl2 session;
          if (sessions.GetSession(i, out session) != 0) continue;
          uint pid;
          if (session.GetProcessId(out pid) != 0 || Array.IndexOf(pids, (int)pid) < 0) continue;
          ISimpleAudioVolume volume = session as ISimpleAudioVolume;
          if (volume == null) continue;
          if (target < 0) {
            float level;
            volume.GetMasterVolume(out level);
            target = Math.Max(0f, Math.Min(1f, level + delta));
          }
          Guid context = Guid.Empty;
          volume.SetMasterVolume(target, ref context);
          result = target;
        }
      }
      return result;
    }
  }
}
'@
$volumeReady = $false

function Set-SpotifyVolume([double]$delta) {
  if (-not $script:volumeReady) {
    Add-Type -TypeDefinition $volumeCode -Language CSharp
    $script:volumeReady = $true
  }
  $ids = @(Get-Process -Name 'Spotify' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if ($ids.Count -eq 0) { return $null }
  $level = [LyricsStage.AppVolume]::Change([int[]]$ids, [float]($delta / 100))
  if ($level -lt 0) { return $null }
  return [int][math]::Round($level * 100)
}

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$lastKey = ''
$sentArt = $null
$artTries = 0
$nextArtAt = 0

while ($true) {
  if ($pending.IsCompleted) {
    $line = $pending.Result
    if ($null -eq $line) { break }
    $pending = $stdin.ReadLineAsync()
    $ok = $false
    $volume = $null
    $problem = $null
    try {
      $cmd = $line | ConvertFrom-Json
      if ($cmd.type -eq 'volume') {
        $volume = Set-SpotifyVolume ([double]$cmd.delta)
        $ok = ($null -ne $volume)
      }
      $s = Get-Spotify
      if ($s) {
        switch ($cmd.type) {
          'playpause' { $ok = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
          'play' { $ok = Await ($s.TryPlayAsync()) ([bool]) }
          'pause' { $ok = Await ($s.TryPauseAsync()) ([bool]) }
          'next' { $ok = Await ($s.TrySkipNextAsync()) ([bool]) }
          'previous' { $ok = Await ($s.TrySkipPreviousAsync()) ([bool]) }
          'seek' { $ok = Await ($s.TryChangePlaybackPositionAsync([long]([double]$cmd.positionMs * 10000))) ([bool]) }
        }
      }
    } catch { $problem = $_.Exception.Message }
    $answer = @{ reply = $cmd.id; ok = [bool]$ok }
    if ($null -ne $volume) { $answer.volume = $volume }
    if ($null -ne $problem) { $answer.error = $problem }
    [Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress))
  }

  $out = @{ running = $false }
  try {
    $s = Get-Spotify
    if ($s) {
      $out.running = $true
      $info = $s.GetPlaybackInfo()
      $out.playing = ($info.PlaybackStatus.ToString() -eq 'Playing')
      $out.canSeek = [bool]$info.Controls.IsPlaybackPositionEnabled
      $props = Await ($s.TryGetMediaPropertiesAsync()) $propsType
      $tl = $s.GetTimelineProperties()
      $out.title = $props.Title
      $out.artist = $props.Artist
      $out.album = $props.AlbumTitle
      $out.durationMs = ($tl.EndTime - $tl.StartTime).TotalMilliseconds
      $pos = $tl.Position.TotalMilliseconds
      $updated = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      if ($out.playing -and $updated -gt 0 -and $now -gt $updated) { $pos += ($now - $updated) }
      $out.positionMs = $pos
      # When Spotify last updated the timeline (to spot one left over from the previous song).
      $out.updatedAt = $updated
      $out.at = $now
      # Cover: Spotify often shares the new title first and the picture a
      # moment later (or briefly still shows the old one), so read it when the
      # song changes and then re-check every 1.5 s: until one arrives (up to
      # ~12 s), and twice more after that in case it was the previous song's.
      $key = "$($props.Title)|$($props.Artist)|$($props.AlbumTitle)"
      if ($key -ne $lastKey) {
        $lastKey = $key
        $sentArt = Read-Art $props
        $out.art = $sentArt
        $out.artChanged = $true
        $artTries = 1
        $nextArtAt = $now + 1500
      } elseif ($now -ge $nextArtAt -and (($null -eq $sentArt -and $artTries -lt 8) -or ($null -ne $sentArt -and $artTries -lt 3))) {
        $art = Read-Art $props
        $artTries++
        $nextArtAt = $now + 1500
        if ($null -ne $art -and $art -ne $sentArt) {
          $sentArt = $art
          $out.art = $art
          $out.artChanged = $true
        }
      }
    }
  } catch { $out.error = $_.Exception.Message }
  # The position above is for the moment it was read, not after the (slower) cover read.
  if (-not $out.ContainsKey('at')) { $out.at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 250
}
`;

/** What the bridge remembers between lines from the PowerShell loop. */
export interface WindowsState {
  /** The cover is only sent when it changes, so keep the last one. */
  art: string | null;
  /** The song we saw last, and when it started showing. */
  key: string | null;
  changedAt: number;
  /** True while Windows still shows the previous song's timeline for a new song. */
  staleTimeline: boolean;
}

export const WINDOWS_START: WindowsState = { art: null, key: null, changedAt: 0, staleTimeline: false };

/**
 * When the song changes, Spotify updates the title right away but can leave
 * the previous song's timeline (position and length) in place for a while.
 * A timeline last updated this long before the song changed is that leftover.
 */
const STALE_TIMELINE_MS = 3000;

/** Turns one line from the PowerShell loop into a snapshot. Exported for tests. */
export function parseWindowsLine(raw: unknown, prev: WindowsState): { snapshot: DesktopSnapshot; state: WindowsState } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const art = o.artChanged ? (typeof o.art === 'string' ? o.art : null) : prev.art;
  const base: DesktopSnapshot = {
    source: 'smtc',
    running: false,
    playing: false,
    track: null,
    positionMs: null,
    at: typeof o.at === 'number' ? o.at : Date.now(),
    canSeek: false,
  };
  if (o.running !== true) return { snapshot: base, state: { ...WINDOWS_START, art } };
  const title = typeof o.title === 'string' ? o.title : '';
  const artist = String(o.artist ?? '');
  const album = String(o.album ?? '');
  const playing = o.playing === true;
  const key = title ? `${title}|${artist}|${album}` : null;
  const updatedAt = typeof o.updatedAt === 'number' && o.updatedAt > 0 ? o.updatedAt : null;

  let { changedAt, staleTimeline } = prev;
  if (key !== prev.key) {
    changedAt = base.at;
    // Only for a change we saw happen: the first song we see may simply not have been touched in a while.
    staleTimeline = prev.key !== null && key !== null && updatedAt !== null && updatedAt < changedAt - STALE_TIMELINE_MS;
  } else if (staleTimeline && updatedAt !== null && updatedAt >= changedAt - STALE_TIMELINE_MS) {
    staleTimeline = false; // Spotify caught up
  }

  let durationMs = Number(o.durationMs) || 0;
  let positionMs =
    typeof o.positionMs === 'number' ? Math.max(0, durationMs ? Math.min(o.positionMs, durationMs) : o.positionMs) : null;
  if (staleTimeline) {
    // Don't trust the old song's numbers: the length is unknown for now, and
    // the new song has been playing for about as long as its title has shown.
    durationMs = 0;
    positionMs = playing ? Math.max(0, base.at - changedAt) : 0;
  }
  return {
    state: { art, key, changedAt, staleTimeline },
    snapshot: {
      ...base,
      running: true,
      playing,
      canSeek: o.canSeek === true,
      track: title ? { uri: null, title, artist, album, durationMs, artUrl: art } : null,
      positionMs,
    },
  };
}

function windowsCommandError(c: DesktopCommand): string {
  if (c.type === 'seek') return 'Spotify doesn’t allow seeking from Windows media controls.';
  if (c.type === 'volume') return 'Couldn’t change Spotify’s volume. Is Spotify playing?';
  return 'Spotify didn’t accept that.';
}

/** PowerShell wants scripts as base64 UTF-16LE for -EncodedCommand. */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export class WindowsBridge implements SpotifyBridge {
  private loop: JsonLineProcess | null = null;
  private state: WindowsState = WINDOWS_START;
  private nextId = 1;
  private waiting = new Map<number, (reply: Record<string, unknown>) => void>();

  start(onSnapshot: (s: DesktopSnapshot) => void) {
    this.loop = new JsonLineProcess(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(SMTC_SCRIPT)],
      (o) => {
        const msg = o as Record<string, unknown>;
        if ('reply' in msg) {
          const done = this.waiting.get(Number(msg.reply));
          this.waiting.delete(Number(msg.reply));
          done?.(msg);
          return;
        }
        const { snapshot, state } = parseWindowsLine(o, this.state);
        this.state = state;
        onSnapshot(snapshot);
      },
      () => (this.state = WINDOWS_START),
    );
    this.loop.start();
  }

  stop() {
    this.loop?.stop();
  }

  command(c: DesktopCommand): Promise<CommandReply | void> {
    if (c.type === 'openUri') return Promise.reject(new Error('Open songs from the Spotify app.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.waiting.delete(id);
          reject(new Error('Spotify didn’t respond. Is the Spotify app open?'));
        },
        // The first volume change sets up the volume helper, which takes a moment.
        c.type === 'volume' ? 15000 : 5000,
      );
      this.waiting.set(id, (reply) => {
        clearTimeout(timer);
        if (reply.ok === true) resolve(typeof reply.volume === 'number' ? { volume: reply.volume } : undefined);
        else reject(new Error(windowsCommandError(c)));
      });
      if (!this.loop?.send(JSON.stringify({ ...c, id }))) {
        clearTimeout(timer);
        this.waiting.delete(id);
        reject(new Error('Still connecting to Spotify — try again in a second.'));
      }
    });
  }
}
