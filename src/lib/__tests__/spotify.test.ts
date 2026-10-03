import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth', () => ({ getAccessToken: async () => 'token', isLoggedIn: () => true }));

import { spotify } from '../spotify';

const reply = (body: string, contentType?: string, status = 200) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body, { status, headers: contentType ? { 'Content-Type': contentType } : {} }),
  );

describe('Spotify Web API replies', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts the short text id Spotify now sends back for playback commands', async () => {
    reply('oDKobkt3JfWm2hR8x', 'text/plain; charset=utf-8');
    await expect(spotify.next()).resolves.toBeNull();
    reply('oDKobkt3JfWm2hR8x');
    await expect(spotify.volume(40)).resolves.toBeNull();
  });

  it('still reads JSON answers', async () => {
    reply('{"devices":[{"id":"d1","name":"Phone"}]}', 'application/json; charset=utf-8');
    await expect(spotify.getDevices()).resolves.toEqual({ devices: [{ id: 'd1', name: 'Phone' }] });
  });

  it('treats an empty answer as nothing', async () => {
    reply('', undefined, 200);
    await expect(spotify.pause()).resolves.toBeNull();
  });
});
