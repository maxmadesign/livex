import { applyDifficultyPreset } from '../../app/presets';
import { useApp, useSettings, useT } from '../context';
import { Field, Row, Section } from './Field';

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
    </>
  );
}
