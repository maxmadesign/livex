import { applyDifficultyPreset } from '../../app/presets';
import { MACHINE_IDS, type MachineId } from '../../game/machines/ids';
import { isPlayable, machineDef } from '../../game/machines/registry';
import { TIER_POINTS } from '../../game/rarity';
import { useApp, useSettings, useT } from '../context';
import { Field, Row, Section, useSetter } from './Field';

/* ------------------------------------------------------------------ Game */

export function GameplayTab() {
  const app = useApp();
  const t = useT();
  const difficulty = useSettings((s) => s.gameplay.difficulty);
  const set = app.settings.getState().set;
  return (
    <>
      <Section title={t('sec.gameplay.difficulty')} />
      <Row label={t('set.gameplay.difficulty')} hint={t('set.gameplay.difficulty.hint')}>
        <div className="pp-seg" data-testid="field-gameplay.difficulty">
          {(['easy', 'arcade', 'skill'] as const).map((d) => (
            <button key={d} type="button" aria-pressed={difficulty === d} onClick={() => applyDifficultyPreset(set, d)} data-value={d}>
              {t(`set.gameplay.difficulty.o.${d}`)}
            </button>
          ))}
          <button type="button" aria-pressed={difficulty === 'custom'} disabled data-value="custom">
            {t('set.gameplay.difficulty.o.custom')}
          </button>
        </div>
      </Row>
      <Section title={t('sec.gameplay.motion')} />
      <Field path="gameplay.moveSpeed" />
      <Field path="gameplay.moveAccel" />
      <Field path="gameplay.descendSpeed" />
      <Field path="gameplay.liftSpeed" />
      <Field path="gameplay.ropeSwing" />
      <Section title={t('sec.gameplay.grip')} />
      <Field path="gameplay.clawForce" />
      <Field path="gameplay.closeSpeed" />
      <Field path="gameplay.gripAssist" />
      <Field path="gameplay.toyFriction" />
      <Field path="gameplay.toyMass" />
      <Section title={t('sec.gameplay.round')} />
      <Field path="gameplay.aimTimeLimit" />
      <Field path="gameplay.restock" />
      <Field path="gameplay.scoring" />
      <p className="pp-note" data-testid="score-tiers">
        {t('score.tiers', { common: TIER_POINTS.common, rare: TIER_POINTS.rare, epic: TIER_POINTS.epic, legendary: TIER_POINTS.legendary })}
      </p>
      <div className="pp-actions">
        <button type="button" className="pp-btn small soft" onClick={() => app.game.restartRound()} data-testid="btn-restart-round">
          {t('btn.restartRound')}
        </button>
        <button type="button" className="pp-btn small soft" onClick={() => app.game.restockNow()} data-testid="btn-restock">
          {t('btn.restockNow')}
        </button>
      </div>
      <Section title={t('sec.gameplay.help')} />
      <Field path="gameplay.aimReticle" />
      <Field path="gameplay.aimBeam" />
      <Field path="gameplay.tips" />
      <MachinesSection />
    </>
  );
}

/* ------------------------------------------------------------------ Machines */

/** Machines other than the classic claw (docs/design/machines.md, section 4.6): every machines.* setting. */
function MachinesSection() {
  const t = useT();
  const offered = (id: MachineId) => {
    const def = machineDef(id);
    return !!def && isPlayable(def);
  };
  const group = (id: 'bridge' | 'shelf' | 'rush') => (
    <h4 className="pp-subsec" data-testid={`machines-group-${id}`}>
      {t(`set.machines.group.${id}`)}
      {offered(id) ? null : <small> · {t('set.machines.unavailable')}</small>}
    </h4>
  );
  return (
    <>
      <Section title={t('set.machines.section')} />
      <Field path="machines.home" />
      <Field path="machines.lobby" />
      <HiddenMachines />
      <Field path="machines.unlock" />
      <Field path="machines.dailyPick" />
      <Field path="machines.dailyBonus" />
      <Field path="machines.attractCycle" />
      {group('bridge')}
      <Field path="machines.bridge.controls" />
      <Field path="machines.bridge.triesPerBox" />
      <Field path="machines.bridge.gap" />
      <Field path="machines.bridge.boxMass" />
      {group('shelf')}
      <Field path="machines.shelf.tries" />
      <Field path="machines.shelf.rewardItems" />
      <Field path="machines.shelf.lipHeight" />
      {group('rush')}
      <Field path="machines.rush.seconds" />
      <Field path="machines.rush.pieces" />
      <Field path="machines.rush.rewardValue" />
    </>
  );
}

/** machines.hidden as one toggle per machine (pressed = offered in the lobby); `home` is always offered. */
function HiddenMachines() {
  const t = useT();
  const set = useSetter();
  const hidden = useSettings((s) => s.machines.hidden);
  const home = useSettings((s) => s.machines.home);
  const toggle = (id: MachineId) => {
    const next = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
    set('machines.hidden', next);
  };
  return (
    <Row label={t('set.machines.hidden')} hint={t('set.machines.hidden.hint')}>
      <div className="pp-seg" role="group" data-testid="field-machines.hidden">
        {MACHINE_IDS.map((id) => (
          <button key={id} type="button" aria-pressed={id === home || !hidden.includes(id)} disabled={id === home} onClick={() => toggle(id)} data-value={id}>
            {t(`set.machines.home.o.${id}`)}
          </button>
        ))}
      </div>
    </Row>
  );
}
