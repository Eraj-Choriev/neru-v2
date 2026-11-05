// ============================================
// NŪR — Liquid Glass refraction
// ============================================
//
// A vanilla port of the edge-refraction technique in Glisse
// (https://github.com/0kzh/glisse — MIT © 2026 Kelvin Zhang).
//
// Real glass bends what is behind it most at its rim, where the surface
// curves away; the middle stays true. Glisse reproduces that with an SVG
// displacement map applied as a backdrop filter: within a band around the
// rim each pixel shows the backdrop from a little further in, so the map's
// roads visibly bend into the edge of the pane.
//
// Only Chromium applies an SVG filter inside `backdrop-filter`. Elsewhere
// nothing is set and the CSS falls back to its plain blur, which is the
// whole design in Safari — this is an enhancement, never the mechanism.
//
// Usage: add `data-glass` to an element whose size is stable (a bar, a
// button, a capsule). Its backdrop-filter must include `var(--glass-refract,)`.
// Elements that animate their size (lenses, switch thumbs) are left out on
// purpose: a map drawn for one size would smear at another.

const liquidGlass = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const ua = navigator.userAgent;
  const supported =
    /Chrom(?:e|ium)\//.test(ua) &&
    typeof ResizeObserver === 'function' &&
    !matchMedia('(prefers-reduced-transparency: reduce)').matches;

  const DEPTH = 14;      // px: width of the bending band along the rim
  const STRENGTH = 0.9;  // how far in the rim reaches, as a share of DEPTH
  const MAX_FILTERS = 32;

  const filters = new Map(); // key → { id, node }
  let defs = null;
  let seq = 0;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Signed distance to a rounded rectangle centred on the origin.
  function sdf(x, y, hw, hh, r) {
    const qx = Math.abs(x) - hw + r;
    const qy = Math.abs(y) - hh + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  }

  /** R and G carry the horizontal and vertical pull, 128 meaning none. */
  function drawMap(w, h, r) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(w, h);
    const data = img.data;
    const hw = w / 2, hh = h / 2;
    const e = 0.5;
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const i = (row * w + col) * 4;
        const x = col + 0.5 - hw;
        const y = row + 0.5 - hh;
        const d = sdf(x, y, hw, hh, r);
        let rx = 128, gy = 128;
        if (d < 0 && d > -DEPTH) {
          // 1 at the rim, 0 where the band ends; squared, like the slope of a
          // shallow dome, so the bend gathers at the very edge.
          const t = 1 + d / DEPTH;
          const m = t * t;
          // Outward normal from the distance field's gradient.
          const nx = sdf(x + e, y, hw, hh, r) - sdf(x - e, y, hw, hh, r);
          const ny = sdf(x, y + e, hw, hh, r) - sdf(x, y - e, hw, hh, r);
          const len = Math.hypot(nx, ny) || 1;
          // Sample from further in: against the normal.
          rx = Math.round(clamp(0.5 - 0.5 * m * (nx / len), 0, 1) * 255);
          gy = Math.round(clamp(0.5 - 0.5 * m * (ny / len), 0, 1) * 255);
        }
        data[i] = rx;
        data[i + 1] = gy;
        data[i + 2] = 128;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }

  function container() {
    if (defs?.isConnected) return defs;
    const root = document.createElementNS(NS, 'svg');
    root.setAttribute('width', '0');
    root.setAttribute('height', '0');
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
    defs = document.createElementNS(NS, 'defs');
    root.append(defs);
    document.body.append(root);
    return defs;
  }

  function el(name, attrs) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  }

  function filterFor(w, h, r) {
    const key = `${w}x${h}r${r}`;
    const hit = filters.get(key);
    if (hit) return hit.id;
    const href = drawMap(w, h, r);
    if (!href) return null;
    const id = `nur-glass-${++seq}`;
    const node = el('filter', {
      id, x: 0, y: 0, width: w, height: h,
      filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse',
      'color-interpolation-filters': 'sRGB',
    });
    node.append(
      el('feImage', { href, x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result: 'map' }),
      el('feDisplacementMap', {
        in: 'SourceGraphic', in2: 'map', scale: 2 * DEPTH * STRENGTH,
        xChannelSelector: 'R', yChannelSelector: 'G',
      }),
    );
    container().append(node);
    filters.set(key, { id, node });
    // Rotations and resizes leave old sizes behind; keep the set small.
    if (filters.size > MAX_FILTERS) {
      const [oldKey, old] = filters.entries().next().value;
      old.node.remove();
      filters.delete(oldKey);
    }
    return id;
  }

  function refresh(target) {
    const w = Math.round(target.offsetWidth);
    const h = Math.round(target.offsetHeight);
    if (!w || !h) return; // display:none (desktop-only or phone-only chrome)
    const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
    const id = filterFor(w, h, Math.round(clamp(radius, 0, Math.min(w, h) / 2)));
    if (id) target.style.setProperty('--glass-refract', `url(#${id})`);
  }

  let observer = null;
  const pending = new Set();
  let frame = 0;
  const flush = () => {
    frame = 0;
    for (const target of pending) refresh(target);
    pending.clear();
  };

  /** Give every `[data-glass]` element under `root` its refraction. */
  function attach(root = document) {
    if (!supported) return;
    observer ||= new ResizeObserver((entries) => {
      for (const entry of entries) pending.add(entry.target);
      frame ||= requestAnimationFrame(flush);
    });
    root.querySelectorAll('[data-glass]').forEach((target) => {
      if (target.dataset.glassBound) return;
      target.dataset.glassBound = '';
      observer.observe(target);
    });
  }

  return { attach, supported };
})();
