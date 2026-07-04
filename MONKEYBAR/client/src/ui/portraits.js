// 2D canvas monkey portraits (P5) — simple stylized busts drawn from the
// roster silhouette params (shared/monkeys.js §6). Used by lobby member list,
// character select grid, seat plates, and the results podium.

/**
 * Draw a monkey portrait onto a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {import('@shared/monkeys.js').Monkey|undefined} monkey
 * @param {{size?: number, ghost?: boolean}} [opts]
 */
export function drawMonkeyPortrait(canvas, monkey, opts = {}) {
  const size = opts.size ?? 96;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const s = monkey?.silhouette ?? {
    bodyScale: 1,
    limbLength: 1,
    earSize: 1,
    muzzleSize: 1,
    furPalette: ['#8a5a2b', '#c99b6a', '#e8c39e'],
  };
  const [fur, furLight, skin] = s.furPalette;
  const cx = size / 2;
  const cy = size * 0.54;
  const headR = size * 0.26 * (0.8 + 0.25 * Math.min(s.bodyScale, 1.7));
  const earR = headR * 0.42 * s.earSize;

  if (opts.ghost) ctx.globalAlpha = 0.45;

  // shoulders / bust
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(cx, size * 0.98, headR * 1.5, headR * 1.05, 0, Math.PI, 0);
  ctx.fill();
  // belly patch
  ctx.fillStyle = furLight;
  ctx.beginPath();
  ctx.ellipse(cx, size * 1.0, headR * 0.8, headR * 0.6, 0, Math.PI, 0);
  ctx.fill();

  // ears
  ctx.fillStyle = fur;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + dir * headR * 0.98, cy - headR * 0.25, earR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = skin;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + dir * headR * 0.98, cy - headR * 0.25, earR * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  // head
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.arc(cx, cy, headR, 0, Math.PI * 2);
  ctx.fill();

  // face patch
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(cx, cy + headR * 0.18, headR * 0.72, headR * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();

  // muzzle
  const muzzleR = headR * 0.42 * s.muzzleSize;
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(cx, cy + headR * 0.42, muzzleR, muzzleR * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();

  // nostrils + smirk
  ctx.strokeStyle = 'rgba(30,18,10,0.75)';
  ctx.lineWidth = Math.max(1.2, size * 0.018);
  ctx.beginPath();
  ctx.arc(cx, cy + headR * 0.42, muzzleR * 0.5, 0.25, Math.PI - 0.25);
  ctx.stroke();
  ctx.fillStyle = 'rgba(30,18,10,0.8)';
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + dir * muzzleR * 0.22, cy + headR * 0.32, size * 0.014, 0, Math.PI * 2);
    ctx.fill();
  }

  // eyes
  const eyeY = cy - headR * 0.12;
  const eyeDX = headR * 0.34;
  for (const dir of [-1, 1]) {
    ctx.fillStyle = '#fdf6e8';
    ctx.beginPath();
    ctx.ellipse(cx + dir * eyeDX, eyeY, headR * 0.2, headR * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#241a10';
    ctx.beginPath();
    ctx.arc(cx + dir * eyeDX + headR * 0.04, eyeY + headR * 0.03, headR * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(cx + dir * eyeDX + headR * 0.08, eyeY - headR * 0.03, headR * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }

  // fur tuft
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(cx, cy - headR * 0.92, headR * 0.4, headR * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  // tiny accessory hints so each monkey reads distinct
  drawAccessoryHint(ctx, monkey, { cx, cy, headR, size });
  ctx.globalAlpha = 1;
}

function drawAccessoryHint(ctx, monkey, { cx, cy, headR, size }) {
  const acc = monkey?.silhouette?.accessories?.[0];
  if (!acc) return;
  ctx.save();
  switch (acc) {
    case 'mohawk_red': {
      ctx.fillStyle = '#ff3d3d';
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * headR * 0.22 - headR * 0.1, cy - headR * 0.86);
        ctx.lineTo(cx + i * headR * 0.22, cy - headR * 1.45);
        ctx.lineTo(cx + i * headR * 0.22 + headR * 0.1, cy - headR * 0.86);
        ctx.fill();
      }
      break;
    }
    case 'top_hat': {
      ctx.fillStyle = '#14100c';
      ctx.fillRect(cx - headR * 0.9, cy - headR * 1.18, headR * 1.8, headR * 0.22);
      ctx.fillRect(cx - headR * 0.55, cy - headR * 1.95, headR * 1.1, headR * 0.8);
      ctx.fillStyle = '#ffd23d';
      ctx.fillRect(cx - headR * 0.55, cy - headR * 1.32, headR * 1.1, headR * 0.14);
      break;
    }
    case 'shawl': {
      ctx.strokeStyle = '#b86a8a';
      ctx.lineWidth = size * 0.05;
      ctx.beginPath();
      ctx.arc(cx, cy + headR * 1.4, headR * 1.15, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      break;
    }
    case 'headphones': {
      ctx.strokeStyle = '#35e8d0';
      ctx.lineWidth = size * 0.04;
      ctx.beginPath();
      ctx.arc(cx, cy - headR * 0.1, headR * 1.12, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.fillStyle = '#35e8d0';
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + dir * headR * 1.02, cy - headR * 0.1, headR * 0.22, headR * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'nun_habit': {
      ctx.fillStyle = '#2a2a33';
      ctx.beginPath();
      ctx.arc(cx, cy - headR * 0.15, headR * 1.12, Math.PI, 0);
      ctx.fill();
      break;
    }
    case 'bib': {
      ctx.fillStyle = '#7ae8ff';
      ctx.beginPath();
      ctx.arc(cx, cy + headR * 1.55, headR * 0.62, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'cracked_glasses': {
      ctx.strokeStyle = '#e8e0d0';
      ctx.lineWidth = size * 0.022;
      for (const dir of [-1, 1]) {
        ctx.strokeRect(cx + dir * headR * 0.55 - headR * 0.26, cy - headR * 0.34, headR * 0.52, headR * 0.44);
      }
      ctx.beginPath();
      ctx.moveTo(cx - headR * 0.29, cy - headR * 0.12);
      ctx.lineTo(cx + headR * 0.29, cy - headR * 0.12);
      ctx.stroke();
      break;
    }
    case 'eye_patch': {
      ctx.fillStyle = '#14100c';
      ctx.beginPath();
      ctx.ellipse(cx - headR * 0.34, cy - headR * 0.12, headR * 0.24, headR * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#14100c';
      ctx.lineWidth = size * 0.02;
      ctx.beginPath();
      ctx.moveTo(cx - headR * 0.95, cy - headR * 0.4);
      ctx.lineTo(cx + headR * 0.85, cy + headR * 0.05);
      ctx.stroke();
      break;
    }
    case 'feather_boa': {
      ctx.fillStyle = '#ff5a7a';
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(cx + i * headR * 0.35, cy + headR * 1.35, headR * 0.24, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'tank_top': {
      ctx.fillStyle = '#f0e6d8';
      ctx.fillRect(cx - headR * 0.75, cy + headR * 1.25, headR * 1.5, headR * 0.6);
      break;
    }
    case 'mask_markings': {
      ctx.strokeStyle = '#3a332c';
      ctx.lineWidth = size * 0.03;
      ctx.beginPath();
      ctx.arc(cx, cy + headR * 0.1, headR * 0.8, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      break;
    }
    case 'trench_coat': {
      ctx.fillStyle = '#4a4238';
      ctx.beginPath();
      ctx.moveTo(cx - headR * 1.3, cy + headR * 1.9);
      ctx.lineTo(cx - headR * 0.7, cy + headR * 1.0);
      ctx.lineTo(cx + headR * 0.7, cy + headR * 1.0);
      ctx.lineTo(cx + headR * 1.3, cy + headR * 1.9);
      ctx.fill();
      break;
    }
    case 'soda_can_crown': {
      ctx.fillStyle = '#d43d3d';
      ctx.fillRect(cx - headR * 0.55, cy - headR * 1.5, headR * 1.1, headR * 0.5);
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(cx - headR * 0.55, cy - headR * 1.58, headR * 1.1, headR * 0.1);
      break;
    }
    case 'acorn_pouch': {
      ctx.fillStyle = '#8a6a3a';
      ctx.beginPath();
      ctx.arc(cx + headR * 0.9, cy + headR * 1.5, headR * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'veil': {
      ctx.fillStyle = 'rgba(217,199,232,0.5)';
      ctx.beginPath();
      ctx.arc(cx, cy - headR * 0.05, headR * 1.12, Math.PI, 0);
      ctx.fill();
      break;
    }
    case 'neon_arm': {
      ctx.strokeStyle = '#35e8d0';
      ctx.lineWidth = size * 0.035;
      ctx.shadowColor = '#35e8d0';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(cx + headR * 0.7, cy + headR * 1.9);
      ctx.lineTo(cx + headR * 1.25, cy + headR * 1.1);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/** Build a ready-to-insert portrait canvas element. */
export function portraitCanvas(monkey, size = 96, ghost = false) {
  const canvas = document.createElement('canvas');
  canvas.className = 'monkey-portrait';
  drawMonkeyPortrait(canvas, monkey, { size, ghost });
  return canvas;
}
