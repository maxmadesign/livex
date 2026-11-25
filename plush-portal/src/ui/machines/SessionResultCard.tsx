import { useMemo } from 'react';
import type { MachineUiState, SessionResultUi } from '../../app/gameStore';
import type { HudLayout } from '../../layout/solve';
import { rankingsOf } from '../../persistence/machines';
import { compactPoints, winCardGeometry } from '../../rewards/cardLayout';
import { useApp, useLang, useSettings, useT, useUi } from '../context';
import { IconAgain } from '../Icons';
import { cardKindFor, rewardViewFor, useCardEnvironment, WinCard } from '../RewardCard';
import { formatPoints } from '../ScoreHud';
import { machineArtUrl } from './art';
import { IconMachines } from './DeckButtons';
import { nameKey, sessionSubtitle, type TryRow } from './view';
import './machines.css';

interface Row {
  key: string;
  label: TryRow;
  value: string;
}

/**
 * The card at the end of a session on a tries / timed machine (docs/design/machines.md, section
 * 4.1): what dropped, the session points, the best session, the leaderboard place, and the session
 * prize with the claim QR card of the existing win card (one code per session prize, the same
 * RewardFlow, QR minimums and phone link). PLAY AGAIN starts a new session; MACHINES opens the
 * lobby. It is the win card (src/ui/RewardCard.tsx) with the session's content, so the placement in
 * the safe zone and the 86" band and the phone's compaction are the tested ones.
 */
export function SessionResultCard({ layout, card, newBest, lobby }: { layout: HudLayout; card: SessionResultUi; newBest: boolean; lobby: { visible: boolean; enabled: boolean; onPress: () => void } }) {
  const app = useApp();
  const t = useT();
  const lang = useLang();
  const machine = useUi((s) => s.machine);
  const themeId = useUi((s) => s.themeId);
  const thumbs = useUi((s) => s.thumbnails);
  const prize = useUi((s) => s.prize);
  const reward = useUi((s) => s.reward);
  const scoring = useUi((s) => s.score.enabled);
  const machines = useSettings((s) => s.machines);
  const qrSeconds = useSettings((s) => s.rewards.qrSeconds);
  const discountText = useSettings((s) => s.rewards.discountText);
  const env = useCardEnvironment(layout);
  const genre = card.machineId === machine.id ? machine.genre : card.machineId === 'rush' ? 'rush' : 'shelf';
  const asset = card.rewardTypeId ? app.game.library.assets().find((a) => a.id === card.rewardTypeId) : undefined;
  const prizeName = asset ? asset.name[lang] : null;
  // The claim block only for a session that earned a prize (its code is requested for the session's last try).
  const view = card.rewardTypeId ? rewardViewFor(reward, card.roundId, qrSeconds, discountText) : null;
  const kind = cardKindFor(view);
  const rows = useMemo(() => summaryRows(card, genre, scoring, lang), [card, genre, scoring, lang]);
  const geometry = useMemo(
    () =>
      winCardGeometry(layout, {
        withPoints: true,
        pointRows: rows.length + 1,
        kind,
        label: view?.state === 'demoBuild',
        ribbon: newBest,
        screenWidthM: env.screenWidthM,
      }),
    [layout, rows.length, kind, view?.state, newBest, env.screenWidthM],
  );
  const subtitle = sessionSubtitle(card, genre, machines, prizeName);
  const machineName = t(nameKey(card.machineId));
  const compact = compactPoints(layout, geometry.kind);
  const points = compact ? (
    <p className="pp-points-line" data-testid="session-points-line">
      <span className="pp-tier">{machineName}</span>
      <b data-testid="session-total">{formatPoints(card.points, lang)}</b>
    </p>
  ) : (
    <div className="pp-breakdown pp-session-summary" data-testid="session-summary">
      <span className="pp-tier">{machineName}</span>
      <dl>
        {rows.map((r) => (
          <div key={r.key} data-row={r.key}>
            <dt>{t(r.label.key, r.label.params)}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
        <div data-row="total" className="total">
          <dt>{t('machines.session.points')}</dt>
          <dd data-testid="session-total">{formatPoints(card.points, lang)}</dd>
        </div>
      </dl>
    </div>
  );
  const thumb = card.rewardTypeId ? (thumbs[card.rewardTypeId] ?? null) : machineArtUrl(card.machineId, genre, themeId);
  return (
    <WinCard
      layout={layout}
      geometry={geometry}
      view={view}
      themeId={themeId}
      title={t(card.reason === 'time' ? 'machines.session.timeUp' : 'machines.session.outOfTries')}
      subtitle={t(subtitle.key, subtitle.params)}
      thumb={thumb}
      thumbAlt={prizeName ?? machineName}
      newLabel={card.rewardTypeId && prize?.typeId === card.rewardTypeId && prize.isNew ? t('result.won.new') : null}
      countLine={null}
      points={points}
      dataPoints={card.points}
      ribbon={
        newBest ? (
          <span className="pp-newbest" data-testid="session-new-best">
            {t('score.newBest')}
          </span>
        ) : null
      }
      actions={
        <div className="pp-menu pp-result-actions">
          <button type="button" className="pp-btn accent" onClick={() => app.game.newSession()} data-testid="session-again">
            <IconAgain style={{ width: '1.1em', height: '1.1em' }} />
            {t('machines.session.again')}
          </button>
          {lobby.visible ? (
            <button type="button" className="pp-btn small soft" onClick={lobby.onPress} disabled={!lobby.enabled} aria-label={t('machines.session.lobby')} title={t('machines.session.lobby')} data-testid="session-lobby">
              <IconMachines />
            </button>
          ) : null}
        </div>
      }
      testId="session-card"
    />
  );
}

/** The rows above the total: what dropped, the leaderboard place, the best session. */
export function summaryRows(card: SessionResultUi, genre: MachineUiState['genre'], scoring: boolean, lang: Parameters<typeof formatPoints>[1]): Row[] {
  const rows: Row[] = [{ key: 'items', label: { key: genre === 'rush' ? 'machines.session.gems' : 'machines.session.boxes' }, value: String(card.items) }];
  if (card.rank !== null) {
    const entry = rankingsOf(card.machineId)[card.rank - 1];
    const value = entry ? `#${card.rank} ${entry.initials}` : `#${card.rank}`;
    rows.push({ key: 'rank', label: { key: 'machines.session.rank' }, value });
  }
  if (scoring) rows.push({ key: 'best', label: { key: 'machines.session.best' }, value: formatPoints(card.best, lang) });
  return rows;
}
