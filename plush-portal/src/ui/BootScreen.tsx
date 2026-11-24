import { brandForTheme } from '../brand';
import { BrandLogo } from './BrandLogo';
import { useT, useUi } from './context';

/**
 * Loading screen, shown until the game has booted (and for a boot error). When the starting theme is
 * dressed by a brand kit (src/brand), it is drawn in the kit's style: the event logo on black (as
 * supplied, never animated), a green progress bar with a light sweep and a slow light field behind
 * everything. Otherwise it is the original pastel PLUSH PORTAL screen. Styles: src/ui/hud.css (.pp-boot)
 * and src/ui/theme-gpu.css (.pp-boot[data-brand]).
 */
export function BootScreen() {
  const t = useT();
  const boot = useUi((s) => s.boot);
  const themeId = useUi((s) => s.themeId);
  const kit = brandForTheme(themeId);
  const done = boot.stage === 'ready';
  const percent = Math.round(boot.progress * 100);
  return (
    <div className="pp-boot" data-done={done} data-brand={kit?.id} data-testid="boot" aria-hidden={done}>
      {kit ? <i className="pp-boot-field" aria-hidden="true" /> : null}
      <div className="pp-boot-inner">
        {kit ? (
          <div className="pp-boot-mark">
            <BrandLogo slot={kit.logo} alt={t('brand.logo.alt', { event: kit.eventName })} plate={false} testId="boot-logo" />
            <p className="pp-boot-product">
              PLUSH <i>PORTAL</i>
            </p>
          </div>
        ) : (
          <h1>
            PLUSH <i>PORTAL</i>
          </h1>
        )}
        {boot.stage === 'error' ? (
          <div className="error">
            <p>{t('boot.error.title')}</p>
            <p style={{ fontWeight: 500, opacity: 0.8, margin: '0.5em 0 1em' }}>{boot.error}</p>
            <p style={{ fontWeight: 500 }}>{t('boot.error.hint')}</p>
            <p style={{ marginTop: '1em' }}>
              <button type="button" className="pp-btn" style={{ ['--u' as string]: '1px', ['--touch' as string]: '56px' }} onClick={() => location.reload()}>
                {t('boot.retry')}
              </button>
            </p>
          </div>
        ) : (
          <>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} data-testid="boot-progress">
              <i style={{ width: `${percent}%` }} />
            </div>
            <p>{t(`boot.${boot.label}`)}</p>
          </>
        )}
      </div>
    </div>
  );
}
