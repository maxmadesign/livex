import { useCallback, useId, type ReactNode } from 'react';
import { DIFFICULTY_KEYS, GRAPHICS_PRESET_KEYS } from '../../app/presets';
import { hasString } from '../../i18n';
import { getFieldAt, getValueAt, type Field as FieldSpec } from '../../settings/spec';
import { useApp, useLang, useSettings, useT } from '../context';

const DIFFICULTY_PATHS = new Set(DIFFICULTY_KEYS.map((k) => `gameplay.${k}`));
const GRAPHICS_PATHS = new Set(GRAPHICS_PRESET_KEYS.map((k) => `graphics.${k}`));

/**
 * Returns the setter used by every control. Editing a value that belongs to a
 * preset (difficulty / graphics quality) marks that preset as "custom", so the
 * UI never shows a preset name that no longer matches its values.
 */
export function useSetter(): (path: string, value: unknown) => void {
  const app = useApp();
  return useCallback(
    (path: string, value: unknown) => {
      const store = app.settings.getState();
      store.set(path, value);
      if (DIFFICULTY_PATHS.has(path)) store.set('gameplay.difficulty', 'custom');
      if (GRAPHICS_PATHS.has(path)) store.set('graphics.preset', 'custom');
    },
    [app],
  );
}

/** i18n key of a setting: profile settings share their labels across presets. */
export function labelKey(path: string): string {
  const m = /^profiles\.[a-z0-9]+\.(layout|view)\.(.+)$/.exec(path);
  return m ? `set.${m[1]}.${m[2]}` : `set.${path}`;
}

function format(value: number, field: FieldSpec & { kind: 'num' }): string {
  const decimals = field.step >= 1 ? 0 : field.step >= 0.1 ? 1 : field.step >= 0.01 ? 2 : 3;
  const text = value.toFixed(decimals);
  if (!field.unit) return text;
  return field.unit === '°' ? `${text}°` : `${text} ${field.unit}`;
}

export function Section({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h3 className="pp-sec">{title}</h3>
      {children}
    </>
  );
}

interface FieldProps {
  path: string;
  /** Show percent instead of the raw 0..1 value. */
  percent?: boolean;
  /** Disable the control with an explanation (capability missing in this browser / model). */
  disabledReason?: string | null;
  /** Rows for long text. */
  rows?: number;
  placeholder?: string;
}

/** One setting: label, control chosen from the spec, optional hint and "after this round" badge. */
export function Field({ path, percent, disabledReason, rows, placeholder }: FieldProps) {
  const t = useT();
  const lang = useLang();
  const set = useSetter();
  const id = useId();
  const field = getFieldAt(path);
  const value = useSettings((s) => getValueAt(s, path));
  if (!field) return null;
  const key = labelKey(path);
  const disabled = !!disabledReason;
  const hint = hasString(lang, `${key}.hint`) || hasString('en', `${key}.hint`) ? t(`${key}.hint`) : null;
  const later = field.apply !== 'live';
  let control: ReactNode = null;
  let stack = false;

  switch (field.kind) {
    case 'num': {
      const v = value as number;
      control = (
        <div className="pp-control">
          <input
            id={id}
            className="pp-range"
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={v}
            disabled={disabled}
            onChange={(e) => set(path, Number(e.target.value))}
            data-testid={`field-${path}`}
          />
          <output htmlFor={id}>{percent ? `${Math.round(v * 100)}%` : format(v, field)}</output>
        </div>
      );
      break;
    }
    case 'bool':
      control = (
        <div className="pp-control" style={{ justifyContent: 'flex-end' }}>
          <button
            id={id}
            type="button"
            role="switch"
            className="pp-toggle"
            aria-checked={value as boolean}
            disabled={disabled}
            onClick={() => set(path, !(value as boolean))}
            data-testid={`field-${path}`}
          />
        </div>
      );
      break;
    case 'enum': {
      const options = field.options as readonly string[];
      control =
        options.length <= 5 ? (
          <div className="pp-seg" role="group" data-testid={`field-${path}`}>
            {options.map((o) => (
              <button key={o} type="button" aria-pressed={o === value} disabled={disabled} onClick={() => set(path, o)} data-value={o}>
                {t(`${key}.o.${o}`)}
              </button>
            ))}
          </div>
        ) : (
          <select id={id} className="pp-select" value={value as string} disabled={disabled} onChange={(e) => set(path, e.target.value)} data-testid={`field-${path}`}>
            {options.map((o) => (
              <option key={o} value={o}>
                {t(`${key}.o.${o}`)}
              </option>
            ))}
          </select>
        );
      break;
    }
    case 'str':
      if (field.maxLen > 200) {
        stack = true;
        control = (
          <textarea
            id={id}
            className="pp-textarea"
            rows={rows ?? 5}
            value={value as string}
            maxLength={field.maxLen}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => set(path, e.target.value)}
            data-testid={`field-${path}`}
          />
        );
      } else {
        control = (
          <input
            id={id}
            className="pp-input"
            type="text"
            value={value as string}
            maxLength={field.maxLen}
            placeholder={placeholder}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => set(path, e.target.value)}
            data-testid={`field-${path}`}
          />
        );
      }
      break;
    case 'vec3': {
      const v = value as number[];
      control = (
        <div className="pp-vec" data-testid={`field-${path}`}>
          {[0, 1, 2].map((i) => (
            <input
              key={i}
              className="pp-input"
              type="number"
              inputMode="decimal"
              step={field.step}
              min={field.min}
              max={field.max}
              value={v[i]}
              disabled={disabled}
              aria-label={`${t(key)} ${'xyz'[i]}`}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                const next = [...v];
                next[i] = n;
                set(path, next);
              }}
            />
          ))}
        </div>
      );
      break;
    }
    default:
      return null;
  }

  return (
    <div className={`pp-field${stack ? ' stack' : ''}`} data-path={path}>
      <label htmlFor={id}>
        {t(key)}
        {later ? <span className="later">{t('settings.afterRound')}</span> : null}
      </label>
      {control}
      {disabledReason ? <div className="hint">{disabledReason}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

/** A row that looks like a field but hosts a custom control. */
export function Row({ label, hint, children, stack }: { label: string; hint?: string | null; children: ReactNode; stack?: boolean }) {
  return (
    <div className={`pp-field${stack ? ' stack' : ''}`}>
      <label>{label}</label>
      <div className="pp-control">{children}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}
