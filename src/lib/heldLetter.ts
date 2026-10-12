// Which letter of a word a singer stretches when they hold it: "you" → the u ("youuuu"), "day" → the a ("daaaay").
// It is the last vowel that is really sung: a silent final "e" ("love") and a "y" at the end ("day") don't count.

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const VOWEL_RE = /[aeiouàáâãäåèéêëìíîïòóôõöùúûüœæıаеёиоуыэюяіїєαεηιουωάέήίόύώ]/iu;
const LETTER_RE = /\p{L}/u;

/** Position (in `word`, which may end in a space or punctuation) of the letter that grows, or -1 when there are no letters. */
export function heldLetterIndex(word: string): number {
  const chars = Array.from(word);
  const letters: number[] = [];
  chars.forEach((c, i) => {
    if (LETTER_RE.test(c)) letters.push(i);
  });
  if (!letters.length) return -1;
  let end = letters.length; // exclusive: letters[0..end) are the ones considered
  const at = (k: number) => chars[letters[k]];

  // Chinese, Japanese, Korean: one sung beat per character, so the last one is stretched.
  for (let k = letters.length - 1; k >= 0; k--) if (CJK_RE.test(at(k))) return letters[k];

  // A silent final "e" ("love", "time") is not the sung vowel, if there is a vowel before it.
  if (end >= 3 && /^e$/i.test(at(end - 1)) && !VOWEL_RE.test(at(end - 2)) && !/^y$/i.test(at(end - 2))) {
    let other = false;
    for (let k = 0; k < end - 1; k++) if (VOWEL_RE.test(at(k))) other = true;
    if (other) end--;
  }
  for (let k = end - 1; k >= 0; k--) if (VOWEL_RE.test(at(k))) return letters[k];
  // "sky", "my": the y is the vowel. No vowel at all ("hmm", "shh"): the last letter.
  for (let k = end - 1; k >= 0; k--) if (/^y$/i.test(at(k))) return letters[k];
  return letters[end - 1];
}
