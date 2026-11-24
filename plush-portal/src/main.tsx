import '@fontsource-variable/fredoka/index.css';
import '@fontsource/zcool-kuaile/400.css';
import '@fontsource/noto-sans-sc/500.css';
import '@fontsource/m-plus-rounded-1c/700.css';
import './brand/fonts.css';
import './ui/hud.css';
import './ui/game.css';
import './ui/frame.css';
import './ui/calibration.css';
// The brand-kit theme's overrides of every surface above (last, so they win at equal specificity).
import './ui/theme-gpu.css';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

// StrictMode is intentionally not used: it would create the WebGL context and physics world twice.
createRoot(document.getElementById('root')!).render(<App />);
