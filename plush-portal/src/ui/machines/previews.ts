/**
 * Rendered machine pictures for the lobby cards (src/scene/machines/preview.ts), made once per
 * theme the first time the lobby opens in it and then handed to the card art through
 * setMachinePreviewSource. Until they are ready (or where WebGL is missing) the SVG art stays.
 */
import type { GenreId } from '../../game/machines/ids';
import type { ThemeId } from '../../core/types';
import { renderMachinePreviews } from '../../scene/machines/preview';
import { themeOf } from '../../themes/themes';
import { setMachinePreviewSource } from './art';

const pictures = new Map<ThemeId, Partial<Record<GenreId, string>>>();
const pending = new Set<ThemeId>();

/** Starts rendering the pictures of `genres` in `themeId` unless they exist or are on their way. */
export function ensureMachinePreviews(themeId: ThemeId, genres: readonly GenreId[]): void {
  if (pictures.has(themeId) || pending.has(themeId) || genres.length === 0) return;
  pending.add(themeId);
  void renderMachinePreviews(themeOf(themeId), genres)
    .then((made) => {
      pictures.set(themeId, made);
      setMachinePreviewSource((_id, genre, theme) => pictures.get(theme)?.[genre] ?? null);
    })
    .catch(() => undefined)
    .finally(() => pending.delete(themeId));
}
