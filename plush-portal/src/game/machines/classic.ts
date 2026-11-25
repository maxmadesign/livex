/**
 * PLUSH CLASSIC (docs/design/machines.md, section 3.4): today's claw machine, unchanged. No rules
 * object (RoundController runs its own code), the classic field geometry, ToyField, one collection
 * prize per win, an open session and the DemoPilot in attract mode.
 */
import { CLASSIC_FIELD } from '../../physics/fieldGeometry';
import { AWARD_PHASES } from '../RoundMachine';
import { ToyField } from '../ToyField';
import type { GenreModule } from './types';

export const classicModule: GenreModule<'classic'> = {
  genre: 'classic',
  defaults: {},
  presentation: 'prize',
  awardPhases: AWARD_PHASES,
  fromSettings: () => ({}),
  geometry: () => CLASSIC_FIELD,
  session: () => ({ kind: 'open' }),
  controls: () => 'joystick',
  // The difficulty preset as it is: the very same object, so nothing changes for classic.
  roundParams: (base) => base,
  createRules: () => null,
  createField: (phys, options) => new ToyField(phys, options),
};
