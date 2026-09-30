import { describe, expect, it } from 'vitest';
import { pickAlbumCover, pickCover, similarity } from '../cover';

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

  it('accepts a slightly different spelling of the same song by the same artist', () => {
    const got = pickCover([r('Tamly Maak', 'Amr Diab', 'Tamally Maak', 'amr')], { name: 'Tamally Maak', artists: ['Amr Diab'], album: 'Tamally Maak' });
    expect(got).toContain('/amr/600x600bb.jpg');
    expect(similarity('tamallymaak', 'tamlymaak')).toBeGreaterThanOrEqual(0.8);
  });
});

describe('pickAlbumCover', () => {
  const a = (collectionName: string, artistName: string, id: string) => ({
    collectionName,
    artistName,
    artworkUrl100: `https://is1-ssl.mzstatic.com/image/thumb/${id}/100x100bb.jpg`,
  });

  it("finds the song's album by the same artist", () => {
    const results = [a('Tamally Maak - Single', 'Isaac Roman', 'cover'), a('Tamally Maak', 'Amr Diab', 'album')];
    expect(pickAlbumCover(results, { name: 'Tamally Maak', artists: ['Amr Diab'], album: 'Tamally Maak' })).toContain('/album/600x600bb.jpg');
  });

  it('returns nothing without an album name or a matching artist', () => {
    expect(pickAlbumCover([a('Hits', 'Someone', 'x')], { name: 'Song', artists: ['Someone'], album: '' })).toBeNull();
    expect(pickAlbumCover([a('Hits', 'Other Band', 'x')], { name: 'Song', artists: ['Someone'], album: 'Hits' })).toBeNull();
  });
});
