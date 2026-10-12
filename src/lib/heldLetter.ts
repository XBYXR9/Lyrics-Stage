// Which letter of a word a singer stretches when they hold it: "you" → the u ("youuuu"), "day" → the a ("daaaay"),
// "Mustang" → the u ("Muuustang"). The app can't hear the singer, so this is a good guess: in a one-syllable word it is
// the vowel; in a longer word it is the vowel of the stressed syllable, which is the first one for most English words
// (a short list of common words stressed later, like "tonight" and "forget", is handled too).

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const VOWEL_RE = /[aeiouàáâãäåèéêëìíîïòóôõöùúûüœæıаеёиоуыэюяіїєαεηιουωάέήίόύώ]/iu;
const LETTER_RE = /\p{L}/u;
const Y_RE = /^y$/i;

/** Common words (and the start of their endings: "forget" covers "forgetting") stressed on a later syllable. */
const STRESSED_LATER = new RegExp(
  '^(?:' +
    [
      'about', 'above', 'across', 'afraid', 'again', 'against', 'ago', 'alone', 'along', 'already', 'among', 'around', 'arrive',
      'away', 'awake', 'aware', 'become', 'before', 'begin', 'behind', 'believ', 'belong', 'below', 'beneath', 'beside', 'between',
      'beyond', 'because', 'complete', 'confess', 'connect', 'control', 'decid', 'deserv', 'desir', 'destroy', 'escape', 'except',
      'excuse', 'exist', 'expect', 'explain', 'forev', 'forget', 'forgiv', 'forgot', 'hello', 'hallo', 'himself', 'herself', 'inside',
      'instead', 'invite', 'itself', 'myself', 'yourself', 'ourselves', 'themselves', 'perhaps', 'pretend', 'prevent', 'protect',
      'provide', 'receive', 'regret', 'relax', 'release', 'remember', 'repeat', 'respect', 'return', 'reveal', 'rewind', 'suppose',
      'surrender', 'surround', 'together', 'today', 'tomorrow', 'tonight', 'undo', 'unless', 'until', 'without', 'within',
    ].join('|') +
    ')',
  'i',
);

/** Position (in `word`, which may end in a space or punctuation) of the letter that grows, or -1 when there are no letters. */
export function heldLetterIndex(word: string): number {
  const chars = Array.from(word);
  const letters: number[] = [];
  chars.forEach((c, i) => {
    if (LETTER_RE.test(c)) letters.push(i);
  });
  if (!letters.length) return -1;
  const at = (k: number) => chars[letters[k]];

  // Chinese, Japanese, Korean: one sung beat per character, so the last one is stretched.
  for (let k = letters.length - 1; k >= 0; k--) if (CJK_RE.test(at(k))) return letters[k];

  // The vowel groups ("syllables"): runs of vowels, plus a "y" standing alone between consonants ("myth", "baby").
  const isVowel = (k: number) => VOWEL_RE.test(at(k)) && !Y_RE.test(at(k));
  const groups: { start: number; end: number }[] = []; // positions in `letters`, end exclusive
  for (let k = 0; k < letters.length; ) {
    if (isVowel(k)) {
      let e = k;
      while (e < letters.length && isVowel(e)) e++;
      groups.push({ start: k, end: e });
      k = e;
    } else {
      const alone = Y_RE.test(at(k)) && k > 0 && !(k > 0 && isVowel(k - 1)) && !(k + 1 < letters.length && isVowel(k + 1));
      if (alone) groups.push({ start: k, end: k + 1 });
      k++;
    }
  }
  if (!groups.length) return letters[letters.length - 1]; // "hmm", "shh": the last letter

  // Endings that aren't sung as a syllable of their own: silent final "e" ("love"), "-es" and "-ed" ("makes", "walked").
  if (groups.length > 1) {
    const last = groups[groups.length - 1];
    const lone = last.end - last.start === 1 && /^e$/i.test(at(last.start));
    const before = last.start > 0 ? at(last.start - 1) : '';
    const next = last.end < letters.length ? at(last.end).toLowerCase() : '';
    const silent =
      lone &&
      !VOWEL_RE.test(before) &&
      (last.end === letters.length ||
        (last.end === letters.length - 1 && next === 'd' && !/[td]/i.test(before)) ||
        (last.end === letters.length - 1 && next === 's' && !/[sxzcgh]/i.test(before)));
    if (silent) groups.pop();
  }

  const lettersOnly = letters.map((i) => chars[i]).join('');
  const stressed = groups.length > 1 && STRESSED_LATER.test(lettersOnly) ? 1 : 0;
  return letters[groups[stressed].end - 1]; // the last letter of that group: "you" → u, "day" → a, "heart" → a
}
