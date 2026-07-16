// Radial-gradient contact "blob" shadow (§D2.2, §D4): a soft dark circle on a
// transparent plane laid flat under a character/prop. Cheap fake shadow used
// everywhere real shadow maps are off (minigames, city, showcase). The texture
// is a tiny shared CanvasTexture; each blob owns its material (opacity is
// animated per-instance) but shares the texture.

import * as THREE from 'three';

const TEX_SIZE = 128;

/** @type {THREE.CanvasTexture|null} */
let sharedTexture = null;

function getTexture() {
  if (sharedTexture) return sharedTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEX_SIZE;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(
    TEX_SIZE / 2, TEX_SIZE / 2, 0,
    TEX_SIZE / 2, TEX_SIZE / 2, TEX_SIZE / 2
  );
  grad.addColorStop(0, 'rgba(58,46,46,0.55)');
  grad.addColorStop(0.55, 'rgba(58,46,46,0.32)');
  grad.addColorStop(1, 'rgba(58,46,46,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  sharedTexture = new THREE.CanvasTexture(canvas);
  return sharedTexture;
}

/**
 * Create a blob shadow plane. Add `mesh` to the scene (or under the character
 * root); it lies flat on XZ, slightly above y=0 to avoid z-fighting.
 *
 * @param {{radius?: number, opacity?: number}} [opts]
 *   radius: world radius of the blob (default 0.42 — sized for Gooby)
 *   opacity: base opacity multiplier 0..1 (default 1)
 * @returns {{
 *   mesh: THREE.Mesh,
 *   setSquash: (s: number) => void,   // 1 = rest; >1 widens+darkens (landing squash), <1 shrinks+fades (airborne)
 *   setOpacity: (o: number) => void,  // override base opacity 0..1
 *   dispose: () => void,
 * }}
 */
export function createBlobShadow(opts = {}) {
  const { radius = 0.42, opacity = 1 } = opts;
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2);
  const mat = new THREE.MeshBasicMaterial({
    map: getTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'blobShadow';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.01;
  mesh.renderOrder = -1;

  let baseOpacity = opacity;

  return {
    mesh,
    setSquash(s) {
      const k = Math.max(0.05, s);
      mesh.scale.set(k, k, 1);
      // Airborne (small squash) → lighter; grounded squash → slightly darker.
      mat.opacity = baseOpacity * Math.min(1.15, 0.35 + 0.65 * k);
    },
    setOpacity(o) {
      baseOpacity = o;
      mat.opacity = o * mesh.scale.x;
    },
    dispose() {
      geo.dispose();
      mat.dispose(); // texture is shared, never disposed
    },
  };
}
