import type { ReactElement, SVGProps } from 'react';
import type { GuideEmotion } from '../core/contracts';

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps, children: ReactElement | ReactElement[], viewBox = '0 0 24 24'): ReactElement {
  return (
    <svg viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const IconArrow = ({ dir, ...p }: IconProps & { dir: 'up' | 'down' | 'left' | 'right' }) => {
  const rot = { up: 0, right: 90, down: 180, left: 270 }[dir];
  return base(p, <path d="M12 5.2 19 13.4h-4.3V19H9.3v-5.6H5z" fill="currentColor" stroke="none" transform={`rotate(${rot} 12 12)`} />, '4 4 16 16');
};

export const IconClaw = (p: IconProps) =>
  base(p, [
    <path key="a" d="M12 2.5v5" />,
    <path key="b" d="M8.5 7.5h7l1.2 3h-9.4z" fill="currentColor" stroke="none" />,
    <path key="c" d="M8 10.5c-3 2.2-3.6 5.4-1.2 9M16 10.5c3 2.2 3.6 5.4 1.2 9M12 10.5v7.5" />,
  ]);

export const IconInfo = (p: IconProps) => base(p, [<circle key="a" cx="12" cy="6.6" r="1.5" fill="currentColor" stroke="none" />, <path key="b" d="M10 10.8h2.3V18M9.6 18h5" strokeWidth={2.8} />]);
export const IconClose = (p: IconProps) => base(p, <path d="M6 6l12 12M18 6 6 18" strokeWidth={3} />);
export const IconHeart = (p: IconProps) => base(p, <path d="M12 20s-7.2-4.4-7.2-10A4.1 4.1 0 0 1 12 7.6 4.1 4.1 0 0 1 19.2 10c0 5.6-7.2 10-7.2 10z" fill="currentColor" stroke="none" />);
export const IconPalette = (p: IconProps) =>
  base(p, [
    <path key="a" d="M12 3.5a8.5 8.5 0 1 0 0 17c1.5 0 2-1 1.4-2.2-.7-1.5.2-2.8 1.8-2.8h1.8a3.5 3.5 0 0 0 3.5-3.5c0-4.7-3.8-8.5-8.5-8.5z" />,
    <circle key="b" cx="8" cy="10" r="1.2" fill="currentColor" stroke="none" />,
    <circle key="c" cx="12" cy="7.6" r="1.2" fill="currentColor" stroke="none" />,
    <circle key="d" cx="16" cy="10" r="1.2" fill="currentColor" stroke="none" />,
  ]);
export const IconHelp = (p: IconProps) => base(p, [<path key="a" d="M9 9.2a3 3 0 1 1 4.6 2.5c-1 .7-1.6 1.3-1.6 2.6" strokeWidth={2.8} />, <circle key="b" cx="12" cy="18.2" r="1.5" fill="currentColor" stroke="none" />]);
export const IconSparkle = (p: IconProps) => base(p, <path d="M12 3l1.9 5.4L19.5 10l-5.6 1.6L12 17l-1.9-5.4L4.5 10l5.6-1.6zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor" stroke="none" />);
export const IconCamera = (p: IconProps) => base(p, [<rect key="a" x="3.5" y="7" width="17" height="12" rx="3" />, <circle key="b" cx="12" cy="13" r="3.2" />, <path key="c" d="M8.5 7 10 4.6h4L15.5 7" />]);
export const IconSpeaker = (p: IconProps) => base(p, [<path key="a" d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" fill="currentColor" stroke="none" />, <path key="b" d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.6a7.6 7.6 0 0 1 0 10.8" />]);
export const IconMute = (p: IconProps) => base(p, [<path key="a" d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" fill="currentColor" stroke="none" />, <path key="b" d="m16 9.5 5 5M21 9.5l-5 5" />]);
export const IconExpand = (p: IconProps) => base(p, <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />);
export const IconGame = (p: IconProps) => base(p, [<rect key="a" x="3" y="7.5" width="18" height="10" rx="5" />, <path key="b" d="M8 10.5v4M6 12.5h4" />, <circle key="c" cx="15.5" cy="11.5" r="1.1" fill="currentColor" stroke="none" />, <circle key="d" cx="17.8" cy="13.8" r="1.1" fill="currentColor" stroke="none" />]);
export const IconToy = (p: IconProps) => base(p, [<circle key="a" cx="12" cy="13.5" r="6" />, <circle key="b" cx="6.8" cy="7" r="2.3" />, <circle key="c" cx="17.2" cy="7" r="2.3" />, <path key="d" d="M10 13.5h.01M14 13.5h.01M10.8 16c.8.6 1.6.6 2.4 0" strokeWidth={2.2} />]);
export const IconLayout = (p: IconProps) => base(p, [<rect key="a" x="6" y="3" width="12" height="18" rx="2.5" />, <path key="b" d="M6 8.5h12M6 15.5h12" strokeDasharray="2.4 2.4" />, <rect key="c" x="9" y="11" width="6" height="2.6" rx="1.3" fill="currentColor" stroke="none" />]);
export const IconGraphics = (p: IconProps) => base(p, [<path key="a" d="M12 3.5 20 8v8l-8 4.5L4 16V8z" />, <path key="b" d="M4 8l8 4.5L20 8M12 12.5v8" />]);
export const IconBrain = (p: IconProps) => base(p, [<path key="a" d="M5 6.5h14a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5h-7L7.5 20v-3.5H5A2.5 2.5 0 0 1 2.5 14V9A2.5 2.5 0 0 1 5 6.5z" />, <path key="b" d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" strokeWidth={3} />]);
export const IconGear = (p: IconProps) =>
  base(p, [
    <circle key="a" cx="12" cy="12" r="3" />,
    <path key="b" d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" />,
  ]);
export const IconPlay = (p: IconProps) => base(p, <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />);
export const IconAgain = (p: IconProps) => base(p, [<path key="a" d="M19 12a7 7 0 1 1-2.2-5.1" strokeWidth={2.8} />, <path key="b" d="M19.5 4.5v4.2h-4.2" strokeWidth={2.8} />]);

/** PLUSH PORTAL mark: a claw inside a portal ring. */
export const LogoMark = (p: IconProps) => (
  <svg viewBox="0 0 64 64" aria-hidden="true" {...p}>
    <defs>
      <linearGradient id="pp-ring" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="var(--c-primary)" />
        <stop offset="1" stopColor="var(--c-accent)" />
      </linearGradient>
    </defs>
    <circle cx="32" cy="32" r="27" fill="#fff" stroke="url(#pp-ring)" strokeWidth="7" />
    <path d="M32 12v10" stroke="var(--c-primary-deep)" strokeWidth="5" strokeLinecap="round" />
    <rect x="24" y="21" width="16" height="8" rx="3" fill="var(--c-primary-deep)" />
    <path d="M25 29c-7 5-8 12-3 19M39 29c7 5 8 12 3 19M32 29v15" stroke="var(--c-primary-deep)" strokeWidth="5" strokeLinecap="round" fill="none" />
    <circle cx="22" cy="49" r="3.6" fill="var(--c-accent2)" />
    <circle cx="42" cy="49" r="3.6" fill="var(--c-accent2)" />
    <circle cx="32" cy="46" r="3.6" fill="var(--c-accent2)" />
  </svg>
);

/** Momo: a small round mascot drawn with soft shading so it reads as a little 3D toy. */
export function Momo({ emotion = 'calm', speaking = false }: { emotion?: GuideEmotion; speaking?: boolean }): ReactElement {
  const happy = emotion === 'happy' || emotion === 'cheer';
  const mouth = speaking
    ? <ellipse cx="50" cy="66" rx="6" ry={emotion === 'oops' ? 4 : 6.5} fill="#7a3550" />
    : emotion === 'oops'
      ? <path d="M43 68q7-6 14 0" stroke="#7a3550" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      : emotion === 'think'
        ? <path d="M44 66h10" stroke="#7a3550" strokeWidth="3.4" strokeLinecap="round" />
        : <path d={happy ? 'M41 62q9 12 18 0' : 'M43 63q7 7 14 0'} stroke="#7a3550" strokeWidth="3.4" fill={happy ? '#ff9db5' : 'none'} strokeLinecap="round" strokeLinejoin="round" />;
  const eye = (x: number) =>
    emotion === 'cheer' ? (
      <path d={`M${x - 6} 50q6-8 12 0`} stroke="#3a2030" strokeWidth="3.6" fill="none" strokeLinecap="round" />
    ) : (
      <g>
        <ellipse cx={x} cy={emotion === 'think' ? 47 : 49} rx="5" ry={emotion === 'oops' ? 6.5 : 5.8} fill="#3a2030" />
        <circle cx={x + 1.8} cy={emotion === 'think' ? 45 : 47} r="1.9" fill="#fff" />
      </g>
    );
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="momo-body" cx="38%" cy="30%" r="80%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="var(--c-paper)" />
          <stop offset="1" stopColor="var(--c-glow)" />
        </radialGradient>
        <radialGradient id="momo-ear" cx="40%" cy="30%" r="80%">
          <stop offset="0" stopColor="color-mix(in srgb, var(--c-primary) 55%, #fff)" />
          <stop offset="1" stopColor="var(--c-primary)" />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="93" rx="26" ry="5" fill="rgba(60,20,40,0.18)" />
      <ellipse cx="24" cy="26" rx="12" ry="15" fill="url(#momo-ear)" transform="rotate(-24 24 26)" />
      <ellipse cx="76" cy="26" rx="12" ry="15" fill="url(#momo-ear)" transform="rotate(24 76 26)" />
      <ellipse cx="50" cy="56" rx="38" ry="35" fill="url(#momo-body)" stroke="color-mix(in srgb, var(--c-primary) 55%, #fff)" strokeWidth="2.5" />
      <ellipse cx="29" cy="62" rx="7" ry="4.6" fill="var(--c-primary)" opacity="0.5" />
      <ellipse cx="71" cy="62" rx="7" ry="4.6" fill="var(--c-primary)" opacity="0.5" />
      {eye(36)}
      {eye(64)}
      {mouth}
      <path d="M50 14c-3-6 2-10 6-7-1 4-3 6-6 7z" fill="var(--c-accent)" />
      <ellipse cx="38" cy="34" rx="12" ry="6" fill="#fff" opacity="0.6" transform="rotate(-18 38 34)" />
    </svg>
  );
}
