import type { PlushDesign } from '../dsl';
import { cosmicDesigns } from './cosmic';
import { gpuDesigns } from './gpu';
import { oceanDesigns } from './ocean';
import { sakuraDesigns } from './sakura';
import { storybookDesigns } from './storybook';

/** Every character, in manifest order. Six per theme (seven for GPU Party). */
export const ALL_DESIGNS: PlushDesign[] = [...sakuraDesigns, ...storybookDesigns, ...oceanDesigns, ...cosmicDesigns, ...gpuDesigns];
