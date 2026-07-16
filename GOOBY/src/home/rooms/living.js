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
    sofa: Object.freeze({ default: 'loungeSofa', items: Object.freeze(['loungeSofa', 'loungeDesignSofa', 'loungeSofaCorner']) }),
    tv: Object.freeze({ default: 'televisionVintage', items: Object.freeze(['televisionVintage', 'televisionModern']) }),
    rug: Object.freeze({ default: 'rugRounded', items: Object.freeze(['rugRounded', 'rugRectangle', 'rugRound']) }),
    plant: Object.freeze({ default: 'pottedPlant', items: Object.freeze(['pottedPlant', 'plantSmall1', 'plantSmall3']) }),
    lamp: Object.freeze({ default: 'lampRoundFloor', items: Object.freeze(['lampRoundFloor', 'lampSquareFloor']) }),
    bookcase: Object.freeze({ default: 'bookcaseOpen', items: Object.freeze(['bookcaseOpen', 'bookcaseClosedWide']) }),
    // procedural framed canvases (§C5.2) — G11 sells them; empty by default
    wallArt: Object.freeze({ default: null, items: Object.freeze(['proc:artSunset', 'proc:artCarrot', 'proc:artAbstract']) }),
  }),

  furniture: Object.freeze([
    // rug under the seating area (decor slot)
    Object.freeze({ slot: 'rug', item: 'rugRounded', at: Object.freeze([-0.2, 0, 0.3]), rotY: 0, noShadow: true }),
    // sofa against the back wall, facing the camera (decor slot)
    Object.freeze({
      slot: 'sofa', item: 'loungeSofa', at: Object.freeze([-0.9, 0, -1.05]),
      rotY: 0, anchor: 'sofa', hitSize: Object.freeze([1.5, 0.8, 0.7]),
    }),
    // coffee table in front of the sofa + a book on top (set dressing)
    Object.freeze({ item: 'tableCoffee', at: Object.freeze([-0.85, 0, 0.3]), rotY: 0 }),
    Object.freeze({ item: 'books', at: Object.freeze([-0.9, 0.37, 0.3]), rotY: 20 }),
    // TV on its cabinet (tv = decor slot; cabinet is set dressing)
    Object.freeze({ item: 'cabinetTelevision', at: Object.freeze([0.5, 0, -1.24]), rotY: 0 }),
    Object.freeze({
      slot: 'tv', item: 'televisionVintage', at: Object.freeze([0.5, 0.49, -1.24]),
      rotY: 0, interact: 'tv', anchor: 'tv', hitSize: Object.freeze([0.75, 0.85, 0.6]),
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
  ]),

  anchors: Object.freeze({
    // centered-low per §C2, and clear of the TV so 'tap:tv' isn't shadowed by
    // Gooby's raycast priority
    goobyIdle: Object.freeze([-0.05, 0, 0.6]),
    /** Ball-toss zone (§C3) — G5 spawns the ball toy here. */
    ballSpawn: Object.freeze([1.1, 0, 0.9]),
  }),
});
