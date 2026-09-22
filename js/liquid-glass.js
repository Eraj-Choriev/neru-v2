/* WebGL highlights over the existing accessible navigation and moving lens.
 * CSS owns blur/selection; the canvas never intercepts input or samples tiles. */
(() => {
  const bar = document.getElementById('tabbar');
  const lens = document.getElementById('tab-lens');
  if (!bar || !lens || !window.LiquidGlassRenderer) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'tabbar-glass-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  bar.append(canvas);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const transparency = matchMedia('(prefers-reduced-transparency: reduce)');
  let renderer, frame = 0, until = 0, previousX = 0, previousTime = 0;
  let light = [0.35, 0.8], pressed = false;
  function schedule() {
    until = performance.now() + 650;
    if (!frame && !document.hidden) frame = requestAnimationFrame(draw);
  }
  function draw(time) {
    frame = 0;
    const bounds = bar.getBoundingClientRect();
    if (!bounds.width || document.hidden || transparency.matches) {
      canvas.hidden = true;
      return;
    }
    canvas.hidden = !renderer;
    const pill = lens.getBoundingClientRect();
    const x = pill.left - bounds.left + pill.width / 2;
    const velocity = previousTime ? (x - previousX) / Math.max((time - previousTime) / 1000, .001) : 0;
    renderer?.render({
      lightPos: motion.matches ? [0.35, 0.8] : light,
      pillX: x, pillWidth: pill.width, pillHeight: pill.height,
      navRadius: bounds.height / 2,
      transitionVel: motion.matches ? 0 : velocity,
      pressAmt: motion.matches ? 0 : Number(pressed), tintColor: [0.65, 0.7, 1],
    });
    previousX = x; previousTime = time;
    if (!motion.matches && time < until) frame = requestAnimationFrame(draw);
  }
  try { renderer = new LiquidGlassRenderer(canvas, schedule); }
  catch { canvas.remove(); return; }
  const resize = () => {
    const rect = bar.getBoundingClientRect();
    if (rect.width) renderer.resize(rect.width, rect.height);
    schedule();
  };
  new ResizeObserver(resize).observe(bar);
  new MutationObserver(schedule).observe(lens, {attributes: true, attributeFilter: ['style', 'class']});
  bar.addEventListener('pointermove', e => {
    if (motion.matches) return;
    const rect = bar.getBoundingClientRect();
    light = [(e.clientX - rect.left) / rect.width, 1 - (e.clientY - rect.top) / rect.height];
    schedule();
  });
  bar.addEventListener('pointerdown', () => { pressed = true; schedule(); });
  const release = () => { pressed = false; schedule(); };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(frame); frame = 0; previousTime = 0;
    if (!document.hidden) schedule();
  });
  motion.addEventListener('change', schedule);
  transparency.addEventListener('change', schedule);
  bar.addEventListener('keydown', e => {
    const items = [...bar.querySelectorAll('.tabbar-item')];
    const index = items.indexOf(document.activeElement);
    if (index < 0) return;
    const next = {ArrowRight: (index + 1) % items.length, ArrowLeft: (index + items.length - 1) % items.length, Home: 0, End: items.length - 1}[e.key];
    if (next !== undefined) { e.preventDefault(); items[next].focus(); }
  });
  resize();
})();
