import { useCallback } from 'react';
import type { ModalId } from '../app/gameStore';
import { useApp } from './context';

/**
 * Opens / closes dialogs. Opening any dialog pauses the round (physics, aim
 * timer, input) and silences Momo; the settings dialog additionally starts a
 * draft so changes can be previewed and cancelled.
 */
export function useModals(): { open: (id: Exclude<ModalId, null>) => void; close: (apply?: boolean) => void } {
  const app = useApp();
  const open = useCallback(
    (id: Exclude<ModalId, null>) => {
      const current = app.ui.getState().modal;
      if (current === id) return;
      if (current === 'settings') app.settings.getState().cancelEdit();
      if (id === 'settings') app.settings.getState().beginEdit();
      app.ui.setState({ modal: id });
      app.game.setModalOpen(true);
      app.audio.playSfx('ui_open');
    },
    [app],
  );
  const close = useCallback(
    (apply = false) => {
      const current = app.ui.getState().modal;
      if (current === null) return;
      if (current === 'settings') {
        const store = app.settings.getState();
        if (apply) {
          store.applyEdit();
          app.game.toast(app.ui.getState().pendingChange ? 'toast.pending' : 'toast.saved');
        }
        store.cancelEdit();
        app.tracker.setTestViewpoint(null);
        app.tracker.attachPreview(null);
        app.audio.previewTrack(null);
      }
      app.ui.setState({ modal: null });
      app.game.setModalOpen(false);
      app.audio.playSfx('ui_close');
    },
    [app],
  );
  return { open, close };
}
