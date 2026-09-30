import { describe, expect, it } from 'vitest';
import { pickCover } from '../cover';

const r = (trackName: string, artistName: string, collectionName: string, id: string) => ({
  trackName,
  artistName,
  collectionName,
  artworkUrl100: `https://is1-ssl.mzstatic.com/image/thumb/${id}/100x100bb.jpg`,
});

describe('pickCover', () => {
  const results = [
    r('After Hours (Live)', 'The Weeknd', 'Live At SoFi Stadium', 'live'),
    r('After Hours', 'The Weeknd', 'After Hours (Deluxe)', 'deluxe'),
    r('After Hours', 'The Weeknd', 'After Hours', 'album'),
    r('After Hours', 'Someone Else', 'After Hours', 'wrong-artist'),
  ];

  it('prefers the exact song on the same album, as a 600px image', () => {
    expect(pickCover(results, { name: 'After Hours', artists: ['The Weeknd'], album: 'After Hours' })).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/album/600x600bb.jpg',
    );
  });

  it('matches through "- Remastered" titles, accents and extra artists', () => {
    const got = pickCover([r('Déjà Vu', 'Beyoncé & Jay-Z', 'B’Day', 'bday')], {
      name: 'Deja Vu - Remastered 2011',
      artists: ['Beyoncé, JAY-Z'],
      album: "B'Day",
    });
    expect(got).toContain('/bday/600x600bb.jpg');
  });

  it('returns nothing rather than a wrong cover', () => {
    expect(pickCover([r('Other Song', 'The Weeknd', 'After Hours', 'x')], { name: 'Blinding Lights', artists: ['The Weeknd'], album: '' })).toBeNull();
    expect(pickCover([r('Blinding Lights', 'Cover Band', 'Hits', 'x')], { name: 'Blinding Lights', artists: ['The Weeknd'], album: '' })).toBeNull();
    expect(pickCover([], { name: 'Anything', artists: ['Anyone'], album: '' })).toBeNull();
  });
});
