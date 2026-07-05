// Jungle Poker HUD module — PLACEHOLDER (R5/R6 fills this in: 3-card hand,
// pot/stack readouts, FOLD / CALL / RAISE controls, showdown strip).
// Exporting null keeps the generic fallback HUD in charge (ui/modes/index.js):
// seats + turn + `turn.actions` rendered as plain modeAction buttons, so the
// mode is minimally playable the day its server engine lands. Implement as
// `(ctx) => ModeHud` (contract in ui/modes/index.js) and export it as the
// default to take over.
export default null;
