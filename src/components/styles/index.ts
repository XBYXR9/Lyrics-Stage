import type { ComponentType } from 'react';
import type { StyleChoice, StyleId } from '../../lib/types';
import { AppleStyle } from './AppleStyle';
import { DepthStyle } from './DepthStyle';
import { FlowStyle } from './FlowStyle';
import { KaraokeStyle } from './KaraokeStyle';
import { KineticStyle } from './KineticStyle';
import { MinimalStyle } from './MinimalStyle';
import { NeonStyle } from './NeonStyle';
import { RetroStyle } from './RetroStyle';
import type { StyleProps } from './shared';
import { SpotlightStyle } from './SpotlightStyle';
import { TypewriterStyle } from './TypewriterStyle';

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
  {
    id: 'typewriter',
    name: 'Typewriter',
    blurb: 'Each line types itself out, letter by letter.',
    component: TypewriterStyle,
  },
  {
    id: 'flow',
    name: 'Gradient flow',
    blurb: 'Big words filled with slowly moving album colors.',
    component: FlowStyle,
  },
  {
    id: 'retro',
    name: 'Retro VHS',
    blurb: 'An old tape: scan lines, glitchy edges, a time code.',
    component: RetroStyle,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    blurb: 'One small, calm line at the bottom, like subtitles.',
    component: MinimalStyle,
  },
  {
    id: 'depth',
    name: '3D depth',
    blurb: 'The line you hear is up front; the rest sink back.',
    component: DepthStyle,
  },
];

export const STYLE_BY_ID = Object.fromEntries(STYLES.map((s) => [s.id, s])) as Record<StyleId, StyleMeta>;

export const styleName = (choice: StyleChoice) => (choice === 'auto' ? 'Auto' : STYLE_BY_ID[choice].name);
