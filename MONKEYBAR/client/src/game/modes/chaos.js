// Custom Chaos choreography — PLACEHOLDER (R7 fills this in: chaosKnobs
// announcement beat at match start). Exporting null means gameClient.js runs
// base handling only — which for this ML-derived mode already covers the
// shared played/called/reveal/cannon drama. Export a
// `{ resync(snapshot, tools), handle(kind, p, tools) }` object (contract in
// game/modes/index.js) to take over.
export default null;
