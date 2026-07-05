// Coconut Roulette HUD module — PLACEHOLDER (R4/R5 fills this in: ticking
// coconut holder banner, SHAKE / PASS buttons, explosion odds meter).
// Exporting null keeps the generic fallback HUD in charge (ui/modes/index.js):
// seats + turn + `turn.actions` rendered as plain modeAction buttons, so the
// mode is minimally playable the day its server engine lands. Implement as
// `(ctx) => ModeHud` (contract in ui/modes/index.js) and export it as the
// default to take over.
export default null;
