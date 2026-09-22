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
  const {createSpring, updateSpring} = window.LiquidGlassSpring;
  const position = createSpring(0), width = createSpring(0), bulge = createSpring(0);
  let placed = false, targetSignature = '';
  bar.classList.add('has-glass-physics');
  function schedule() {
    until = performance.now() + 650;
    if (!frame && !document.hidden) frame = requestAnimationFrame(draw);
  }
  function draw(time) {
    frame = 0;
    const bounds = bar.getBoundingClientRect();
    if (!bounds.width || document.hidden) {
      canvas.hidden = true;
      return;
    }
    canvas.hidden = !renderer || transparency.matches;
    const targetX = parseFloat(lens.style.getPropertyValue('--lens-x')) || 0;
    const targetWidth = parseFloat(lens.style.getPropertyValue('--lens-w')) || 0;
    const dt = previousTime ? Math.min((time - previousTime) / 1000, .064) : 1 / 60;
    position.target = targetX;
    width.target = targetWidth;
    bulge.target = pressed && !motion.matches ? .16 : 0;
    if (!placed || motion.matches || lens.classList.contains('is-dragging')) {
      position.current = targetX; position.velocity = 0;
      width.current = targetWidth; width.velocity = 0;
      placed = targetWidth > 0;
    } else {
      updateSpring(position, dt); updateSpring(width, dt);
    }
    if (motion.matches) { bulge.current = 0; bulge.velocity = 0; }
    else updateSpring(bulge, dt, 260, 16);
    lens.style.transform = `translate3d(${position.current}px,0,0)`;
    lens.style.width = `${width.current}px`;
    const stretch = motion.matches ? 0 : Math.min(Math.abs(position.velocity) * .00005, .035);
    lens.firstElementChild.style.transform = `scale(${1 + bulge.current * .12 + stretch},${1 + bulge.current * .55 - stretch})`;
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
    if (!motion.matches && (time < until || position.velocity !== 0 || width.velocity !== 0 || bulge.velocity !== 0)) frame = requestAnimationFrame(draw);
  }
  try { renderer = new LiquidGlassRenderer(canvas, schedule); }
  catch { canvas.remove(); }
  const resize = () => {
    const rect = bar.getBoundingClientRect();
    if (rect.width) renderer?.resize(rect.width, rect.height);
    schedule();
  };
  new ResizeObserver(resize).observe(bar);
  new MutationObserver(() => {
    const signature = lens.style.getPropertyValue('--lens-x') + '/' + lens.style.getPropertyValue('--lens-w') + '/' + lens.className;
    if (signature === targetSignature) return;
    targetSignature = signature;
    if (lens.classList.contains('is-instant')) placed = false;
    schedule();
  }).observe(lens, {attributes: true, attributeFilter: ['style', 'class']});
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
