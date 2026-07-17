// Bathroom room definition (§C2, §C5.2) — PURE DATA, no three.js/DOM imports
// (see rooms/kitchen.js for the entry-shape documentation).
//
// Fixed interactables: bathtub (wash §C3 — G5), toilet (hygiene gag — G5),
// sink/mirror (composition). Decor slots (§C5.2): tub(2) · rug(2) · plant(1)
// · shelf(2).

/** @type {import('../roomManager.js').RoomDef} */
export const ROOM = Object.freeze({
  id: 'bathroom',

  slots: Object.freeze({
    // V2/G22 (§C8.1): + shower 3rd tub variant
    tub: Object.freeze({ default: 'bathtub', items: Object.freeze(['bathtub', 'showerRound', 'shower']) }),
    rug: Object.freeze({ default: 'rugDoormat', items: Object.freeze(['rugDoormat', 'rugSquare']) }),
    plant: Object.freeze({ default: 'plantSmall2', items: Object.freeze(['plantSmall2']) }),
    shelf: Object.freeze({ default: 'bathroomCabinet', items: Object.freeze(['bathroomCabinet', 'bathroomCabinetDrawer']) }),
    // V2/G22 (§C8.1) new slot: washing machine corner, empty until bought
    washer: Object.freeze({ default: null, items: Object.freeze(['washer']) }),
  }),

  furniture: Object.freeze([
    // bathtub along the left side, facing the camera (tub decor slot)
    Object.freeze({
      slot: 'tub', item: 'bathtub', at: Object.freeze([-0.72, 0, -0.6]),
      rotY: 0, interact: 'bathtub', anchor: 'bathtub', hitSize: Object.freeze([1.95, 0.75, 1.0]),
    }),
    // toilet in the back-right corner, facing the camera
    Object.freeze({
      item: 'toilet', at: Object.freeze([1.22, 0, -1.02]), rotY: 0,
      interact: 'toilet', anchor: 'toilet', hitSize: Object.freeze([0.65, 0.85, 0.9]),
    }),
    // sink + mirror on the back wall
    Object.freeze({ item: 'bathroomSink', at: Object.freeze([0.45, 0, -1.28]), rotY: 0, anchor: 'sink' }),
    // z −1.36 keeps the mirror slab clear of the wall face (the model's frame
    // sits only ~2 cm in front of its shelf — closer and it sinks into the wall)
    Object.freeze({ item: 'bathroomMirror', at: Object.freeze([0.45, 1.05, -1.36]), rotY: 0 }),
    // wall shelf between mirror and toilet (decor slot)
    Object.freeze({
      slot: 'shelf', item: 'bathroomCabinet', at: Object.freeze([1.1, 1.3, -1.34]), rotY: 0,
      // the drawer cabinet is 0.5 m deep (vs 0.2) — unshifted its back sinks
      // 9 cm into the back wall (bbox z −1.59), so bring it forward
      piecesByItem: Object.freeze({
        bathroomCabinetDrawer: Object.freeze([
          Object.freeze({ item: 'bathroomCabinetDrawer', at: Object.freeze([0, 0, 0.11]), rotY: 0 }),
        ]),
      }),
    }),
    // bath mat in front of the tub (rug decor slot)
    Object.freeze({
      slot: 'rug', item: 'rugDoormat', at: Object.freeze([-0.5, 0, 0.6]), rotY: 0, scale: 1.6, noShadow: true,
      // the holder's ×1.6 doormat scale makes rugSquare a 2.2 m giant hanging
      // past the floor's front edge (bbox z 1.74 > 1.5) — counter-scale it
      piecesByItem: Object.freeze({
        rugSquare: Object.freeze([
          Object.freeze({ item: 'rugSquare', at: Object.freeze([0, 0, 0]), rotY: 0, scale: 0.62 }),
        ]),
      }),
    }),
    // little plant on the sink top (plant decor slot)
    Object.freeze({ slot: 'plant', item: 'plantSmall2', at: Object.freeze([0.58, 0.88, -1.2]), rotY: 0 }),
    // ---- V2/G22 (§C8.1): washer slot anchor on the right wall, in front of
    // the toilet (toilet z −1.02, hit depth 0.9 → clear from z ≈ −0.4) ----
    Object.freeze({ slot: 'washer', at: Object.freeze([1.38, 0, 0.1]), rotY: -90 }),
  ]),

  anchors: Object.freeze({
    goobyIdle: Object.freeze([0.4, 0, 0.6]),
  }),
});
