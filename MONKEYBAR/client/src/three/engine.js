// three.js engine — PLAN.md §2 (client/src/three/engine.js).
// FROZEN SIGNATURE (P1): export function createEngine(canvas)
//
// P4: full renderer (ACES tone mapping, sRGB, PCFSoft shadows), fixed-dt tick
// + per-frame updaters, postfx quality toggle, and the FROZEN ENGINE API that
// P6 choreographs against:
//   loadMap, seatMonkey, setLocalSeat, playClip, showHand, playCards,
//   revealCards, cannonSequence (→ Promise), emote, setTurn, celebrate,
//   shake, lookAt, startLoop/stopLoop, audio.

import * as THREE from 'three';
import { getMap, DEFAULT_MAP_ID } from '@shared/maps.js';
import { getEmote } from '@shared/emotes.js';
import { buildBar, TABLE_TOP_Y } from './barScene.js';
import { createLights } from './lights.js';
import { createPostFX } from './postfx.js';
import { createParticles } from './particles.js';
import { createMonkey } from './monkeyFactory.js';
import { createAnimator, attachIdle, playClip as runClip, Ease } from './animations.js';
import { createTableView, seatPosition, seatAngle } from './tableView.js';
import { createCameraRig } from './cameraRig.js';
import { createCannon } from './props.js';
import { createSFX } from '../audio/sfx.js';
import { createMusic } from '../audio/music.js';
import { makeCanvas } from './materials.js';

const FIXED_DT = 1 / 60;

/** Wrap an angle so the tween takes the short way around. */
function nearestAngle(target, current) {
  let a = target;
  while (a - current > Math.PI) a -= Math.PI * 2;
  while (a - current < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createEngine(canvas) {
  // ---- renderer / scene / camera ----------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(new THREE.Color('#120d08'));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.05, 60);
  camera.position.set(0, 1.4, 3);
  scene.add(camera); // camera-parented objects (hand fan) must be in the graph

  // ---- core subsystems ----------------------------------------------------
  const anim = createAnimator();
  const particles = createParticles(scene);
  const tableView = createTableView(scene, camera, anim);
  const rig = createCameraRig(camera);
  const postfx = createPostFX(renderer, scene, camera);
  const sfx = createSFX();
  const music = createMusic();

  // unlock audio on the first user gesture (SFX only; music is opt-in)
  const unlockAudio = () => {
    sfx.init();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  // ---- per-map state -------------------------------------------------------
  /** @type {ReturnType<typeof buildBar>|null} */
  let bar = null;
  /** @type {ReturnType<typeof createLights>|null} */
  let lights = null;
  /** @type {ReturnType<typeof createCannon>|null} */
  let cannon = null;
  let currentMapId = null;

  /** @type {Map<number, { monkey: any, idle: { stop: () => void } }>} */
  const seats = new Map();
  let localSeat = -1;

  // ---- loop -----------------------------------------------------------------
  /** @type {Set<(dt: number, elapsed: number) => void>} */
  const frameHandlers = new Set();
  /** @type {Set<(dt: number) => void>} */
  const tickHandlers = new Set();
  const clock = new THREE.Clock();
  let running = false;
  let accumulator = 0;

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.getElapsedTime();

    // fixed-dt ticks (game-logic-ish callbacks)
    accumulator += dt;
    while (accumulator >= FIXED_DT) {
      accumulator -= FIXED_DT;
      for (const fn of tickHandlers) fn(FIXED_DT);
    }

    // per-frame updaters
    anim.update(dt);
    if (bar) bar.update(dt, elapsed);
    if (lights) lights.update(dt, elapsed);
    particles.update(dt, elapsed);
    tableView.update(dt, elapsed);
    rig.update(dt);
    for (const fn of frameHandlers) fn(dt, elapsed);

    if (postfx.enabled) postfx.render(dt);
    else renderer.render(scene, camera);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    postfx.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- helpers ---------------------------------------------------------------

  function seatEntry(seat) {
    return seats.get(seat) || null;
  }

  function monkeyAt(seat) {
    return seats.get(seat)?.monkey ?? null;
  }

  function headPos(seat) {
    const m = monkeyAt(seat);
    if (m) return m.headWorldPos(new THREE.Vector3());
    const p = seatPosition(seat);
    p.y += 0.5;
    return p;
  }

  function placeMonkeyAtSeat(monkey, seat) {
    const p = seatPosition(seat);
    monkey.root.position.copy(p);
    monkey.root.rotation.set(0, seatAngle(seat) + Math.PI, 0);
    monkey.root.updateMatrixWorld(true);
  }

  function emoteBubble(seat, glyph) {
    const { canvas, ctx } = makeCanvas(128, 128);
    ctx.fillStyle = 'rgba(12,10,8,0.82)';
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#39ff88';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.font = '64px system-ui, "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, 64, 70);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.setScalar(0.26);
    const p = headPos(seat);
    sprite.position.set(p.x, p.y + 0.42, p.z);
    sprite.renderOrder = 6;
    scene.add(sprite);
    anim.tween({
      duration: 1.7,
      ease: Ease.quadOut,
      onUpdate(k) {
        sprite.position.y = p.y + 0.42 + k * 0.3;
        sprite.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      },
      onComplete() {
        scene.remove(sprite);
        tex.dispose();
        sprite.material.dispose();
      },
    });
  }

  // ---- FROZEN ENGINE API -------------------------------------------------------

  const engine = {
    renderer,
    scene,
    camera,
    anim,
    particles,
    tableView,
    rig,
    postfx,

    // ------------------------------------------------- loop control
    startLoop() {
      if (running) return;
      running = true;
      clock.start();
      loop();
    },
    stopLoop() {
      running = false;
    },
    /** P1-compat aliases. */
    start() {
      this.startLoop();
    },
    stop() {
      this.stopLoop();
    },
    onFrame(fn) {
      frameHandlers.add(fn);
      return () => frameHandlers.delete(fn);
    },
    /** Fixed-dt (60 Hz) tick callback; returns a remover. */
    onTick(fn) {
      tickHandlers.add(fn);
      return () => tickHandlers.delete(fn);
    },

    /** Quality toggle: 'high' = postfx on, 'low' = postfx off + pixelRatio 1. */
    setQuality(level) {
      const high = level !== 'low' && level !== false;
      postfx.setEnabled(high);
      renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 2) : 1);
      renderer.setSize(window.innerWidth, window.innerHeight);
      postfx.setSize(window.innerWidth, window.innerHeight);
    },

    // ------------------------------------------------- map / seating
    /** Build (or swap to) a map from shared/maps.js. */
    loadMap(mapId) {
      const mapConfig = getMap(mapId) || getMap(DEFAULT_MAP_ID);
      if (currentMapId === mapConfig.id && bar) return bar;
      // tear down previous
      if (bar) bar.dispose();
      if (lights) lights.dispose();
      if (cannon) cannon.group.removeFromParent();
      currentMapId = mapConfig.id;

      bar = buildBar(mapConfig);
      scene.add(bar.group);
      lights = createLights(scene, mapConfig);
      particles.setAmbientDust(mapConfig.propParams.dustDensity);

      cannon = createCannon();
      cannon.group.position.set(0, TABLE_TOP_Y, 0);
      scene.add(cannon.group);
      cannon.yaw.rotation.y = Math.PI * 0.75; // parked, pointing at no one

      // re-place any seated monkeys (map swap mid-lobby)
      for (const [seat, entry] of seats) placeMonkeyAtSeat(entry.monkey, seat);
      return bar;
    },

    /** Seat a monkey (replaces any existing monkey at that seat). */
    seatMonkey(seat, monkeyId, name) {
      this.clearSeat(seat);
      const monkey = createMonkey(monkeyId, name);
      placeMonkeyAtSeat(monkey, seat);
      scene.add(monkey.root);
      const idle = attachIdle(anim, monkey);
      seats.set(seat, { monkey, idle });
      const accent = monkey.def?.silhouette?.furPalette?.[2] ?? '#39ff88';
      tableView.addNameplate(seat, name || monkey.name, monkey.headWorldPos(new THREE.Vector3()), accent);
      if (seat === localSeat) this.setLocalSeat(seat); // keep local hidden
      return monkey;
    },

    /** Remove a monkey from a seat. */
    clearSeat(seat) {
      const entry = seats.get(seat);
      if (!entry) return;
      entry.idle.stop();
      anim.cancelTag(entry.monkey.uid);
      entry.monkey.dispose();
      tableView.removeNameplate(seat);
      seats.delete(seat);
    },

    /** First-person camera sits here; the local monkey body is hidden. */
    setLocalSeat(seat) {
      // un-hide previous local monkey
      const prev = seatEntry(localSeat);
      if (prev) prev.monkey.root.visible = true;
      localSeat = seat;
      rig.setSeat(seat);
      const entry = seatEntry(seat);
      if (entry) {
        entry.monkey.root.visible = false;
        tableView.removeNameplate(seat);
      }
    },

    getLocalSeat: () => localSeat,
    getMonkey: (seat) => monkeyAt(seat),

    /** P6 glue: leave first-person (spectator/orbit cam) — un-hides the local monkey. */
    setSpectatorView() {
      const prev = seatEntry(localSeat);
      if (prev) prev.monkey.root.visible = true;
      localSeat = -1;
      tableView.clearHand();
    },

    // ------------------------------------------------- choreography
    /** Play a canned clip ('cardPlay'|'slam'|'point'|'cheer'|'sob'|'shock'|'cannonHit'|'survive'|...). */
    playClip(seat, clipName) {
      const monkey = monkeyAt(seat);
      if (!monkey) return Promise.resolve();
      return runClip(anim, monkey, clipName, { floorY: bar?.floorY ?? 0 });
    },

    /** Show the local player's hand fan. Returns the card meshes. */
    showHand(cards) {
      sfx.cardSlide();
      return tableView.showHand(cards);
    },

    /**
     * Seat plays `count` face-down cards.
     * `cardMeshesOrNull`: local hand meshes to consume (or null → spawn).
     */
    async playCards(seat, count, cardMeshesOrNull) {
      const monkey = monkeyAt(seat);
      if (cardMeshesOrNull && cardMeshesOrNull.length) {
        tableView.takeHandCards(cardMeshesOrNull.length);
      }
      sfx.cardSlide();
      const clip = count >= 3 ? 'slam' : 'cardPlay';
      const clipP = monkey ? this.playClip(seat, clip) : Promise.resolve();
      await tableView.addToPile(seat, count);
      sfx.chipClack();
      await clipP;
    },

    /** Flip the challenged cards face-up. `lie` = the claim was false. */
    async revealCards(seat, cards, lie) {
      rig.lookAtPoint(new THREE.Vector3(0.3, TABLE_TOP_Y + 0.1, 0));
      sfx.cardFlip();
      const revealP = tableView.revealPile(cards, lie);
      const monkey = monkeyAt(seat);
      if (monkey) {
        if (lie) {
          monkey.setExpression('sweat');
          this.playClip(seat, 'shock');
        } else {
          this.playClip(seat, 'smug');
        }
      }
      await revealP;
      sfx.chatter();
      await anim.wait(0.7);
    },

    /**
     * The full Coconut Cannon drama. Resolves when the lights come back up.
     * @param {number} seat  victim seat
     * @param {boolean} hit  true → KO, false → survival click
     * @param {{onResolve?: () => void}} [opts]  P6 glue: onResolve fires at the THOOM/click
     */
    async cannonSequence(seat, hit, opts = {}) {
      const victim = monkeyAt(seat);
      const victimPos = headPos(seat);
      const cannonPos = new THREE.Vector3(0, TABLE_TOP_Y + 0.12, 0);

      // 1 — the room darkens, the groove tightens
      lights?.dimTo(0.2, 0.8);
      music.setIntensity(1);
      sfx.bassSting();
      const dolly = rig.penaltyDolly(cannonPos, victimPos);

      // 2 — the cannon swivels and locks on
      if (cannon) {
        const { yawY, pitchX } = cannon.anglesToWorld(victimPos);
        await Promise.all([
          anim.to(cannon.yaw.rotation, { y: nearestAngle(yawY, cannon.yaw.rotation.y) }, 1.2, { ease: Ease.quadInOut }).promise,
          anim.to(cannon.pitch.rotation, { x: pitchX }, 1.2, { ease: Ease.quadInOut }).promise,
        ]);
      }
      if (victim) {
        victim.setExpression('sweat');
        this.playClip(seat, 'shock'); // not awaited — plays under the drumroll
      }

      // 3 — drumroll + burning fuse
      const rollSeconds = 2.2;
      sfx.drumroll(rollSeconds);
      sfx.fuseHiss(rollSeconds);
      const sparkStop = anim.addUpdater(
        (() => {
          let acc = 0;
          return (dt) => {
            acc += dt;
            if (acc > 0.13 && cannon) {
              acc = 0;
              particles.fuseSparks(cannon.fuseWorldPos());
            }
          };
        })()
      );
      await anim.wait(rollSeconds);
      sparkStop();

      // 4 — resolution
      opts.onResolve?.();
      if (hit) {
        const muzzle = cannon ? cannon.muzzleWorldPos() : cannonPos.clone();
        const dir = victimPos.clone().sub(muzzle).normalize();
        particles.muzzleFlash(muzzle, dir);
        particles.smokePuff(muzzle, { count: 34 });
        sfx.cannonThoom();
        postfx.pulseBloom(2.4);
        rig.addTrauma(1.0);
        if (victim) {
          await this.playClip(seat, 'cannonHit');
          particles.smokePuff(victim.headWorldPos(new THREE.Vector3()));
        } else {
          await anim.wait(1.0);
        }
        sfx.sadTrombone();
      } else {
        sfx.survivalClick();
        rig.addTrauma(0.25);
        await anim.wait(0.55);
        const muzzle = cannon ? cannon.muzzleWorldPos() : cannonPos.clone();
        particles.confetti(muzzle, { count: 40 });
        particles.goldGlint(victimPos);
        sfx.chatter();
        if (victim) await this.playClip(seat, 'survive');
        else await anim.wait(1.0);
      }

      // 5 — the bar breathes again
      dolly.release();
      lights?.dimTo(1, 1.1);
      music.setIntensity(0.2);
      rig.lookAtTable();
      if (cannon) {
        anim.to(cannon.pitch.rotation, { x: 0 }, 1.4, { ease: Ease.quadInOut });
        anim.to(cannon.yaw.rotation, { y: nearestAngle(Math.PI * 0.75, cannon.yaw.rotation.y) }, 1.4, { ease: Ease.quadInOut });
      }
      await anim.wait(0.7);
    },

    /** Emote bubble + matching gesture. */
    emote(seat, emoteId) {
      const def = getEmote(emoteId);
      emoteBubble(seat, def?.glyph ?? '💬');
      sfx.uiTick();
      return this.playClip(seat, emoteId);
    },

    /** Highlight whose turn it is (ring + camera glance). */
    setTurn(seat) {
      tableView.setTurn(seat);
      if (seat != null && seat >= 0) rig.lookAtSeat(seat);
      sfx.uiTick();
    },

    /** Winner celebration: confetti + cheer + fanfare. */
    celebrate(seat) {
      const p = headPos(seat);
      particles.confetti(p);
      particles.confetti(new THREE.Vector3(0, TABLE_TOP_Y + 0.6, 0));
      sfx.fanfare();
      rig.lookAtSeat(seat);
      return this.playClip(seat, 'cheer');
    },

    /** Camera trauma shake, 0..1. */
    shake(amount) {
      rig.addTrauma(amount);
    },

    /** Ease the camera's gaze toward a seat. */
    lookAt(seat) {
      rig.lookAtSeat(seat);
    },

    /** Sweep the played pile (round end). */
    clearPile() {
      sfx.cardSlide();
      return tableView.clearPile();
    },

    // ------------------------------------------------- audio handle
    audio: {
      sfx,
      music,
      /** Call from a user-gesture handler: unlock SFX + start the bar loop. */
      unlock({ withMusic = true } = {}) {
        sfx.init();
        if (withMusic) music.start();
      },
      setMuted(m) {
        sfx.setMuted(m);
        music.setMuted(m);
      },
    },
  };

  return engine;
}
