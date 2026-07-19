// Pipe Panic — pure puzzle logic (PLAN2 §C1.2 #9, agent V2/G25). No three.js /
// DOM imports so test/minigamesE.test.js runs headlessly (§B rule). The visual
// module (pipeFlow.js) renders boards from here; ALL gameplay numbers not
// covered by §C1 (COIN_TABLE.pipeFlow lives in data/constants.js) are
// centralized in PIPE below — never inline them.
//
// Binding §C1.2 #9 rules implemented here:
//   · 5×5 grid of pipe tiles (straight / bend / T)
//   · generator: random spanning path from tap → sprinkler, then scramble
//     rotations — SOLVABLE BY CONSTRUCTION (proved per seed by the exported
//     BFS solver, which the ?autoplay bot AND the tests both reuse)
//   · tap rotates a tile 90°; when the path connects, water flows
//   · 90 s fixed round; score = 25·solved + tapEfficiencyBonus(0–10:
//     10 when total taps ≤ optimal+3, linearly down to 0 at optimal+15)

/** Pipe Panic tuning (§C1.2 #9 binding numbers + V2/G25 generator knobs). */
export const PIPE = Object.freeze({
  /** Board is GRID×GRID (§C1.2 #9: 5×5). */
  GRID: 5,
  /** Round length (§C1.2 #9: 90 s fixed). */
  DURATION_SEC: 90,
  /** Score per connected puzzle (§C1.2 #9). */
  SOLVE_POINTS: 25,
  /** Tap-efficiency bonus (§C1.2 #9): 10 at ≤ optimal+3 → 0 at optimal+15. */
  BONUS_MAX: 10,
  BONUS_FULL_EXTRA: 3,
  BONUS_ZERO_EXTRA: 15,
  /** Chance a path tile is upgraded straight/bend → T (adds red herrings). */
  TEE_CHANCE: 0.28,
  /** Off-path decoy shape weights. */
  DECOY_WEIGHTS: Object.freeze({ straight: 0.38, bend: 0.42, tee: 0.2 }),
  /** V3/G44 (§C10.2): puzzle 3+ has one leaking joint. */
  LEAK_FROM_PUZZLE: 3,
  LEAK_SEC: 25,
  LEAK_PENALTY: 5,
  /** §G5 derived-tune fields used by both scene and certification bot. */
  PREVIEW_SPEED_MULT: 1,
  ROTATE_SEC: 0.16,
  FILL_STEP_SEC: 0.09,
  FILL_END_DELAY_SEC: 1.1,
  ENDLESS: false,
  ENDLESS_FAILURE_LIMIT: 3,
});

/** §G5 sequence/puzzle difficulty; normal returns PIPE unchanged. */
export function applyDifficulty(tune = PIPE, mode = 'normal') {
  if (mode === 'normal' || !['easy', 'hard', 'endless'].includes(mode)) return tune;
  const hard = mode === 'hard' || mode === 'endless';
  const previewMult = hard ? 1.15 : 0.85;
  const windowMult = hard ? 0.8 : 1.25;
  return Object.freeze({
    ...tune,
    PREVIEW_SPEED_MULT: previewMult,
    ROTATE_SEC: tune.ROTATE_SEC / previewMult,
    FILL_STEP_SEC: tune.FILL_STEP_SEC / previewMult,
    FILL_END_DELAY_SEC: tune.FILL_END_DELAY_SEC / previewMult,
    LEAK_SEC: Math.max(0.35, tune.LEAK_SEC * windowMult),
    LEAK_FROM_PUZZLE: Math.max(1, tune.LEAK_FROM_PUZZLE + (hard ? -1 : 1)),
    ENDLESS: mode === 'endless',
  });
}

export function createPipeEndlessState(limit = PIPE.ENDLESS_FAILURE_LIMIT) {
  return { failures: 0, limit, ended: false };
}

export function recordPipeFailure(state, kind) {
  if ((kind === 'unsolved' || kind === 'leak') && !state.ended) state.failures += 1;
  state.ended = state.failures >= state.limit;
  return state.ended;
}

/** Directions: 0=N (up), 1=E, 2=S (down), 3=W. Row 0 is the top row. */
export const DIRS = Object.freeze({ N: 0, E: 1, S: 2, W: 3 });

/** Grid deltas per direction: [dCol, dRow] (row grows downward). */
export const DELTA = Object.freeze([
  Object.freeze([0, -1]),
  Object.freeze([1, 0]),
  Object.freeze([0, 1]),
  Object.freeze([-1, 0]),
]);

/** Base connection sets at rot 0 (rotating adds rot clockwise, mod 4). */
const BASE_CONNECTIONS = Object.freeze({
  straight: Object.freeze([DIRS.N, DIRS.S]),
  bend: Object.freeze([DIRS.N, DIRS.E]),
  tee: Object.freeze([DIRS.N, DIRS.E, DIRS.S]), // missing W at rot 0
});

/** @param {number} d @returns {number} opposite direction */
export function opposite(d) {
  return (d + 2) % 4;
}

/**
 * xmur3-style string hash → uint32 (same recipe as systems/weather.js —
 * duplicated locally so this .logic.js stays dependency-free).
 * @param {string} str
 * @returns {number}
 */
export function hash32(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/**
 * mulberry32 seeded rng (same recipe as minigames/framework.js createRng —
 * duplicated locally so this .logic.js stays dependency-free).
 * @param {number} seed
 * @returns {() => number} 0..1
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @typedef {Object} Tile
 * @property {'straight'|'bend'|'tee'} shape
 * @property {number} rot 0..3 (each tap adds 1, i.e. 90° clockwise)
 */

/**
 * @typedef {Object} Board
 * @property {number} size grid dimension (5)
 * @property {Tile[]} tiles row-major, index = row*size + col
 * @property {number} srcCol tap column — water enters (srcCol, 0) from N
 * @property {number} goalCol sprinkler column — water exits (goalCol, size−1) to S
 * @property {number} optimalTaps solver-proved minimal tap count at deal time
 * @property {number} seed
 */

/**
 * Connection directions of a tile at its current rotation.
 * @param {Tile} tile
 * @returns {number[]} sorted direction list
 */
export function connectionsOf(tile) {
  return BASE_CONNECTIONS[tile.shape].map((d) => (d + tile.rot) % 4).sort((a, b) => a - b);
}

/**
 * @param {Tile} tile
 * @param {number} dir
 * @returns {boolean} tile has an opening toward `dir`
 */
export function hasConnection(tile, dir) {
  return connectionsOf(tile).includes(dir);
}

/**
 * Rotate a tile 90° clockwise (one tap). Pure — returns a new tile.
 * @param {Tile} tile
 * @returns {Tile}
 */
export function rotateTile(tile) {
  return { shape: tile.shape, rot: (tile.rot + 1) % 4 };
}

/**
 * Visual rotation target from an unbounded clockwise tap count. Using turns,
 * not wrapped tile.rot, lets rapid taps cancel/restart their tween without
 * the mesh desynchronizing from solver state.
 */
export function rotationTarget(turns) {
  const safeTurns = Math.max(0, turns);
  return safeTurns === 0 ? 0 : -safeTurns * (Math.PI / 2);
}

/** Deterministic dripping joint for puzzle 3+, or null before the variant. */
export function leakJointFor(board, puzzleNo, tune = PIPE) {
  if (puzzleNo < tune.LEAK_FROM_PUZZLE) return null;
  return hash32(`leak:${board.seed}:${puzzleNo}`) % board.tiles.length;
}

/** Leak penalty fires once at the exact 25-second boundary. */
export function leakPenaltyDue(puzzleElapsed, alreadyApplied, tune = PIPE) {
  return !alreadyApplied && puzzleElapsed >= tune.LEAK_SEC;
}

/**
 * Minimal taps (0..3) to rotate `tile` so its connections INCLUDE every
 * direction in `dirs` — Infinity when the shape can never satisfy them
 * (e.g. a straight asked for two adjacent openings). Shape symmetry is
 * respected automatically (a straight satisfies {N,S} at rot 0 AND rot 2).
 * @param {Tile} tile
 * @param {number[]} dirs required openings
 * @returns {number}
 */
export function minTapsFor(tile, dirs) {
  for (let k = 0; k < 4; k += 1) {
    const conns = connectionsOf({ shape: tile.shape, rot: (tile.rot + k) % 4 });
    if (dirs.every((d) => conns.includes(d))) return k;
  }
  return Infinity;
}

/**
 * Flood water from the tap: BFS across facing connections. Water enters
 * (srcCol, 0) from the N edge and must reach (goalCol, size−1) with an
 * S-facing opening (the sprinkler). Open pipe ends elsewhere just drip —
 * they are not a failure (§C1.2 #9 has no leak rule).
 * @param {Board} board
 * @returns {{solved: boolean, depths: Map<number, number>}} depths = BFS
 *   fill order for every water-reached tile (the fill animation source)
 */
export function waterReach(board) {
  const { size, tiles, srcCol, goalCol } = board;
  const depths = new Map();
  const srcIdx = srcCol; // row 0
  if (!hasConnection(tiles[srcIdx], DIRS.N)) return { solved: false, depths };
  depths.set(srcIdx, 0);
  const queue = [srcIdx];
  while (queue.length > 0) {
    const idx = queue.shift();
    const col = idx % size;
    const row = (idx - col) / size;
    const depth = depths.get(idx);
    for (const dir of connectionsOf(tiles[idx])) {
      const nc = col + DELTA[dir][0];
      const nr = row + DELTA[dir][1];
      if (nc < 0 || nc >= size || nr < 0 || nr >= size) continue;
      const nIdx = nr * size + nc;
      if (depths.has(nIdx)) continue;
      if (!hasConnection(tiles[nIdx], opposite(dir))) continue;
      depths.set(nIdx, depth + 1);
      queue.push(nIdx);
    }
  }
  const goalIdx = (size - 1) * size + goalCol;
  const solved = depths.has(goalIdx) && hasConnection(tiles[goalIdx], DIRS.S);
  return { solved, depths };
}

/**
 * @param {Board} board
 * @returns {boolean} water connects tap → sprinkler
 */
export function isSolved(board) {
  return waterReach(board).solved;
}

/**
 * Seeded self-avoiding path from (srcCol, 0) to (goalCol, size−1) via
 * randomized DFS — always exists on a grid, so the generator never fails.
 * @param {() => number} rng
 * @param {number} size
 * @param {number} srcCol
 * @param {number} goalCol
 * @returns {number[]} cell indices, source first
 */
function randomPath(rng, size, srcCol, goalCol) {
  const goalIdx = (size - 1) * size + goalCol;
  const visited = new Set();
  const path = [];
  const dfs = (idx) => {
    visited.add(idx);
    path.push(idx);
    if (idx === goalIdx) return true;
    const col = idx % size;
    const row = (idx - col) / size;
    const dirs = [0, 1, 2, 3].sort(() => rng() - 0.5);
    for (const dir of dirs) {
      const nc = col + DELTA[dir][0];
      const nr = row + DELTA[dir][1];
      if (nc < 0 || nc >= size || nr < 0 || nr >= size) continue;
      const nIdx = nr * size + nc;
      if (visited.has(nIdx)) continue;
      if (dfs(nIdx)) return true;
    }
    path.pop();
    return false;
  };
  dfs(srcCol);
  return path;
}

/** Pick a shape whose connections can include both dirs, seeded. */
function shapeForOpenings(rng, inDir, outDir, tune) {
  const straightFits = opposite(inDir) === outDir;
  if (rng() < tune.TEE_CHANCE) {
    // A T includes any 2 distinct dirs (its missing dir just must differ).
    return 'tee';
  }
  return straightFits ? 'straight' : 'bend';
}

/** Solved rotation for a shape that must open toward every dir in dirs. */
function solvedRotFor(shape, dirs, rng) {
  const fits = [];
  for (let rot = 0; rot < 4; rot += 1) {
    const conns = connectionsOf({ shape, rot });
    if (dirs.every((d) => conns.includes(d))) fits.push(rot);
  }
  return fits[Math.floor(rng() * fits.length)];
}

/** Weighted decoy shape pick. */
function decoyShape(rng, tune) {
  const r = rng();
  if (r < tune.DECOY_WEIGHTS.straight) return 'straight';
  if (r < tune.DECOY_WEIGHTS.straight + tune.DECOY_WEIGHTS.bend) return 'bend';
  return 'tee';
}

/**
 * Generate a deal (§C1.2 #9): random spanning path tap → sprinkler, path
 * tiles shaped to fit it (some upgraded to Ts), decoys elsewhere, then EVERY
 * rotation scrambled — solvable by construction, re-scrambled in the
 * (rare) case the scramble dealt an already-connected board. `optimalTaps`
 * is solver-proved (the §C1.2 #9 efficiency-bonus baseline).
 * @param {number} seed
 * @param {object} [tune]
 * @returns {Board}
 */
export function generateBoard(seed, tune = PIPE) {
  const rng = mulberry32(hash32(`pipe:${seed}`));
  const size = tune.GRID;
  const srcCol = Math.floor(rng() * size);
  const goalCol = Math.floor(rng() * size);
  const path = randomPath(rng, size, srcCol, goalCol);

  /** @type {Tile[]} */
  const tiles = new Array(size * size);
  const onPath = new Set(path);

  for (let i = 0; i < path.length; i += 1) {
    const idx = path[i];
    // Water enters through the side facing the previous cell (N edge for the
    // source) and exits toward the next cell (S edge for the sprinkler).
    let inDir;
    if (i === 0) inDir = DIRS.N;
    else {
      const prev = path[i - 1];
      const dCol = (idx % size) - (prev % size);
      const dRow = Math.floor(idx / size) - Math.floor(prev / size);
      const travel = DELTA.findIndex(([c, r]) => c === dCol && r === dRow);
      inDir = opposite(travel);
    }
    let outDir;
    if (i === path.length - 1) outDir = DIRS.S;
    else {
      const next = path[i + 1];
      const dCol = (next % size) - (idx % size);
      const dRow = Math.floor(next / size) - Math.floor(idx / size);
      outDir = DELTA.findIndex(([c, r]) => c === dCol && r === dRow);
    }
    const shape = shapeForOpenings(rng, inDir, outDir, tune);
    const rot = solvedRotFor(shape, [inDir, outDir], rng);
    tiles[idx] = { shape, rot };
  }

  for (let idx = 0; idx < size * size; idx += 1) {
    if (onPath.has(idx)) continue;
    tiles[idx] = { shape: decoyShape(rng, tune), rot: Math.floor(rng() * 4) };
  }

  /** @type {Board} */
  const board = { size, tiles, srcCol, goalCol, optimalTaps: 0, seed };

  // Scramble every rotation; re-scramble the path if the deal came out
  // already connected (we want the player to have work to do).
  for (let guard = 0; guard < 8; guard += 1) {
    for (let idx = 0; idx < size * size; idx += 1) {
      const t = tiles[idx];
      tiles[idx] = { shape: t.shape, rot: (t.rot + Math.floor(rng() * 4)) % 4 };
    }
    if (!isSolved(board)) break;
  }

  board.optimalTaps = solveBoard(board).taps.length;
  return board;
}

/**
 * BFS solver over rotation states (§C1.2 #9 — exported for the ?autoplay bot
 * AND test/minigamesE.test.js, which replays it over 200 seeded boards to
 * PROVE every deal solvable). The tractable state space is (cell, entry
 * side): routing water through a tile with a given entry/exit pair costs
 * that tile's minimal tap count for the pair (`minTapsFor`), and any valid
 * final configuration contains a SIMPLE tap→sprinkler path — so a
 * best-first branch-and-bound walk over simple paths, pruned by an
 * admissible relaxed-shortest-path heuristic, finds a provably MINIMAL tap
 * sequence (the §C1.2 #9 efficiency-bonus baseline). The returned taps are
 * verified against `isSolved` before returning.
 * @param {Board} board
 * @returns {{taps: number[], solvable: boolean}} taps = cell indices to tap,
 *   in order (repeats = multiple 90° turns); applying them yields isSolved.
 */
export function solveBoard(board) {
  if (isSolved(board)) return { taps: [], solvable: true };
  const legs = searchBestPath(board);
  if (legs == null) return { taps: [], solvable: false };
  /** @type {number[]} */
  const taps = [];
  for (const leg of legs) {
    for (let i = 0; i < leg.taps; i += 1) taps.push(leg.idx);
  }
  // Verify (airtight guarantee for the §C1.5 proof): replay on a copy.
  const copy = { ...board, tiles: board.tiles.map((t) => ({ ...t })) };
  for (const idx of taps) copy.tiles[idx] = rotateTile(copy.tiles[idx]);
  return { taps, solvable: isSolved(copy) };
}

/** DFS node budget — pruning keeps real boards far below this. */
const SOLVER_NODE_BUDGET = 200000;

/**
 * Admissible heuristic: relaxed shortest-path cost (revisits allowed) from
 * every (cell, entrySide) state to the finished sprinkler — a lower bound
 * for the simple-path cost. Plain O(V²) Dijkstra on the reversed graph
 * (≤ size²·4 states, weights 0..3).
 * @param {Board} board
 * @returns {number[]} h[idx*4+entry] lower bound (Infinity = dead state)
 */
function relaxedToGoal(board) {
  const { size, tiles, goalCol } = board;
  const stateCount = size * size * 4;
  const goalIdx = (size - 1) * size + goalCol;
  const h = new Array(stateCount).fill(Infinity);
  const settled = new Array(stateCount).fill(false);
  // Terminal edges: entering the goal cell via `entry` and exiting S.
  for (let entry = 0; entry < 4; entry += 1) {
    if (entry === DIRS.S) continue;
    const k = minTapsFor(tiles[goalIdx], [entry, DIRS.S]);
    if (Number.isFinite(k)) h[goalIdx * 4 + entry] = k;
  }
  for (;;) {
    let u = -1;
    for (let s = 0; s < stateCount; s += 1) {
      if (!settled[s] && h[s] < (u === -1 ? Infinity : h[u])) u = s;
    }
    if (u === -1 || h[u] === Infinity) break;
    settled[u] = true;
    // Reverse edge: predecessor (pIdx, pEntry) exits toward u's cell.
    const entry = u % 4;
    const idx = (u - entry) / 4;
    const col = idx % size;
    const row = (idx - col) / size;
    const exitDir = opposite(entry); // predecessor's exit direction toward us
    const pc = col - DELTA[exitDir][0];
    const pr = row - DELTA[exitDir][1];
    if (pc < 0 || pc >= size || pr < 0 || pr >= size) continue;
    const pIdx = pr * size + pc;
    for (let pEntry = 0; pEntry < 4; pEntry += 1) {
      if (pEntry === exitDir) continue;
      const k = minTapsFor(tiles[pIdx], [pEntry, exitDir]);
      if (!Number.isFinite(k)) continue;
      const v = pIdx * 4 + pEntry;
      if (h[u] + k < h[v]) h[v] = h[u] + k;
    }
  }
  return h;
}

/**
 * Branch-and-bound DFS over SIMPLE tap→sprinkler paths (each cell fixed to
 * one rotation, so per-visit costs compose soundly — the flaw a plain
 * relaxed Dijkstra has). Prunes with g + h ≥ best.
 * @param {Board} board
 * @returns {Array<{idx: number, taps: number}>|null} optimal legs or null
 */
function searchBestPath(board) {
  const { size, tiles, srcCol, goalCol } = board;
  const goalIdx = (size - 1) * size + goalCol;
  const h = relaxedToGoal(board);
  let best = Infinity;
  /** @type {Array<{idx: number, taps: number}>|null} */
  let bestLegs = null;
  const visited = new Set([srcCol]);
  /** @type {Array<{idx: number, taps: number}>} */
  const legs = [];
  let nodes = 0;

  const dfs = (idx, entry, g) => {
    nodes += 1;
    if (nodes > SOLVER_NODE_BUDGET) return;
    if (g + h[idx * 4 + entry] >= best) return; // admissible prune
    const col = idx % size;
    const row = (idx - col) / size;
    for (let exitDir = 0; exitDir < 4; exitDir += 1) {
      if (exitDir === entry) continue;
      const k = minTapsFor(tiles[idx], [entry, exitDir]);
      if (!Number.isFinite(k)) continue;
      if (idx === goalIdx && exitDir === DIRS.S) {
        if (g + k < best) {
          best = g + k;
          bestLegs = [...legs, { idx, taps: k }];
        }
        continue;
      }
      const nc = col + DELTA[exitDir][0];
      const nr = row + DELTA[exitDir][1];
      if (nc < 0 || nc >= size || nr < 0 || nr >= size) continue;
      const nIdx = nr * size + nc;
      if (visited.has(nIdx)) continue;
      visited.add(nIdx);
      legs.push({ idx, taps: k });
      dfs(nIdx, opposite(exitDir), g + k);
      legs.pop();
      visited.delete(nIdx);
    }
  };
  dfs(srcCol, DIRS.N, 0);
  return bestLegs;
}

/**
 * Tap-efficiency bonus (§C1.2 #9): 10 when totalTaps ≤ optimal+3, linear
 * down to 0 at optimal+15 (integer via round).
 * @param {number} totalTaps taps across the whole round
 * @param {number} optimalTaps summed solver optimum of the solved puzzles
 * @param {object} [tune]
 * @returns {number} 0..10
 */
export function tapEfficiencyBonus(totalTaps, optimalTaps, tune = PIPE) {
  const extra = Math.max(0, totalTaps - optimalTaps);
  if (extra <= tune.BONUS_FULL_EXTRA) return tune.BONUS_MAX;
  if (extra >= tune.BONUS_ZERO_EXTRA) return 0;
  return Math.round(
    (tune.BONUS_MAX * (tune.BONUS_ZERO_EXTRA - extra)) /
      (tune.BONUS_ZERO_EXTRA - tune.BONUS_FULL_EXTRA)
  );
}

/**
 * Round score (§C1.2 #9): 25·solved + efficiency bonus (the bonus only
 * exists once at least one puzzle connected).
 * @param {number} solved puzzles connected this round
 * @param {number} totalTaps
 * @param {number} optimalTaps
 * @param {object} [tune]
 * @returns {number}
 */
export function pipeScore(solved, totalTaps, optimalTaps, tune = PIPE, leakPenalties = 0) {
  if (solved <= 0) return 0;
  return Math.max(
    0,
    tune.SOLVE_POINTS * solved +
      tapEfficiencyBonus(totalTaps, optimalTaps, tune) -
      Math.max(0, leakPenalties) * tune.LEAK_PENALTY
  );
}

/** Solver-backed deterministic certification bot using the derived tune. */
export function simulatePipeAutoplay(seed, mode = 'normal') {
  const tune = applyDifficulty(PIPE, mode);
  const duration = tune.ENDLESS ? 150 : tune.DURATION_SEC;
  let elapsed = 0;
  let puzzle = 0;
  let solved = 0;
  let failures = 0;
  let taps = 0;
  let optimal = 0;
  while (elapsed < duration && failures < tune.ENDLESS_FAILURE_LIMIT) {
    puzzle += 1;
    const board = generateBoard(seed * 1009 + puzzle, tune);
    const solution = solveBoard(board);
    // Faster previews shorten the time available to inspect each tile. The
    // bot reads that derived speed as extra study/tap pressure, not as a free
    // throughput boost, so Leicht ≥ Mittel ≥ Schwer remains meaningful.
    const solveSec = (3.2 + solution.taps.length * 0.34) * tune.PREVIEW_SPEED_MULT;
    const leaking = puzzle >= tune.LEAK_FROM_PUZZLE && solveSec >= tune.LEAK_SEC;
    elapsed += solveSec + tune.FILL_END_DELAY_SEC;
    if (elapsed > duration) {
      if (tune.ENDLESS) failures += 1;
      break;
    }
    if (leaking) failures += 1;
    solved += 1;
    taps += solution.taps.length;
    optimal += solution.taps.length;
  }
  return { score: pipeScore(solved, taps, optimal, tune, failures), solved, failures, tune };
}
