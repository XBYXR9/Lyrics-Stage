import type { ComponentType } from 'react';
import type { StyleChoice, StyleId } from '../../lib/types';
import { AppleStyle } from './AppleStyle';
import { KaraokeStyle } from './KaraokeStyle';
import { KineticStyle } from './KineticStyle';
import { NeonStyle } from './NeonStyle';
import type { StyleProps } from './shared';
import { SpotlightStyle } from './SpotlightStyle';

export interface StyleMeta {
  id: StyleId;
  name: string;
  blurb: string;
  component: ComponentType<StyleProps>;
}

/** Every lyric style. Add a new one here (see docs/ADDING_A_STYLE.md). */
export const STYLES: StyleMeta[] = [
  {
    id: 'apple',
    name: 'Apple Music',
    blurb: 'Bold lines, soft word-by-word glow, wave scrolling.',
    component: AppleStyle,
  },
  {
    id: 'karaoke',
    name: 'Karaoke',
    blurb: 'Centered lines fill with color, with a bouncing ball.',
    component: KaraokeStyle,
  },
  { id: 'neon', name: 'Neon', blurb: 'Glowing words flicker on over a retro grid.', component: NeonStyle },
  {
    id: 'spotlight',
    name: 'Spotlight',
    blurb: 'One line at a time in big elegant type.',
    component: SpotlightStyle,
  },
  {
    id: 'kinetic',
    name: 'Kinetic',
    blurb: 'Words pop in like a poster — great for rap.',
    component: KineticStyle,
  },
];

export const STYLE_BY_ID = Object.fromEntries(STYLES.map((s) => [s.id, s])) as Record<StyleId, StyleMeta>;

export const styleName = (choice: StyleChoice) => (choice === 'auto' ? 'Auto' : STYLE_BY_ID[choice].name);
