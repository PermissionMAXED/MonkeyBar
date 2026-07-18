// Living room definition (§C2, §C5.2) — PURE DATA, no three.js/DOM imports
// (see rooms/kitchen.js for the entry-shape documentation). The living room is
// the default room (ROOMS.DEFAULT).
//
// Fixed interactables: TV (opens arcade — G5), front door (starts the shop
// trip §C4 — G7 via G5), ball toy zone (ballSpawn anchor — G5).
// Decor slots (§C5.2): sofa(3) · tv(2) · rug(3) · plant(3) · lamp(2) ·
// bookcase(2) · wallArt(3 procedural canvases, no free default).

/** @type {import('../roomManager.js').RoomDef} */
export const ROOM = Object.freeze({
  id: 'living',

  slots: Object.freeze({
    // V2/G22 (§C8.1): + loungeChair 4th seating variant
    sofa: Object.freeze({ default: 'loungeSofa', items: Object.freeze(['loungeSofa', 'loungeDesignSofa', 'loungeSofaCorner', 'loungeChair']) }),
    tv: Object.freeze({ default: 'televisionVintage', items: Object.freeze(['televisionVintage', 'televisionModern']) }),
    rug: Object.freeze({ default: 'rugRounded', items: Object.freeze(['rugRounded', 'rugRectangle', 'rugRound']) }),
    plant: Object.freeze({ default: 'pottedPlant', items: Object.freeze(['pottedPlant', 'plantSmall1', 'plantSmall3']) }),
    lamp: Object.freeze({ default: 'lampRoundFloor', items: Object.freeze(['lampRoundFloor', 'lampSquareFloor']) }),
    bookcase: Object.freeze({ default: 'bookcaseOpen', items: Object.freeze(['bookcaseOpen', 'bookcaseClosedWide']) }),
    // procedural framed canvases (§C5.2) — G11 sells them; empty by default.
    // V2/G22 (§C8.1): +2 canvases (city skyline / rainbow)
    wallArt: Object.freeze({ default: null, items: Object.freeze(['proc:artSunset', 'proc:artCarrot', 'proc:artAbstract', 'proc:artSkyline', 'proc:artRainbow']) }),
    // ---- V2/G22 (§C8.1) new slots: both start empty like wallArt ----
    // ceiling fan hangs from the ceiling anchor (mount:'ceiling' in the catalog)
    ceilingFan: Object.freeze({ default: null, items: Object.freeze(['ceilingFan']) }),
    // side furniture along the right wall (coffee tables, cabinet, radio, speaker)
    sideboard: Object.freeze({ default: null, items: Object.freeze(['tableCoffee', 'tableCoffeeGlass', 'cabinetTelevision', 'radio', 'speaker']) }),
  }),

  furniture: Object.freeze([
    // rug under the seating area (decor slot)
    Object.freeze({ slot: 'rug', item: 'rugRounded', at: Object.freeze([-0.2, 0, 0.3]), rotY: 0, noShadow: true }),
    // sofa against the back wall, facing the camera (decor slot)
    Object.freeze({
      slot: 'sofa', item: 'loungeSofa', at: Object.freeze([-0.9, 0, -1.05]),
      rotY: 0, anchor: 'sofa', hitSize: Object.freeze([1.5, 0.8, 0.7]),
      // §C5.2 variant layouts: the corner sofa is a 1.5×1.5 m L-shape — its
      // footprint center sits 0.38 m deeper than the straight sofas, so
      // unshifted its backrest sinks through the back wall (bbox z −1.81).
      piecesByItem: Object.freeze({
        loungeSofaCorner: Object.freeze([
          Object.freeze({ item: 'loungeSofaCorner', at: Object.freeze([0, 0, 0.38]), rotY: 0 }),
        ]),
      }),
    }),
    // coffee table in front of the sofa + a book on top (set dressing)
    Object.freeze({ item: 'tableCoffee', at: Object.freeze([-0.85, 0, 0.3]), rotY: 0 }),
    Object.freeze({ item: 'books', at: Object.freeze([-0.9, 0.37, 0.3]), rotY: 20 }),
    // TV on its cabinet (tv = decor slot; cabinet is set dressing)
    Object.freeze({ item: 'cabinetTelevision', at: Object.freeze([0.5, 0, -1.24]), rotY: 0 }),
    Object.freeze({
      slot: 'tv', item: 'televisionVintage', at: Object.freeze([0.5, 0.49, -1.24]),
      rotY: 0, interact: 'tv', anchor: 'tv', hitSize: Object.freeze([0.75, 0.85, 0.6]),
      // the modern flat-screen is 1.06 m wide — full size it overlaps the
      // potted plant on the cabinet (x 0.86+), so nudge left + scale down
      piecesByItem: Object.freeze({
        televisionModern: Object.freeze([
          Object.freeze({ item: 'televisionModern', at: Object.freeze([-0.1, 0, 0]), rotY: 0, scale: 0.85 }),
        ]),
      }),
    }),
    // front door on the back wall right (procedural — starts the shop trip §C4)
    Object.freeze({
      proc: 'door', at: Object.freeze([1.55, 0, -1.47]), rotY: 0,
      interact: 'frontDoor', anchor: 'frontDoor', hitSize: Object.freeze([0.95, 2.0, 0.5]),
    }),
    // bookcase against the left half side-wall (decor slot)
    Object.freeze({ slot: 'bookcase', item: 'bookcaseOpen', at: Object.freeze([-1.76, 0, -0.1]), rotY: 90 }),
    // floor lamp tucked in the back-left corner (decor slot)
    Object.freeze({ slot: 'lamp', item: 'lampRoundFloor', at: Object.freeze([-1.82, 0, -1.36]), rotY: 0 }),
    // potted plant on the TV cabinet right of the TV (decor slot — floor spots
    // at x≈±1.7 fall outside the portrait frame)
    Object.freeze({ slot: 'plant', item: 'pottedPlant', at: Object.freeze([0.98, 0.49, -1.2]), rotY: 0, scale: 0.75 }),
    // wall-art slot anchor above the sofa (empty until bought — §C5.2)
    Object.freeze({ slot: 'wallArt', at: Object.freeze([-0.85, 1.9, -1.47]), rotY: 0 }),
    // ---- V3/G46 (§C11.1): committed furniture-kit room dressing ----------
    // The authored ceiling lamp grounds at its shade; lifting its base to
    // y=2.70 hangs its chain flush with the 3.2 m ceiling.
    Object.freeze({
      item: 'lampSquareCeiling', at: Object.freeze([0, 2.7, -0.18]),
      rotY: 0, scale: 1.4, dressing: 'v3-real-asset',
    }),
    // ---- end V3/G46 --------------------------------------------------------
    // ---- V2/G22 (§C8.1): new slot anchors (empty until bought) ----
    // ceiling-fan anchor just below the 3.2 m ceiling, over the room center
    Object.freeze({ slot: 'ceilingFan', at: Object.freeze([0, 3.08, -0.2]), rotY: 0 }),
    // sideboard spot on the right wall, facing into the room (the front door
    // sits at x 1.55 on the BACK wall — z 0.45 keeps them apart)
    Object.freeze({ slot: 'sideboard', at: Object.freeze([1.5, 0, 0.45]), rotY: -90 }),
  ]),

  anchors: Object.freeze({
    // centered-low per §C2, and clear of the TV so 'tap:tv' isn't shadowed by
    // Gooby's raycast priority
    goobyIdle: Object.freeze([-0.05, 0, 0.6]),
    /** Ball-toss zone (§C3) — G5 spawns the ball toy here. */
    ballSpawn: Object.freeze([1.1, 0, 0.9]),
  }),
});
