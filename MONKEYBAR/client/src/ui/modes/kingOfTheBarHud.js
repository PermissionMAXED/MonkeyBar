// King of the Bar HUD module — PLACEHOLDER (R6 fills this in: the ML controls
// plus the active Bar Rule banner and the Royal Decree pickFruit prompt —
// likely by wrapping createMonkeyLiesHud). Exporting null keeps the generic
// fallback HUD in charge (ui/modes/index.js): seats + turn + `turn.actions`
// rendered as plain modeAction buttons, so the mode is minimally playable the
// day its server engine lands. Implement as `(ctx) => ModeHud` (contract in
// ui/modes/index.js) and export it as the default to take over.
export default null;
