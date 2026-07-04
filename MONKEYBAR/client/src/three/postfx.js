// Post-processing — PLAN.md §7 (client/src/three/postfx.js).
// EffectComposer: RenderPass + UnrealBloomPass + vignette/grain ShaderPass
// (+ OutputPass for tone mapping / sRGB). Fully toggleable for the quality
// setting — when disabled the engine renders directly.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const VignetteGrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    vignetteStrength: { value: 1.05 },
    vignetteSoftness: { value: 0.62 },
    grainAmount: { value: 0.045 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float vignetteStrength;
    uniform float vignetteSoftness;
    uniform float grainAmount;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7)) + time * 13.7) * 43758.5453);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      // vignette
      float d = distance(vUv, vec2(0.5)) * vignetteStrength;
      float vig = smoothstep(0.85, 0.85 - vignetteSoftness, d);
      color.rgb *= mix(0.55, 1.0, vig);
      // film grain
      float g = (hash(vUv * vec2(1920.0, 1080.0)) - 0.5) * grainAmount;
      color.rgb += g * (0.6 + 0.4 * (1.0 - vig));
      gl_FragColor = color;
    }
  `,
};

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 */
export function createPostFX(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    0.55, // strength
    0.65, // radius
    0.82 // threshold — only neon/emissive blooms
  );
  composer.addPass(bloom);

  const vignette = new ShaderPass(VignetteGrainShader);
  composer.addPass(vignette);

  composer.addPass(new OutputPass());

  let enabled = true;

  return {
    composer,
    bloom,
    vignette,
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = !!on;
    },
    setSize(w, h) {
      composer.setSize(w, h);
    },
    /** Render one frame through the composer (advances grain time). */
    render(dt) {
      vignette.uniforms.time.value += dt;
      composer.render(dt);
    },
    /** Momentary bloom surge (cannon flash). */
    pulseBloom(strength = 1.6, decay = 2.5) {
      bloom.strength = strength;
      const base = 0.55;
      const step = () => {
        bloom.strength = Math.max(base, bloom.strength - decay * 0.016);
        if (bloom.strength > base) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    dispose() {
      composer.dispose();
    },
  };
}
