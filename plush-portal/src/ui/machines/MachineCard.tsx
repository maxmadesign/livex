import type { MachineCardInfo } from '../../app/gameStore';
import type { ThemeId } from '../../core/types';
import type { Settings } from '../../settings/spec';
import { useLang, useT } from '../context';
import { formatPoints } from '../ScoreHud';
import { MachineArt } from './art';
import { IconLock } from './DeckButtons';
import { nameKey, ruleLine } from './view';

/**
 * One machine in the lobby: its art with the genre tag, name, tagline, the short rule line, best
 * score / prizes won here / the top score, the TODAY'S PICK ribbon with its bonus, the lock in
 * unlock-by-prizes mode, and PLAY. A tap on the card focuses it; PLAY (or Enter) picks it.
 */
export function MachineCard({
  card,
  themeId,
  machines,
  focused,
  flow,
  onFocus,
  onPlay,
}: {
  card: MachineCardInfo;
  themeId: ThemeId;
  machines: Settings['machines'];
  focused: boolean;
  flow: 'row' | 'column';
  onFocus: () => void;
  onPlay: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const name = t(nameKey(card.id));
  const rule = ruleLine(card.genre, machines);
  const top = card.top[0];
  const timed = card.genre === 'rush';
  return (
    <div
      className="pp-mcard"
      role="group"
      aria-label={name}
      data-flow={flow}
      data-focused={focused}
      data-locked={card.locked}
      data-pick={card.dailyPick}
      data-current={card.current}
      data-genre={card.genre}
      data-testid={`lobby-card-${card.id}`}
      onPointerDown={onFocus}
    >
      <div className="art">
        <MachineArt id={card.id} genre={card.genre} themeId={themeId} />
        <span className="genre-tag">{t(`machines.${card.id}.tag`)}</span>
        {card.current ? <span className="now">{t('machines.lobby.current')}</span> : null}
        {card.locked ? (
          <span className="lock" data-testid={`lobby-lock-${card.id}`}>
            <IconLock />
            <span>{t('machines.lobby.locked', { n: card.winsToUnlock })}</span>
          </span>
        ) : null}
      </div>
      {card.dailyPick ? (
        <div className="pick" data-testid="lobby-pick">
          <b>{t('machines.lobby.pick')}</b>
          <span>{t('machines.lobby.bonus', { mult: machines.dailyBonus })}</span>
        </div>
      ) : null}
      <div className="info">
        <strong className="name">{name}</strong>
        <p className="tagline">{t(`machines.${card.id}.tagline`)}</p>
        <p className="howto">{t(`machines.${card.id}.howto`)}</p>
        <p className="rule">{t(rule.key, rule.params)}</p>
        <dl className="stats">
          {timed ? (
            <div data-stat="top">
              <dt>{t('machines.lobby.top')}</dt>
              <dd>{top ? `${top.initials} ${formatPoints(top.score, lang)}` : t('machines.lobby.noTop')}</dd>
            </div>
          ) : (
            <div data-stat="best">
              <dt>{t('machines.lobby.bestLabel')}</dt>
              <dd>{formatPoints(card.best, lang)}</dd>
            </div>
          )}
          <div data-stat="prizes">
            <dt>{t('machines.lobby.prizesLabel')}</dt>
            <dd>{card.prizesHere}</dd>
          </div>
        </dl>
        <button
          type="button"
          className={`pp-btn ${card.current ? 'soft' : 'accent'} play`}
          disabled={card.locked}
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          data-testid={`lobby-play-${card.id}`}
        >
          {card.current ? t('machines.lobby.current') : t('machines.lobby.play')}
        </button>
      </div>
    </div>
  );
}
