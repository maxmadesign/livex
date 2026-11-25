/**
 * Every machine the game knows (docs/design/machines.md, sections 2.1, 2.9 and D10). A machine is
 * data (MachineDef) plus a genre (GenreModule). A variant (narrower bars, a 60 s rush) is one more
 * MachineDef with different `params`; a new genre is one more module file.
 *
 * Gating: a machine stays `available: false` until its genre module, its tests, its sweep gates, its
 * e2e spec and the performance gate are in. Until then resolveMachine falls back to classic, so
 * players only ever see classic. The bridge, shelf and rush genres are pending here: their entries
 * carry the designed defaults and settings mapping, and their workstreams replace `pendingGenre(…)`
 * in GENRES with the real module (bridge.ts, shelf.ts, rush.ts).
 */
import type { RoundPhase } from '../../core/types';
import type { RoundParams } from '../RoundController';
import { bridgeModule } from './bridge';
import { classicModule } from './classic';
import { MACHINE_IDS, type GenreId, type MachineId } from './ids';
import type { ClawScale, GenreModule, GenreParams, MachineDef, MachineSettings, ResolvedMachine, SessionRule } from './types';

/** The difficulty preset's claw parameters scaled by a genre's multipliers (absent = ×1). */
export function scaleRoundParams(base: RoundParams, scale: ClawScale): RoundParams {
  const k = (key: keyof ClawScale) => scale[key] ?? 1;
  return {
    ...base,
    moveSpeed: base.moveSpeed * k('moveSpeed'),
    moveAccel: base.moveAccel * k('moveAccel'),
    descendSpeed: base.descendSpeed * k('descendSpeed'),
    liftSpeed: base.liftSpeed * k('liftSpeed'),
    clawForce: base.clawForce * k('clawForce'),
    closeSpeed: base.closeSpeed * k('closeSpeed'),
    ropeSwing: base.ropeSwing * k('ropeSwing'),
    gripAssist: base.gripAssist * k('gripAssist'),
  };
}

/* ------------------------------------------------------------ pending genres */

const pending = new WeakSet<object>();

/** True for a genre whose module has not landed yet (its machine can not be built). */
export function isPendingGenre(module: GenreModule): boolean {
  return pending.has(module);
}

interface PendingSpec<G extends GenreId> {
  defaults: GenreParams[G];
  presentation: 'prize' | 'items';
  awardPhases: readonly RoundPhase[];
  fromSettings: (s: MachineSettings) => Partial<GenreParams[G]>;
  session: (p: GenreParams[G]) => SessionRule;
  claw: (p: GenreParams[G]) => ClawScale;
  controls?: (p: GenreParams[G]) => 'joystick' | 'twoStep';
}

/**
 * Stand-in for a genre whose workstream has not delivered its module: the data parts (defaults,
 * settings mapping, session rule, claw scale) are the design's; anything that needs the genre's
 * physics throws. Never reached by players (the machine is unavailable, resolveMachine skips it).
 */
function pendingGenre<G extends GenreId>(genre: G, spec: PendingSpec<G>): GenreModule<G> {
  const notYet = (what: string): never => {
    throw new Error(`machine genre "${genre}": ${what} is not implemented yet`);
  };
  const module: GenreModule<G> = {
    genre,
    defaults: spec.defaults,
    presentation: spec.presentation,
    awardPhases: new Set(spec.awardPhases),
    fromSettings: spec.fromSettings,
    geometry: () => notYet('geometry'),
    session: spec.session,
    controls: (p) => spec.controls?.(p) ?? 'joystick',
    roundParams: (base, p) => scaleRoundParams(base, spec.claw(p)),
    createRules: () => notYet('createRules'),
    createField: () => notYet('createField'),
  };
  pending.add(module);
  return module;
}

const ITEM_PHASES: readonly RoundPhase[] = ['READY', 'AIMING', 'DESCENDING', 'CLOSING', 'LIFTING', 'TRANSPORTING', 'RELEASING', 'SETTLING'];

/** Defaults of section 3.2 (WS-C tunes them in shelf.ts). */
const SHELF_DEFAULTS: GenreParams['shelf'] = {
  shelfY: 0.16,
  shelfFront: -0.3,
  lipHeight: 0.014,
  shelfFriction: 0.55,
  rowsZ: [-0.39, -0.53],
  columnsX: [-0.3, -0.1, 0.1, 0.3],
  stackHeight: 3,
  tries: 5,
  rewardItems: 3,
  dropZ: -0.18,
  claw: { gripAssist: 0.6 },
};

/** Defaults of section 3.3 (WS-C tunes them in rush.ts). */
const RUSH_DEFAULTS: GenreParams['rush'] = {
  seconds: 75,
  pieces: 44,
  radiusScale: 1,
  rewardValue: 450,
  claw: { moveSpeed: 1.2, descendSpeed: 1.25, liftSpeed: 1.25, closeSpeed: 1.2 },
};

/* ------------------------------------------------------------ the registry */

export const GENRES: { readonly [G in GenreId]: GenreModule<G> } = {
  classic: classicModule,
  bridge: bridgeModule,
  shelf: pendingGenre('shelf', {
    defaults: SHELF_DEFAULTS,
    presentation: 'items',
    awardPhases: ITEM_PHASES,
    fromSettings: (s) => ({ tries: s.shelf.tries, rewardItems: s.shelf.rewardItems, lipHeight: s.shelf.lipHeight }),
    session: (p) => ({ kind: 'tries', tries: p.tries }),
    claw: (p) => p.claw,
  }),
  rush: pendingGenre('rush', {
    defaults: RUSH_DEFAULTS,
    presentation: 'items',
    awardPhases: ITEM_PHASES,
    fromSettings: (s) => ({ seconds: s.rush.seconds, pieces: s.rush.pieces, rewardValue: s.rush.rewardValue }),
    session: (p) => ({ kind: 'timed', seconds: p.seconds }),
    claw: (p) => p.claw,
  }),
};

/** Every machine, in lobby order. Only `available` machines are ever offered or built for players. */
export const MACHINES: readonly MachineDef[] = [
  { id: 'classic', genre: 'classic', order: 0, params: {}, available: true, unlockAfterWins: 0 },
  // Sweep gates passed (docs/machines/bridge.md): median 5-5.5 tries per box, one-try wins ≤ 1.9 %, stuck ≤ 4.2 %.
  { id: 'bridge', genre: 'bridge', order: 1, params: {}, available: true, unlockAfterWins: 1 },
  { id: 'shelf', genre: 'shelf', order: 2, params: {}, available: false, unlockAfterWins: 3 },
  { id: 'rush', genre: 'rush', order: 3, params: {}, available: false, unlockAfterWins: 5 },
];

export function isMachineId(id: unknown): id is MachineId {
  return typeof id === 'string' && (MACHINE_IDS as readonly string[]).includes(id);
}

export function machineDef(id: string | null | undefined): MachineDef | null {
  return MACHINES.find((m) => m.id === id) ?? null;
}

/** True when a player may get this machine: registered as available and its genre module is in. */
export function isPlayable(def: MachineDef): boolean {
  return def.available && !isPendingGenre(GENRES[def.genre]);
}

/** Builds a machine from its definition: genre defaults < settings < the definition's own params. */
export function resolveDef<G extends GenreId>(def: MachineDef<G>, settings?: MachineSettings): ResolvedMachine<G> {
  const module = GENRES[def.genre] as unknown as GenreModule<G>;
  const params = { ...module.defaults, ...(settings ? module.fromSettings(settings) : {}), ...def.params } as GenreParams[G];
  return { def, module, params, geometry: module.geometry(params), session: module.session(params), controls: module.controls(params) };
}

/**
 * The machine to build for `id`. Unknown ids, unavailable machines and pending genres fall back to
 * classic (the caller logs it). `includeUnavailable` lets tests and sweeps build a machine that is
 * not offered to players yet (its genre module must exist).
 */
export function resolveMachine(id: string | null | undefined, settings?: MachineSettings, options: { includeUnavailable?: boolean } = {}): ResolvedMachine {
  const def = machineDef(id);
  const usable = def && (def.available || options.includeUnavailable) && !isPendingGenre(GENRES[def.genre]);
  return resolveDef((usable ? def : MACHINES[0]!) as MachineDef, settings) as ResolvedMachine;
}

/** The machines the lobby offers, in order: playable and not hidden (`home` is always offered). */
export function offeredMachines(settings: Pick<MachineSettings, 'hidden'>, home: MachineId): MachineDef[] {
  return MACHINES.filter((m) => isPlayable(m) && (m.id === home || !settings.hidden.includes(m.id))).sort((a, b) => a.order - b.order);
}

/** The machines either side of `id` among `offered` (wrapping around), for neighbouring cabinets. */
export function neighbours(id: MachineId, offered: readonly MachineDef[]): { prev: MachineDef | null; next: MachineDef | null } {
  const i = offered.findIndex((m) => m.id === id);
  if (i < 0 || offered.length < 2) return { prev: null, next: null };
  return { prev: offered[(i - 1 + offered.length) % offered.length]!, next: offered[(i + 1) % offered.length]! };
}
