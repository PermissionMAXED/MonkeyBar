// Bedroom room definition (§C2, §C5.2) — PURE DATA, no three.js/DOM imports
// (see rooms/kitchen.js for the entry-shape documentation).
//
// Fixed interactables: bed (sleep target — G6), lamp switch (sleep toggle —
// G6, procedural wall switch), wardrobe closet (opens wardrobe UI — G12),
// window (procedural; sky follows the device clock — roomManager).
// Decor slots (§C5.2): bed(2) · nightstand(2) · rug(2, shared rug items) ·
// plushie(2, incl. Kenney bear + procedural mini-Gooby doll).

/** @type {import('../roomManager.js').RoomDef} */
export const ROOM = Object.freeze({
  id: 'bedroom',

  slots: Object.freeze({
    bed: Object.freeze({ default: 'bedSingle', items: Object.freeze(['bedSingle', 'bedDouble']) }),
    nightstand: Object.freeze({ default: 'lampSquareTable', items: Object.freeze(['lampSquareTable', 'lampRoundTable']) }),
    rug: Object.freeze({ default: 'rugRounded', items: Object.freeze(['rugRounded', 'rugRectangle', 'rugRound']) }),
    plushie: Object.freeze({ default: 'bear', items: Object.freeze(['bear', 'proc:miniGooby']) }),
    // ---- V2/G22 (§C8.1) new slots: both start empty like wallArt ----
    // side furniture by the bed's footboard (tables, cabinets, coat rack)
    sideTable: Object.freeze({ default: null, items: Object.freeze(['sideTable', 'sideTableDrawers', 'cabinetBed', 'cabinetBedDrawer', 'coatRackStanding']) }),
    // cozy floor clutter on the rug corner (pillows, books, trashcan)
    floorClutter: Object.freeze({ default: null, items: Object.freeze(['pillow', 'pillowBlue', 'books', 'trashcan']) }),
  }),

  furniture: Object.freeze([
    // bed on the left, headboard against the back wall (bed decor slot)
    Object.freeze({
      slot: 'bed', item: 'bedSingle', at: Object.freeze([-1.2, 0, -0.55]),
      rotY: 0, interact: 'bed', anchor: 'bed', hitSize: Object.freeze([1.0, 0.7, 1.9]),
    }),
    Object.freeze({ item: 'pillow', at: Object.freeze([-1.2, 0.3, -1.12]), rotY: 0, scale: 1.2 }),
    // nightstand: side table (composition) + lamp on top (nightstand decor slot)
    Object.freeze({ item: 'sideTable', at: Object.freeze([-0.25, 0, -1.28]), rotY: 0 }),
    Object.freeze({
      slot: 'nightstand', item: 'lampSquareTable', at: Object.freeze([-0.25, 0.59, -1.28]),
      rotY: 0, anchor: 'lamp',
    }),
    // lamp switch — procedural wall plate next to the nightstand (sleep toggle)
    Object.freeze({
      proc: 'lampSwitch', at: Object.freeze([0.62, 1.12, -1.46]), rotY: 0,
      interact: 'lampSwitch', anchor: 'lampSwitch', hitSize: Object.freeze([0.45, 0.55, 0.3]),
    }),
    // wardrobe closet on the right (opens wardrobe UI — tall scaled cabinet)
    Object.freeze({
      item: 'bookcaseClosedWide', at: Object.freeze([1.42, 0, -1.25]), rotY: 0,
      scale: Object.freeze([0.85, 1.6, 1.0]), interact: 'wardrobe', anchor: 'wardrobe',
      hitSize: Object.freeze([1.15, 2.1, 0.6]),
    }),
    // window — procedural frame + day/night sky on the back wall (kept left of
    // the wardrobe: frame is 1.15 wide, wardrobe's left face starts at ≈0.89)
    Object.freeze({ proc: 'window', at: Object.freeze([0.22, 1.9, -1.49]), rotY: 0, anchor: 'window' }),
    // rug center-right (rug decor slot)
    Object.freeze({ slot: 'rug', item: 'rugRounded', at: Object.freeze([0.4, 0, 0.5]), rotY: 0, scale: 0.85, noShadow: true }),
    // plushie bear lying on the bed by the pillow (the GLB is authored lying
    // on its back — on the floor it reads as a knocked-over toy)
    Object.freeze({ slot: 'plushie', item: 'bear', at: Object.freeze([-1.18, 0.31, -0.28]), rotY: -20, scale: 0.75 }),
    // ---- V3/G46 (§C11.1): committed furniture-kit room dressing ----------
    // Tiny real plant beside the table lamp; no saved sideTable/floorClutter
    // placement is consumed.
    Object.freeze({
      item: 'plantSmall1', at: Object.freeze([0.07, 0.59, -1.24]),
      rotY: -18, scale: 1.1, dressing: 'v3-real-asset',
    }),
    // ---- end V3/G46 --------------------------------------------------------
    // ---- V2/G22 (§C8.1): new slot anchors (empty until bought) ----
    // side furniture past the bed's footboard on the left (bed spans z ≈ −1.5…0.4)
    Object.freeze({ slot: 'sideTable', at: Object.freeze([-1.4, 0, 0.95]), rotY: 20 }),
    // floor clutter on the rug's right edge, clear of the wardrobe (z −1.25)
    Object.freeze({ slot: 'floorClutter', at: Object.freeze([1.2, 0, 0.85]), rotY: -15 }),
  ]),

  anchors: Object.freeze({
    goobyIdle: Object.freeze([0.55, 0, 0.65]),
  }),
});
