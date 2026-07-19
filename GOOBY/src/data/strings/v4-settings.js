// V4/G53: v4-settings.js stub (PLAN4 §E0.1-8) — OWNED BY AGENT G58.
// Settings-IA strings (§C-SYS12.1 rows, §C-SYS12.2 hint chip, §C-SYS8.1/8.2
// gyro toggle + permission copy). G58 adds its keys here — always EN + DE.
// No other agent may edit this module.

/** @type {Record<string, string>} */
export const EN = {
  // §C-SYS12.1 main-list rows (rows 1/2/8 reuse the existing v1/v3 keys
  // settings.language / settings.notifications / settings.devRow).
  'settings.row.display': 'Display',
  'settings.row.audio': 'Audio',
  'settings.row.radio': 'Radio',
  'settings.row.radio.sub': 'Stations, tracks & shuffle',
  'settings.row.codes': 'Codes',
  'settings.row.credits': 'Credits',
  // §C-SYS12.2 one-time hint chip (session-only, not persisted)
  'settings.hint.v4': 'Reorganized! Audio & Display now have sub-pages',
  // subscreen titles (§B9 back-chevron sheets)
  'settings.sub.display': 'Display',
  'settings.sub.audio': 'Audio',
  // Audio subscreen link row → G52's per-track subscreen (§C-SYS1.5)
  'settings.tracks.link': 'Music & radio',
  'settings.tracks.missing': 'Track settings not built yet (G52)',
  'settings.radio.missing': 'Radio not built yet (G52)',
  // §C-SYS8.1 gyro toggle (exact copy)
  'settings.gyro': 'Gyro parallax',
  'settings.gyro.sub': 'Move your phone — peek deeper into the room',
  // §C-SYS8.2 permission denied toast (exact copy)
  'settings.gyro.denied': 'No permission — parallax stays off',
  // desktop/no-sensor fallback note (§C-SYS8.2/8.4)
  'settings.gyro.pointer': 'No gyro sensor — pointer parallax active',
};

/** @type {Record<string, string>} */
export const DE = {
  'settings.row.display': 'Anzeige',
  'settings.row.audio': 'Audio',
  'settings.row.radio': 'Radio',
  'settings.row.radio.sub': 'Sender, Tracks & Shuffle',
  'settings.row.codes': 'Codes',
  'settings.row.credits': 'Credits',
  'settings.hint.v4': 'Neu sortiert! Audio & Anzeige haben jetzt Unterseiten',
  'settings.sub.display': 'Anzeige',
  'settings.sub.audio': 'Audio',
  'settings.tracks.link': 'Musik & Radio',
  'settings.tracks.missing': 'Track-Einstellungen noch nicht gebaut (G52)',
  'settings.radio.missing': 'Radio noch nicht gebaut (G52)',
  'settings.gyro': 'Gyro-Parallax',
  'settings.gyro.sub': 'Bewege dein Handy — schau tiefer ins Zimmer',
  'settings.gyro.denied': 'Keine Berechtigung — Parallax bleibt aus',
  'settings.gyro.pointer': 'Kein Gyro-Sensor — Zeiger-Parallax aktiv',
};
