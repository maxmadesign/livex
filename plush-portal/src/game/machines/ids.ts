/**
 * Machine ids and the small unions around them. No imports: the settings spec, the UI, the AI
 * guide and the server all use this file (docs/design/machines.md, section 2.2).
 */
export const GENRE_IDS = ['classic', 'bridge', 'shelf', 'rush'] as const;
export type GenreId = (typeof GENRE_IDS)[number];
/** Every registered machine. A data-only variant adds an id here and an entry in registry.ts. */
export const MACHINE_IDS = ['classic', 'bridge', 'shelf', 'rush'] as const;
export type MachineId = (typeof MACHINE_IDS)[number];
export const DEFAULT_MACHINE: MachineId = 'classic';
export type MachineControls = 'joystick' | 'twoStep';
export type SessionKind = 'open' | 'tries' | 'timed';
export type SessionState = 'idle' | 'running' | 'over';
export type SessionEndReason = 'tries' | 'time' | 'abandoned';
