// Shared image export (PLAN4 §C-SYS9.4 — agent V4/G59). The photo-mode
// share/download chain, EXTRACTED here so the gallery viewer and photo mode
// ship the same pipeline:
//   native (Capacitor):  write PNG via @capacitor/filesystem (Directory.Cache)
//                        → Share.share({ files: [uri] }) — the iOS sheet
//                        offers „Bild sichern" without photo-library plumbing.
//                        Both plugins load through GUARDED dynamic imports
//                        (the established haptics/notifications pattern) —
//                        web builds never hard-require them.
//   web:                 navigator.canShare({files}) → navigator.share, else
//                        the <a download> anchor chain (desktop/dev).
//   failure:             toast 'gallery.shareFailed' („Teilen nicht möglich —
//                        Download gestartet") + the anchor fallback.

import { tG, toastG } from '../systems/gallery.logic.js';

/** True inside a Capacitor native shell (guarded probe — §E7 pattern). */
function isNative() {
  return !!globalThis.Capacitor?.isNativePlatform?.();
}

/**
 * Resolve a Capacitor plugin: runtime bridge first, then a guarded dynamic
 * import with a NON-LITERAL specifier so Rollup/Vite never resolve it at
 * build time (core/notifications.js precedent).
 * @param {string} bridgeName Capacitor.Plugins key
 * @param {string} pkg npm specifier
 * @param {string} exportName module export
 * @returns {Promise<object|null>}
 */
async function nativePlugin(bridgeName, pkg, exportName) {
  const cap = globalThis.Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  if (cap.Plugins?.[bridgeName]) return cap.Plugins[bridgeName];
  try {
    const specifier = pkg;
    const mod = await import(/* @vite-ignore */ specifier);
    return mod?.[exportName] ?? null;
  } catch (err) {
    console.warn(`[shareImage] ${pkg} unavailable:`, err?.message);
    return null;
  }
}

/** @param {Blob} blob @returns {Promise<string>} raw base64 (no data: prefix) */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/** The <a download> anchor chain (extracted verbatim from photo mode). */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  // CDP/dev proof hook: the anchor path leaves an inspectable trace.
  if (import.meta.env?.DEV) window.__goobyLastDownload = { name: filename, at: Date.now() };
}

/**
 * §C-SYS9.4 native path: Filesystem write (Directory.Cache) → Share sheet.
 * @param {Blob} blob @param {string} filename
 * @returns {Promise<boolean>} true when the sheet was presented
 */
async function shareNative(blob, filename) {
  const fs = await nativePlugin('Filesystem', '@capacitor/filesystem', 'Filesystem');
  const share = await nativePlugin('Share', '@capacitor/share', 'Share');
  if (!fs || !share) return false;
  const written = await fs.writeFile({
    path: filename,
    data: await blobToBase64(blob),
    directory: 'CACHE',
  });
  if (!written?.uri) return false;
  try {
    await share.share({ files: [written.uri] });
  } catch (err) {
    if (err?.message?.toLowerCase?.().includes('cancel')) return true; // user closed the sheet
    throw err;
  }
  return true;
}

/**
 * Share or save one image blob (§C-SYS9.4): native sheet → web share →
 * download fallback. A failed NATIVE share always toasts 'gallery.shareFailed'
 * („Teilen nicht möglich — Download gestartet"); the gallery viewer also opts
 * into that toast for the no-share-API desktop fallback (`toastOnFallback` —
 * photo mode keeps its silent v3 download behavior, it toasts photoSaved).
 * @param {Blob} blob PNG to export
 * @param {{ui?: {toast: Function}, filename?: string, toastOnFallback?: boolean}} [opts]
 * @returns {Promise<{ok: boolean, via: 'native'|'webshare'|'download'}>}
 */
export async function shareImage(blob, { ui, filename, toastOnFallback = false } = {}) {
  const name = filename ?? `gooby-${Date.now()}.png`;
  let failed = false;

  if (isNative()) {
    try {
      if (await shareNative(blob, name)) return { ok: true, via: 'native' };
      failed = true;
    } catch (err) {
      failed = true;
      console.warn('[shareImage] native share failed, falling back:', err?.message);
    }
  }

  const file = new window.File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return { ok: true, via: 'webshare' };
    } catch (err) {
      if (err?.name === 'AbortError') return { ok: true, via: 'webshare' }; // user closed the sheet
      failed = true;
      console.warn('[shareImage] web share failed, falling back:', err?.message);
    }
  }
  if (failed || toastOnFallback) {
    if (typeof ui?.toast === 'function') toastG(ui, 'gallery.shareFailed');
    else console.warn('[shareImage]', tG('gallery.shareFailed'));
  }
  downloadBlob(blob, name);
  return { ok: true, via: 'download' };
}
