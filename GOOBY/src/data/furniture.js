// Furniture / wallpaper / floor catalog (§C5.2, agent G11) — every decor-slot
// variant with id / slot / room(s) / price / GLB key (Kenney furniture-kit per
// §D1), plus the 6 wallpapers and 4 floors as catalog entries. Free defaults
// are marked `price: 0, default: true` (they are the items G4's room defs
// pre-place — the starter home owns them from the first boot). Procedural
// entries (`procedural: true`) are built in code by home/decor.js: the 3
// framed wall-art canvases and the mini-Gooby doll plushie.
// Pure data: no three.js/DOM imports (§B) — importable by node:test.

/**
 * @typedef {Object} FurnitureEntry
 * @property {string} id           catalog id — Kenney GLB name, or 'proc:<name>'
 * @property {'furniture'} kind
 * @property {string} slot         §C5.2 decor slot id (matches rooms/*.js slots)
 * @property {readonly string[]} rooms  rooms whose slot accepts this item
 *                                 (rugs are shared living/bedroom items — §C5.2)
 * @property {number} price        coins (0 for the free defaults)
 * @property {string} nameKey      strings.js key for the display name
 * @property {string} [glb]        asset key for core/assets.js ('furniture-kit/…')
 * @property {readonly string[]} [pieces] GLB names of a multi-piece set (table set)
 *                                 — layouts live in the room defs' piecesByItem
 * @property {boolean} [default]   free default of its slot (pre-placed by G4)
 * @property {boolean} [procedural] built in code by home/decor.js (no GLB)
 *
 * @typedef {Object} SurfaceEntry  wallpaper / floor colorway
 * @property {string} id           painter id (G4 roomManager setWallpaper/setFloor)
 * @property {'wallpaper'|'floor'} kind
 * @property {number} price
 * @property {string} nameKey
 * @property {string} base         display swatch base color (mirrors §D3 painters)
 * @property {string} motif        display swatch motif color
 * @property {boolean} [default]   free default (cream / wood)
 */

const F = Object.freeze;

/** @param {Partial<FurnitureEntry> & {id: string, slot: string, rooms: string[], price: number}} e */
function furn(e) {
  return F({
    kind: 'furniture',
    nameKey: `furn.${e.id.replace(/^proc:/, '')}`,
    ...(e.procedural ? {} : { glb: `furniture-kit/${e.id}` }),
    ...e,
    rooms: F([...e.rooms]),
    ...(e.pieces ? { pieces: F([...e.pieces]) } : {}),
  });
}

/** @type {readonly FurnitureEntry[]} the §C5.2 furniture catalog, grouped room by room */
export const FURNITURE = F([
  // ---- living room (§C5.2): sofa(3) · tv(2) · rug(3) · plant(3) · lamp(2) ·
  //      bookcase(2) · wall art(3 procedural canvases) ----
  furn({ id: 'loungeSofa', slot: 'sofa', rooms: ['living'], price: 0, default: true }),
  furn({ id: 'loungeDesignSofa', slot: 'sofa', rooms: ['living'], price: 250 }),
  furn({ id: 'loungeSofaCorner', slot: 'sofa', rooms: ['living'], price: 400 }),
  furn({ id: 'televisionVintage', slot: 'tv', rooms: ['living'], price: 0, default: true }),
  furn({ id: 'televisionModern', slot: 'tv', rooms: ['living'], price: 300 }),
  // rugs are shared items: buy once, place in the living room and/or bedroom
  furn({ id: 'rugRounded', slot: 'rug', rooms: ['living', 'bedroom'], price: 0, default: true }),
  furn({ id: 'rugRectangle', slot: 'rug', rooms: ['living', 'bedroom'], price: 90 }),
  furn({ id: 'rugRound', slot: 'rug', rooms: ['living', 'bedroom'], price: 120 }),
  furn({ id: 'pottedPlant', slot: 'plant', rooms: ['living'], price: 0, default: true }),
  furn({ id: 'plantSmall1', slot: 'plant', rooms: ['living'], price: 80 }),
  furn({ id: 'plantSmall3', slot: 'plant', rooms: ['living'], price: 110 }),
  furn({ id: 'lampRoundFloor', slot: 'lamp', rooms: ['living'], price: 0, default: true }),
  furn({ id: 'lampSquareFloor', slot: 'lamp', rooms: ['living'], price: 140 }),
  furn({ id: 'bookcaseOpen', slot: 'bookcase', rooms: ['living'], price: 0, default: true }),
  furn({ id: 'bookcaseClosedWide', slot: 'bookcase', rooms: ['living'], price: 220 }),
  // 3 procedural framed canvases, 120 each — the wallArt slot has no free default
  furn({ id: 'proc:artSunset', slot: 'wallArt', rooms: ['living'], price: 120, procedural: true }),
  furn({ id: 'proc:artCarrot', slot: 'wallArt', rooms: ['living'], price: 120, procedural: true }),
  furn({ id: 'proc:artAbstract', slot: 'wallArt', rooms: ['living'], price: 120, procedural: true }),

  // ---- kitchen (§C5.2): table set(2) · fridge(2) · appliance(3) · wall shelf(2) ----
  furn({ id: 'table', slot: 'tableSet', rooms: ['kitchen'], price: 0, default: true, pieces: ['table', 'chair'] }),
  furn({ id: 'tableCloth', slot: 'tableSet', rooms: ['kitchen'], price: 260, pieces: ['tableCloth', 'chairCushion'] }),
  furn({ id: 'kitchenFridge', slot: 'fridge', rooms: ['kitchen'], price: 0, default: true }),
  furn({ id: 'kitchenFridgeLarge', slot: 'fridge', rooms: ['kitchen'], price: 350 }),
  furn({ id: 'toaster', slot: 'appliance', rooms: ['kitchen'], price: 0, default: true }),
  furn({ id: 'kitchenCoffeeMachine', slot: 'appliance', rooms: ['kitchen'], price: 150 }),
  furn({ id: 'kitchenBlender', slot: 'appliance', rooms: ['kitchen'], price: 120 }),
  furn({ id: 'kitchenCabinetUpper', slot: 'wallShelf', rooms: ['kitchen'], price: 0, default: true }),
  furn({ id: 'kitchenCabinetUpperDouble', slot: 'wallShelf', rooms: ['kitchen'], price: 130 }),

  // ---- bathroom (§C5.2): tub(2) · rug(2) · plant(1) · shelf(2) ----
  furn({ id: 'bathtub', slot: 'tub', rooms: ['bathroom'], price: 0, default: true }),
  furn({ id: 'showerRound', slot: 'tub', rooms: ['bathroom'], price: 320 }),
  furn({ id: 'rugDoormat', slot: 'rug', rooms: ['bathroom'], price: 0, default: true }),
  furn({ id: 'rugSquare', slot: 'rug', rooms: ['bathroom'], price: 90 }),
  furn({ id: 'plantSmall2', slot: 'plant', rooms: ['bathroom'], price: 0, default: true }),
  furn({ id: 'bathroomCabinet', slot: 'shelf', rooms: ['bathroom'], price: 0, default: true }),
  furn({ id: 'bathroomCabinetDrawer', slot: 'shelf', rooms: ['bathroom'], price: 150 }),

  // ---- bedroom (§C5.2): bed(2) · nightstand(2) · rug(shared, above) · plushie(2) ----
  furn({ id: 'bedSingle', slot: 'bed', rooms: ['bedroom'], price: 0, default: true }),
  furn({ id: 'bedDouble', slot: 'bed', rooms: ['bedroom'], price: 380 }),
  furn({ id: 'lampSquareTable', slot: 'nightstand', rooms: ['bedroom'], price: 0, default: true }),
  furn({ id: 'lampRoundTable', slot: 'nightstand', rooms: ['bedroom'], price: 120 }),
  furn({ id: 'bear', slot: 'plushie', rooms: ['bedroom'], price: 0, default: true }),
  // procedural mini-Gooby doll plushie, 600c (§C5.2)
  furn({ id: 'proc:miniGooby', slot: 'plushie', rooms: ['bedroom'], price: 600, procedural: true }),
]);

/**
 * Wallpapers (§C5.2): cream free default · mint/sky/peach/lavender 120 ·
 * stars 200. Ids match G4's roomManager painters; base/motif mirror the §D3
 * painter colors for DOM swatches.
 * @type {readonly SurfaceEntry[]}
 */
export const WALLPAPERS = F([
  F({ id: 'cream', kind: 'wallpaper', price: 0, default: true, nameKey: 'wp.cream', base: '#FBF3E4', motif: '#F1E4CC' }),
  F({ id: 'mint', kind: 'wallpaper', price: 120, nameKey: 'wp.mint', base: '#DEF3E2', motif: '#C8E8CF' }),
  F({ id: 'sky', kind: 'wallpaper', price: 120, nameKey: 'wp.sky', base: '#DBEEF9', motif: '#C2E1F2' }),
  F({ id: 'peach', kind: 'wallpaper', price: 120, nameKey: 'wp.peach', base: '#FFE7D4', motif: '#FFD6B8' }),
  F({ id: 'lavender', kind: 'wallpaper', price: 120, nameKey: 'wp.lavender', base: '#EAE1F6', motif: '#DACBEE' }),
  F({ id: 'stars', kind: 'wallpaper', price: 200, nameKey: 'wp.stars', base: '#3A4374', motif: '#FFE9A8' }),
]);

/**
 * Floors (§C5.2): wood free default · tile 100 · carpet 100 · checker 150.
 * @type {readonly SurfaceEntry[]}
 */
export const FLOORS = F([
  F({ id: 'wood', kind: 'floor', price: 0, default: true, nameKey: 'floor.wood', base: '#C9995F', motif: '#B58450' }),
  F({ id: 'tile', kind: 'floor', price: 100, nameKey: 'floor.tile', base: '#F0EDE2', motif: '#DCD6C6' }),
  F({ id: 'carpet', kind: 'floor', price: 100, nameKey: 'floor.carpet', base: '#E9C9D4', motif: '#E0BCC9' }),
  F({ id: 'checker', kind: 'floor', price: 150, nameKey: 'floor.checker', base: '#F2E7D3', motif: '#A7D8CF' }),
]);

/** @type {Record<string, FurnitureEntry>} */
export const FURNITURE_BY_ID = F(Object.fromEntries(FURNITURE.map((e) => [e.id, e])));
/** @type {Record<string, SurfaceEntry>} */
export const WALLPAPER_BY_ID = F(Object.fromEntries(WALLPAPERS.map((e) => [e.id, e])));
/** @type {Record<string, SurfaceEntry>} */
export const FLOOR_BY_ID = F(Object.fromEntries(FLOORS.map((e) => [e.id, e])));

export const WALLPAPER_IDS = F(WALLPAPERS.map((e) => e.id));
export const FLOOR_IDS = F(FLOORS.map((e) => e.id));

/**
 * @param {string} id
 * @returns {FurnitureEntry|undefined}
 */
export function getEntry(id) {
  return FURNITURE_BY_ID[id];
}

/** @param {string} id @returns {SurfaceEntry|undefined} */
export function getWallpaper(id) {
  return WALLPAPER_BY_ID[id];
}

/** @param {string} id @returns {SurfaceEntry|undefined} */
export function getFloor(id) {
  return FLOOR_BY_ID[id];
}

/**
 * Catalog entries that fit a room's slot, defaults first.
 * @param {string} roomId
 * @param {string} slotId
 * @returns {FurnitureEntry[]}
 */
export function furnitureFor(roomId, slotId) {
  return FURNITURE.filter((e) => e.slot === slotId && e.rooms.includes(roomId));
}

/**
 * Decor slot ids of a room, in catalog order.
 * @param {string} roomId
 * @returns {string[]}
 */
export function roomSlots(roomId) {
  const out = [];
  for (const e of FURNITURE) {
    if (e.rooms.includes(roomId) && !out.includes(e.slot)) out.push(e.slot);
  }
  return out;
}

/**
 * Save-file ownership key for a catalog entry (`furniture.owned` — §E3).
 * Wallpapers/floors are namespaced so their short ids ('tile', 'stars') can
 * never collide with furniture GLB names.
 * @param {FurnitureEntry|SurfaceEntry} entry
 * @returns {string}
 */
export function ownKey(entry) {
  return entry.kind === 'furniture' ? entry.id : `${entry.kind}:${entry.id}`;
}
