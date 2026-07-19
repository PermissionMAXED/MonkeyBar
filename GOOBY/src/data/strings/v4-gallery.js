// V4/G59: gallery strings (PLAN4 §E0.1-8) — OWNED BY AGENT G59.
// Photo-gallery keys (§C-SYS9: Fotos tab, viewer, share/save/delete, empty
// state, HUD/profile discoverability, first-photo hint, quota toast) plus the
// §C-SYS5.4 secret-slot RENDER chrome („Geheim" title + hint line — the
// herzGooby sticker's own name/flavor keys are G53's, v4-core.js).
// Merged into data/strings.js by G53's single 4.0 spread (§E0.1-8). Until the
// spread lands, systems/gallery.logic.js's tG() resolves these directly
// (§E0.1-11 seam). Rule unchanged: every key exists in BOTH EN and DE.

/** @type {Record<string, string>} */
export const EN = {
  // --- Album third tab + grid (§C-SYS9.2) ---
  'album.tab.photos': 'Photos',
  'gallery.footnote': 'Oldest photos get replaced',
  'gallery.empty': 'Take your first photo! 📸',
  'gallery.emptyCta': 'To photo mode',

  // --- Viewer (§C-SYS9.2) ---
  'gallery.share': 'Share/Save',
  'gallery.delete': 'Delete',
  'gallery.confirmDelete': 'Delete photo?',

  // --- Export / persistence toasts (§C-SYS9.1/9.4) ---
  'gallery.full': 'Photo album is full — could not save.',
  'gallery.shareFailed': 'Sharing not possible — download started',

  // --- Discoverability (§C-SYS9.3) ---
  'gallery.hint': 'Your photo is saved in the album! 📖',
  'gallery.viewInAlbum': 'View in album',
  'profile.galleryRow': 'Gallery ({n} photos)',
  'profile.albumRows': 'Album',

  // --- §C-SYS5.4 secret sticker slot (render half) ---
  'stickerbook.secret': 'Secret',
  'stickerbook.secretHint': 'A secret code word unlocks it…',
};

/** @type {Record<string, string>} */
export const DE = {
  // --- Album third tab + grid (§C-SYS9.2) ---
  'album.tab.photos': 'Fotos',
  'gallery.footnote': 'Älteste Fotos werden ersetzt',
  'gallery.empty': 'Mach dein erstes Foto! 📸',
  'gallery.emptyCta': 'Zum Fotomodus',

  // --- Viewer (§C-SYS9.2) ---
  'gallery.share': 'Teilen/Sichern',
  'gallery.delete': 'Löschen',
  'gallery.confirmDelete': 'Foto löschen?',

  // --- Export / persistence toasts (§C-SYS9.1/9.4) ---
  'gallery.full': 'Fotoalbum ist voll — Speichern nicht möglich.',
  'gallery.shareFailed': 'Teilen nicht möglich — Download gestartet',

  // --- Discoverability (§C-SYS9.3) ---
  'gallery.hint': 'Dein Foto ist im Album gespeichert! 📖',
  'gallery.viewInAlbum': 'Im Album ansehen',
  'profile.galleryRow': 'Galerie ({n} Fotos)',
  'profile.albumRows': 'Album',

  // --- §C-SYS5.4 secret sticker slot (render half) ---
  'stickerbook.secret': 'Geheim',
  'stickerbook.secretHint': 'Ein geheimes Codewort schaltet ihn frei…',
};
