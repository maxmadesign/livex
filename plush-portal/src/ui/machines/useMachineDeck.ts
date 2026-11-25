import { useCallback, useMemo } from 'react';
import type { MachineControls } from '../../game/machines/ids';
import { useApp, useSettings, useT, useUi } from '../context';
import { lobbyButton, plateLow, plateParams } from './view';

/**
 * What the control deck shows for the machine being played (docs/design/machines.md, section 4.11):
 *   - lobby: the MACHINES button (test id `menu-machines`) → Game.openLobby; shown when the lobby is
 *     on and more than one machine is offered, enabled at a round boundary;
 *   - staff: "Call staff" on the bridge (test id `menu-staff`) → Game.machineAction('staff'),
 *     highlighted while the box is stuck;
 *   - controls / onStep: the bridge's two-step buttons (test ids `step-1`, `step-2`) when
 *     machines.bridge.controls is 'twoStep';
 *   - plate: the coin plate text ("TRIES 2/5", "TIME 0:42"), on machines other than classic.
 */
export interface MachineDeck {
  lobby: { visible: boolean; enabled: boolean; onPress: () => void };
  staff: { visible: boolean; enabled: boolean; highlighted: boolean; onPress: () => void };
  controls: MachineControls;
  /** Which two-step button is live ('x' = button 1, 'z' = button 2), null when both are. */
  axisStage: 'x' | 'z' | null;
  onStep: (step: 1 | 2, pressed: boolean) => void;
  /** Null on classic (its plate is part of the cabinet: FREE PLAY). */
  plate: { text: string; low: boolean } | null;
}

export function useMachineDeck(): MachineDeck {
  const app = useApp();
  const t = useT();
  const machine = useUi((s) => s.machine);
  const phase = useUi((s) => s.phase);
  const demo = useUi((s) => s.demo);
  const modal = useUi((s) => s.modal);
  const themeBusy = useUi((s) => s.themeBusy);
  const lobbySetting = useSettings((s) => s.machines.lobby);
  const hidden = useSettings((s) => s.machines.hidden.join(','));
  const home = useSettings((s) => s.machines.home);
  // The offered machines change with the settings, the debug override and the machine slice; the
  // phase is in the dependencies so a change the slice does not show is picked up at the next round.
  const offered = useMemo(() => app.game.machineCards().length, [app, machine, lobbySetting, hidden, home, phase]);
  const lobby = lobbyButton(machine, lobbySetting, offered, modal !== null || themeBusy);
  const onLobby = useCallback(() => app.game.openLobby(), [app]);
  const onStaff = useCallback(() => {
    app.game.machineAction('staff');
  }, [app]);
  const onStep = useCallback((step: 1 | 2, pressed: boolean) => app.game.stepInput(step, pressed), [app]);
  const player = !demo && phase !== 'ATTRACT';
  const plate = machine.id === 'classic' ? null : { text: t(machine.plate.key, plateParams(machine.plate)), low: plateLow(machine) };
  return {
    lobby: { ...lobby, onPress: onLobby },
    staff: {
      visible: machine.genre === 'bridge' && player,
      enabled: machine.staff.available && !themeBusy,
      highlighted: machine.staff.highlighted,
      onPress: onStaff,
    },
    controls: machine.controls,
    axisStage: machine.axisStage,
    onStep,
    plate,
  };
}
