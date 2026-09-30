// Windows: reads the Spotify app through Windows' media controls (the same
// info the volume/media pop-up shows: "System Media Transport Controls").
// A small PowerShell script (built into Windows) prints the state 4 times a
// second and takes commands (play, pause, skip, seek) on its input, one per line.
import type { DesktopSnapshot } from '../../src/lib/desktopTypes';
import { JsonLineProcess } from './child';
import type { DesktopCommand, SpotifyBridge } from './types';

export const SMTC_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
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
    try {
      $cmd = $line | ConvertFrom-Json
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
    } catch {}
    [Console]::Out.WriteLine((@{ reply = $cmd.id; ok = [bool]$ok } | ConvertTo-Json -Compress))
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

/**
 * Turns one line from the PowerShell loop into a snapshot. The cover image is
 * only sent when the song changes, so the caller keeps the last one. Exported for tests.
 */
export function parseWindowsLine(raw: unknown, lastArt: string | null): { snapshot: DesktopSnapshot; art: string | null } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const art = o.artChanged ? (typeof o.art === 'string' ? o.art : null) : lastArt;
  const base: DesktopSnapshot = {
    source: 'smtc',
    running: false,
    playing: false,
    track: null,
    positionMs: null,
    at: typeof o.at === 'number' ? o.at : Date.now(),
    canSeek: false,
  };
  if (o.running !== true) return { snapshot: base, art };
  const title = typeof o.title === 'string' ? o.title : '';
  const durationMs = Number(o.durationMs) || 0;
  return {
    art,
    snapshot: {
      ...base,
      running: true,
      playing: o.playing === true,
      canSeek: o.canSeek === true,
      track: title
        ? {
            uri: null,
            title,
            artist: String(o.artist ?? ''),
            album: String(o.album ?? ''),
            durationMs,
            artUrl: art,
          }
        : null,
      positionMs:
        typeof o.positionMs === 'number' ? Math.max(0, durationMs ? Math.min(o.positionMs, durationMs) : o.positionMs) : null,
    },
  };
}

/** PowerShell wants scripts as base64 UTF-16LE for -EncodedCommand. */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export class WindowsBridge implements SpotifyBridge {
  private loop: JsonLineProcess | null = null;
  private lastArt: string | null = null;
  private nextId = 1;
  private waiting = new Map<number, (ok: boolean) => void>();

  start(onSnapshot: (s: DesktopSnapshot) => void) {
    this.loop = new JsonLineProcess(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(SMTC_SCRIPT)],
      (o) => {
        const msg = o as Record<string, unknown>;
        if ('reply' in msg) {
          const done = this.waiting.get(Number(msg.reply));
          this.waiting.delete(Number(msg.reply));
          done?.(msg.ok === true);
          return;
        }
        const { snapshot, art } = parseWindowsLine(o, this.lastArt);
        this.lastArt = art;
        onSnapshot(snapshot);
      },
      () => (this.lastArt = null),
    );
    this.loop.start();
  }

  stop() {
    this.loop?.stop();
  }

  command(c: DesktopCommand): Promise<void> {
    if (c.type === 'openUri') return Promise.reject(new Error('Open songs from the Spotify app.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error('Spotify didn’t respond. Is the Spotify app open?'));
      }, 5000);
      this.waiting.set(id, (ok) => {
        clearTimeout(timer);
        if (ok) resolve();
        else reject(new Error(c.type === 'seek' ? 'Spotify doesn’t allow seeking from Windows media controls.' : 'Spotify didn’t accept that.'));
      });
      if (!this.loop?.send(JSON.stringify({ ...c, id }))) {
        clearTimeout(timer);
        this.waiting.delete(id);
        reject(new Error('Still connecting to Spotify — try again in a second.'));
      }
    });
  }
}
