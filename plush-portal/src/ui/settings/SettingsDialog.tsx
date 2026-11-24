import type { HudLayout } from '../../layout/solve';
import { useT } from '../context';
import { Modal } from '../Modal';

/** Placeholder replaced by the full settings dialog. */
export default function SettingsDialog({ layout, onClose }: { layout: HudLayout; onClose: (apply?: boolean) => void }) {
  const t = useT();
  return (
    <Modal layout={layout} title={t('settings.title')} onClose={() => onClose(false)} closeLabel={t('common.close')} testId="settings">
      <p>…</p>
    </Modal>
  );
}
