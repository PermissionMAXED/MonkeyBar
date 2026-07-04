// Standalone showcase — run with `?demo=1` (client/src/three/demo.js).
// Drives the engine API only (no server): loads the hero map, seats 6
// monkeys, and loops idle/emotes/card plays/a reveal/a cannon HIT and a
// SURVIVAL, with synthesized SFX + music after the first click.

import { FRUITS } from '@shared/cards.js';

const CAST = [
  { seat: 1, id: 'rico', name: 'Rico "The Fuse"' },
  { seat: 2, id: 'baronBananas', name: 'Baron Bananas' },
  { seat: 3, id: 'ladyVine', name: 'Lady Vine' },
  { seat: 4, id: 'chugs', name: 'Chugs' },
  { seat: 5, id: 'bolt', name: 'Bolt' },
  { seat: 6, id: 'grandmaGuava', name: 'Grandma Guava' },
];

const HAND = [
  { id: 'd1', fruit: FRUITS.BANANA },
  { id: 'd2', fruit: FRUITS.COCONUT },
  { id: 'd3', fruit: FRUITS.MANGO },
  { id: 'd4', fruit: FRUITS.GOLDEN },
  { id: 'd5', fruit: FRUITS.BANANA },
];

function makeCaption() {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'left:16px',
    'bottom:14px',
    'z-index:50',
    'font:13px/1.5 system-ui,sans-serif',
    'color:#f0e6d8',
    'background:rgba(10,8,5,.72)',
    'border:1px solid rgba(57,255,136,.5)',
    'border-radius:10px',
    'padding:10px 14px',
    'pointer-events:none',
    'max-width:340px',
  ].join(';');
  document.body.appendChild(el);
  return el;
}

/**
 * @param {ReturnType<import('./engine.js').createEngine>} engine
 */
export async function runDemo(engine) {
  // demo owns the screen — hide the boot UI overlay
  const ui = document.getElementById('ui');
  if (ui) ui.style.display = 'none';

  const caption = makeCaption();
  let stepText = 'warming up…';
  let fps = 0;
  let frames = 0;
  let acc = 0;
  engine.onFrame((dt) => {
    frames++;
    acc += dt;
    if (acc >= 0.5) {
      fps = Math.round(frames / acc);
      frames = 0;
      acc = 0;
      const audioOn = engine.audio.sfx.initialized;
      caption.innerHTML =
        `<b style="color:#39ff88">MONKEYBAR demo</b> — ${fps} fps<br>` +
        `${stepText}<br>` +
        `<span style="opacity:.65">${audioOn ? '🔊 audio live' : '🔈 click anywhere for sound'}</span>`;
    }
  });
  const step = (text) => {
    stepText = text;
    console.log('[demo]', text);
  };

  // audio unlock (music + sfx) on first gesture
  const unlock = () => {
    engine.audio.unlock({ withMusic: true });
    engine.audio.music.setIntensity(0.15);
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock);

  // ---- the stage ---------------------------------------------------------
  step('loading hero map: The Peeling Parrot');
  engine.loadMap('peeling_parrot');
  for (const c of CAST) engine.seatMonkey(c.seat, c.id, c.name);
  engine.setLocalSeat(0);
  engine.showHand(HAND);
  const wait = (s) => engine.anim.wait(s);

  console.log('[demo] scene ready — 6 monkeys seated');

  // ---- the loop ------------------------------------------------------------
  let round = 0;
  for (;;) {
    round++;
    step(`round ${round}: the table settles in (idle + emotes)`);
    await wait(2.2);
    engine.emote(3, 'taunt');
    await wait(1.4);
    engine.emote(5, 'laugh');
    await wait(1.6);

    step('Rico plays 2 cards, face down');
    engine.setTurn(1);
    await wait(1.0);
    await engine.playCards(1, 2, null);
    await wait(0.7);

    step('you play 2 cards from your hand');
    engine.setTurn(0);
    await wait(0.9);
    const hand = engine.tableView.getHandCards();
    await engine.playCards(0, 2, hand.slice(-2));
    await wait(0.7);

    step('Baron Bananas slams 3 cards');
    engine.setTurn(2);
    await wait(1.0);
    await engine.playCards(2, 3, null);
    engine.emote(4, 'shock');
    await wait(0.8);

    step('Lady Vine points: "MONKEY LIES!"');
    engine.setTurn(3);
    await wait(0.8);
    await engine.playClip(3, 'point');

    step('the reveal… it WAS a lie');
    await engine.revealCards(2, [
      { id: 'r1', fruit: FRUITS.COCONUT },
      { id: 'r2', fruit: FRUITS.MANGO },
      { id: 'r3', fruit: FRUITS.BANANA },
    ], true);
    await wait(0.5);

    step('COCONUT CANNON: Baron Bananas takes a direct HIT');
    await engine.cannonSequence(2, true);
    engine.emote(1, 'laugh');
    engine.emote(6, 'cry');
    await wait(1.6);

    step('the Baron drags himself back onto his stool');
    engine.seatMonkey(2, 'baronBananas', 'Baron Bananas');
    await engine.clearPile();
    await wait(1.0);

    step('Chugs plays 1 card… Bolt calls it!');
    engine.setTurn(4);
    await wait(0.9);
    await engine.playCards(4, 1, null);
    engine.setTurn(5);
    await wait(0.8);
    await engine.playClip(5, 'point');

    step('the reveal… TRUTH! Bolt faces the cannon');
    await engine.revealCards(4, [{ id: 'r4', fruit: FRUITS.GOLDEN }], false);
    await wait(0.5);

    step('COCONUT CANNON: Bolt… *click* — SURVIVAL');
    await engine.cannonSequence(5, false);
    await wait(0.8);

    step('Grandma Guava wins the round');
    await engine.celebrate(6);
    engine.emote(6, 'heart');
    await wait(2.0);

    step('sweeping the table for the next round');
    await engine.clearPile();
    engine.showHand(HAND);
    engine.setTurn(null);
    engine.lookAt(0);
    await wait(1.5);
  }
}
