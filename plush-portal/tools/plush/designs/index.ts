import type { PlushDesign } from '../dsl';
import { cosmicDesigns } from './cosmic';
import { oceanDesigns } from './ocean';
import { sakuraDesigns } from './sakura';
import { storybookDesigns } from './storybook';

/** Every character, in manifest order. Six per theme. */
export const ALL_DESIGNS: PlushDesign[] = [...sakuraDesigns, ...storybookDesigns, ...oceanDesigns, ...cosmicDesigns];
