// Kitchen room definition (§C2, §C5.2) — PURE DATA, no three.js/DOM imports so
// test/rooms.test.js can validate it headlessly. src/home/roomManager.js turns
// this table into meshes/anchors/tap targets.
//
// Fixed interactables: fridge (opens the food tray — G5 subscribes
// roomManager.on('tap:fridge')), counter (composition, anchor only).
// Decor slots (§C5.2): tableSet(2) · fridge(2) · appliance(3) · wallShelf(2).
//
// Coordinates are room-local meters: x → right, z → toward the camera,
// origin at the room's floor center. Furniture entries are auto-grounded and
// footprint-centered by roomManager (Kenney GLBs have corner origins);
// `at[1]` is extra lift for wall-mounted pieces. `rotY` in degrees, 0 = the
// model's authored facing (Kenney furniture faces +z / the camera).
//
// Entry shape (shared by all rooms/*.js — see roomManager.js JSDoc):
//   { item?, proc?, slot?, pieces?, at:[x,y,z], rotY?, scale?, interact?,
//     anchor?, hitSize?:[w,h,d], noShadow? }

/** @type {import('../roomManager.js').RoomDef} */
export const ROOM = Object.freeze({
  id: 'kitchen',

  /** §C5.2 decor slots: default item + purchasable variants (ids = GLB names). */
  slots: Object.freeze({
    tableSet: Object.freeze({ default: 'table', items: Object.freeze(['table', 'tableCloth']) }),
    fridge: Object.freeze({ default: 'kitchenFridge', items: Object.freeze(['kitchenFridge', 'kitchenFridgeLarge']) }),
    // V2/G22 (§C8.1): + microwave 4th appliance variant
    appliance: Object.freeze({ default: 'toaster', items: Object.freeze(['toaster', 'kitchenCoffeeMachine', 'kitchenBlender', 'kitchenMicrowave']) }),
    wallShelf: Object.freeze({ default: 'kitchenCabinetUpper', items: Object.freeze(['kitchenCabinetUpper', 'kitchenCabinetUpperDouble']) }),
    // V2/G22 (§C8.1) new slot: breakfast-bar corner, empty until bought —
    // kitchenBar counter or a 2-stool set (stoolBar "pairs with bar")
    bar: Object.freeze({ default: null, items: Object.freeze(['kitchenBar', 'stoolBar']) }),
  }),

  furniture: Object.freeze([
    // fridge — fixed interactable + decor slot (model swap kitchenFridgeLarge)
    Object.freeze({
      slot: 'fridge', item: 'kitchenFridge', at: Object.freeze([-1.28, 0, -1.06]),
      rotY: 0, interact: 'fridge', anchor: 'fridge', hitSize: Object.freeze([0.8, 1.5, 0.7]),
    }),
    // counter run along the back wall: drawers · sink · stove (flush 0.67 m pieces)
    Object.freeze({ item: 'kitchenCabinetDrawer', at: Object.freeze([-0.62, 0, -1.12]), rotY: 0 }),
    Object.freeze({ item: 'kitchenSink', at: Object.freeze([0.05, 0, -1.12]), rotY: 0, anchor: 'counter' }),
    Object.freeze({ item: 'kitchenStove', at: Object.freeze([0.72, 0, -1.12]), rotY: 0 }),
    // wall shelf above the counter (decor slot)
    Object.freeze({ slot: 'wallShelf', item: 'kitchenCabinetUpper', at: Object.freeze([0.05, 1.5, -1.3]), rotY: 0 }),
    // small appliance on the counter top (decor slot)
    Object.freeze({ slot: 'appliance', item: 'toaster', at: Object.freeze([-0.62, 0.71, -1.05]), rotY: 0 }),
    // table set (decor slot): table + 2 chairs across it (variant: tableCloth +
    // chairCushion). Chairs sit front/back so the set reads well in portrait.
    Object.freeze({
      slot: 'tableSet', item: 'table', at: Object.freeze([0.82, 0, 0.18]), rotY: 0, scale: 0.8,
      pieces: Object.freeze([
        Object.freeze({ item: 'table', at: Object.freeze([0, 0, 0]), rotY: 0 }),
        Object.freeze({ item: 'chair', at: Object.freeze([-0.2, 0, -0.62]), rotY: 0 }),
        Object.freeze({ item: 'chair', at: Object.freeze([0.2, 0, 0.62]), rotY: 180 }),
      ]),
      piecesByItem: Object.freeze({
        tableCloth: Object.freeze([
          Object.freeze({ item: 'tableCloth', at: Object.freeze([0, 0, 0]), rotY: 0 }),
          Object.freeze({ item: 'chairCushion', at: Object.freeze([-0.2, 0, -0.62]), rotY: 0 }),
          Object.freeze({ item: 'chairCushion', at: Object.freeze([0.2, 0, 0.62]), rotY: 180 }),
        ]),
      }),
    }),
    // set dressing
    Object.freeze({ item: 'trashcan', at: Object.freeze([1.42, 0, -1.22]), rotY: 0 }),
    // ---- V2/G22 (§C8.1): bar slot anchor on the left, facing the table ----
    Object.freeze({
      slot: 'bar', at: Object.freeze([-1.15, 0, 0.62]), rotY: 90,
      // the stool "set" lays out two stools side by side (local x runs along
      // the wall after the 90° holder turn)
      piecesByItem: Object.freeze({
        stoolBar: Object.freeze([
          Object.freeze({ item: 'stoolBar', at: Object.freeze([-0.3, 0, 0]), rotY: 0 }),
          Object.freeze({ item: 'stoolBar', at: Object.freeze([0.3, 0, 0]), rotY: 25 }),
        ]),
      }),
    }),
  ]),

  /** Point anchors (world y included; goobyIdle is where Gooby stands here). */
  anchors: Object.freeze({
    goobyIdle: Object.freeze([-0.45, 0, 0.6]),
  }),
});
