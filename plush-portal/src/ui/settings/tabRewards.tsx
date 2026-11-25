import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ACTIVE_BRAND } from '../../brand';
import { winCardGeometry } from '../../rewards/cardLayout';
import { createRewardClient, type RewardResult } from '../../rewards/client';
import { REWARDS_DEMO_BUILD } from '../../rewards/policy';
import { fillClaimTemplate, isSafeHttpUrl, type RewardsStatusBody } from '../../rewards/protocol';
import { useApp, useLang, useSettings, useT, useUi } from '../context';
import { WinCard, useCardEnvironment, type RewardView } from '../RewardCard';
import { useHudLayout } from '../useHudLayout';
import { Field, Row, Section, useSetter } from './Field';

/** Tab icon: a gift box with a QR corner (drawn here; the shared icon set has no gift). */
export function IconGift() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="9" width="17" height="11.5" rx="2" />
      <path d="M3.5 13h17M12 9v11.5" />
      <path d="M12 9c-1.6-3.6-6.2-4.2-6.2-1.6C5.8 9 9 9 12 9zM12 9c1.6-3.6 6.2-4.2 6.2-1.6C18.2 9 15 9 12 9z" />
    </svg>
  );
}

type StatusState = { loading: true } | { loading: false; result: RewardResult<RewardsStatusBody> };

/** Asks the server once when the tab opens (and on "Check again"). */
function useRewardsStatus(): { status: StatusState; refresh: () => void } {
  const [status, setStatus] = useState<StatusState>({ loading: true });
  const mounted = useRef(true);
  const refresh = useCallback(() => {
    setStatus({ loading: true });
    void createRewardClient()
      .status()
      .then((result) => {
        if (mounted.current) setStatus({ loading: false, result });
      });
  }, []);
  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);
  return { status, refresh };
}

/** A link setting with a check: only http(s) links without credentials are used (src/rewards/protocol.ts). */
function UrlField({ path, value, invalidKey }: { path: 'rewards.claimUrl' | 'rewards.swagUrl'; value: string; invalidKey: string }) {
  const t = useT();
  const set = useSetter();
  const bad = value.trim() !== '' && !isSafeHttpUrl(value.trim());
  return (
    <div className="pp-field stack" data-path={path}>
      <label htmlFor={`field-${path}`}>{t(`set.${path}`)}</label>
      <input
        id={`field-${path}`}
        className="pp-input"
        type="url"
        inputMode="url"
        value={value}
        maxLength={300}
        placeholder={t(`set.${path}.placeholder`)}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={bad}
        onChange={(e) => set(path, e.target.value)}
        data-testid={`field-${path}`}
      />
      <div className="hint" data-testid={bad ? `invalid-${path}` : undefined}>
        {bad ? t(invalidKey) : t(`set.${path}.hint`)}
      </div>
    </div>
  );
}

/** What the preview QR encodes: the claim page address with a placeholder code (no code is issued). */
export function previewClaimUrl(claimUrl: string, status: RewardsStatusBody | null): string | null {
  const own = claimUrl.trim();
  if (own && isSafeHttpUrl(own)) return fillClaimTemplate(own, 'PREVIEW');
  if (status && status.claimBase) return `${status.claimBase.replace(/\/+$/, '')}/c/PREVIEW`;
  return null;
}

/**
 * The card as it will look on this screen, over the dialog, labelled PREVIEW. Nothing is issued:
 * the code is a placeholder and the QR only opens the claim page address.
 */
function RewardPreview({ url, localOnly, onClose }: { url: string | null; localOnly: boolean; onClose: () => void }) {
  const t = useT();
  const app = useApp();
  const layout = useHudLayout();
  const env = useCardEnvironment(layout);
  const lang = useLang();
  const themeId = useUi((s) => s.themeId);
  const thumbs = useUi((s) => s.thumbnails);
  const rewards = useSettings((s) => s.rewards);
  const anchor = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  const [opened] = useState(() => Date.now());
  // Drawn over the dialog in the HUD's root, where the real card would be.
  useLayoutEffect(() => setHost(anchor.current?.closest('.pp-root') ?? null), []);
  const asset = app.game.library.assets(themeId).find((a) => thumbs[a.id]) ?? app.game.library.assets(themeId)[0];
  const name = asset ? asset.name[lang] : '';
  const view: RewardView = {
    state: 'preview',
    url,
    code: null,
    options: rewards.options,
    visibleUntil: opened + rewards.qrSeconds * 1000,
    totalMs: rewards.qrSeconds * 1000,
    reason: null,
    discountText: rewards.discountText,
    localOnly,
  };
  const geometry = winCardGeometry(layout, { withPoints: false, kind: 'qr', label: true, screenWidthM: env.screenWidthM });
  const overlay = (
    <div className="pp-hud pp-reward-preview" data-testid="reward-preview" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <WinCard
        layout={layout}
        geometry={geometry}
        view={view}
        themeId={themeId}
        title={t('result.won.title')}
        subtitle={t('result.won.subtitle', { name })}
        thumb={asset ? (thumbs[asset.id] ?? null) : null}
        thumbAlt={name}
        newLabel={null}
        countLine={null}
        points={null}
        ribbon={null}
        testId="reward-preview-card"
        actions={
          <div className="pp-menu pp-result-actions">
            <button type="button" className="pp-btn accent" onClick={onClose} data-testid="reward-preview-close">
              {t('rewards.preview.close')}
            </button>
          </div>
        }
      />
    </div>
  );
  return (
    <>
      <span ref={anchor} hidden />
      {host ? createPortal(overlay, host) : null}
    </>
  );
}

/* --------------------------------------------------------------- Rewards */

export function RewardsTab() {
  const t = useT();
  const lang = useLang();
  const set = useSetter();
  const mode = useSettings((s) => s.rewards.mode);
  const claimUrl = useSettings((s) => s.rewards.claimUrl);
  const swagUrl = useSettings((s) => s.rewards.swagUrl);
  const locked = useSettings((s) => s.system.lockSettings);
  const { status, refresh } = useRewardsStatus();
  const [preview, setPreview] = useState(false);
  const closePreview = useCallback(() => setPreview(false), []);
  const body = !status.loading && status.result.ok ? status.result.body : null;
  // The theme this build's brand kit dresses, by its kit name (no event name is hard-coded here).
  const kitTheme = ACTIVE_BRAND.themeName[lang];
  const ownLink = claimUrl.trim() !== '' && isSafeHttpUrl(claimUrl.trim());

  let server: string;
  if (status.loading) server = t('rewards.status.loading');
  else if (!status.result.ok) server = t(status.result.reason === 'forbidden' ? 'rewards.status.forbidden' : 'rewards.status.unreachable');
  else server = t(status.result.body.enabled ? 'rewards.status.on' : 'rewards.status.off');

  return (
    <>
      <Section title={t('sec.rewards.main')} />
      <p className="pp-note">{t('rewards.intro')}</p>
      {REWARDS_DEMO_BUILD ? (
        <p className="pp-note warn" data-testid="rewards-demo-build">
          {t('rewards.demoBuild')}
        </p>
      ) : null}
      <Row label={t('set.rewards.mode')} hint={t('set.rewards.mode.hint')}>
        <div className="pp-seg" role="group" data-testid="field-rewards.mode">
          {(['gtc', 'all', 'off'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => set('rewards.mode', m)} data-value={m}>
              {t(`set.rewards.mode.o.${m}`, { theme: kitTheme })}
            </button>
          ))}
        </div>
      </Row>
      <Field path="rewards.options" />
      <UrlField path="rewards.claimUrl" value={claimUrl} invalidKey="set.rewards.claimUrl.invalid" />
      <UrlField path="rewards.swagUrl" value={swagUrl} invalidKey="set.rewards.swagUrl.invalid" />
      <Field path="rewards.discountText" placeholder={t('set.rewards.discountText.placeholder')} />
      <Field path="rewards.qrSeconds" />

      <Section title={t('sec.rewards.status')} />
      <dl className="pp-kv" data-testid="rewards-status" data-state={status.loading ? 'loading' : status.result.ok ? (status.result.body.enabled ? 'on' : 'off') : status.result.reason}>
        <dt>{t('rewards.status.server')}</dt>
        <dd data-testid="rewards-server">{server}</dd>
        {body ? (
          <>
            <dt>{t('rewards.status.claimPage')}</dt>
            <dd data-testid="rewards-claim-base">{ownLink ? claimUrl.trim() : body.claimBase || t('rewards.status.none')}</dd>
            <dt>{t('rewards.status.reach')}</dt>
            <dd data-testid="rewards-reach" data-reach={ownLink ? 'external' : body.reach}>
              {t(`rewards.reach.${ownLink ? 'external' : body.reach}`)}
            </dd>
            <dt>{t('rewards.status.ttl')}</dt>
            <dd>{t('rewards.status.hours', { hours: body.ttlHours })}</dd>
          </>
        ) : null}
      </dl>
      {body && !ownLink && body.reach === 'loopback' ? (
        <p className="pp-note warn" data-testid="rewards-loopback-warning" role="alert">
          {t('rewards.status.loopbackWarn')}
        </p>
      ) : null}
      {body && body.enabled ? (
        <p className="pp-note" data-testid={body.canIssue ? 'rewards-can-issue' : 'rewards-cannot-issue'}>
          {t(body.canIssue ? 'rewards.status.canIssue' : 'rewards.status.cannotIssue')}
        </p>
      ) : null}
      {mode === 'off' ? <p className="pp-note">{t('rewards.status.modeOff')}</p> : null}
      {mode !== 'off' && !locked ? (
        // Unlocked settings let anyone at the booth point later QR codes or the swag link elsewhere.
        <p className="pp-note warn" role="note" data-testid="rewards-lock-warn">
          {t('rewards.lockWarn')}
        </p>
      ) : null}
      <div className="pp-actions">
        <button type="button" className="pp-btn small soft" onClick={refresh} disabled={status.loading} data-testid="rewards-refresh">
          {t('rewards.refresh')}
        </button>
        {body && body.canIssue ? (
          <a className="pp-btn small soft" href="/staff/rewards" target="_blank" rel="noopener noreferrer" data-testid="rewards-staff-link" style={{ textDecoration: 'none' }}>
            {t('rewards.staffPage')}
          </a>
        ) : null}
        <button type="button" className="pp-btn small accent" onClick={() => setPreview(true)} data-testid="rewards-preview">
          {t('rewards.preview')}
        </button>
      </div>
      <p className="pp-note">{t('rewards.preview.hint')}</p>
      {preview ? <RewardPreview url={previewClaimUrl(claimUrl, body)} localOnly={!!body && !ownLink && body.reach === 'loopback'} onClose={closePreview} /> : null}
    </>
  );
}
