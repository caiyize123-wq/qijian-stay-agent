// Pointer-only parallax: no sensors, permissions or perpetual render loop.
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const pointer = matchMedia('(hover: hover) and (pointer: fine)');
let frame = 0;
let active;
function reset() {
  cancelAnimationFrame(frame);
  active?.style.removeProperty('--look-x');
  active?.style.removeProperty('--look-y');
  active = undefined;
}
document.addEventListener('pointermove', event => {
  if (motion.matches || !pointer.matches) return;
  const scene = event.target.closest('.spatial-scene');
  if (!scene) { if (active) reset(); return; }
  if (active && active !== scene) reset();
  active = scene;
  const box = scene.getBoundingClientRect();
  const x = Math.max(-1, Math.min(1, (event.clientX - box.left) / box.width * 2 - 1));
  const y = Math.max(-1, Math.min(1, (event.clientY - box.top) / box.height * 2 - 1));
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    scene.style.setProperty('--look-x', x.toFixed(3));
    scene.style.setProperty('--look-y', y.toFixed(3));
  });
}, {passive: true});
document.addEventListener('pointerleave', reset);
window.addEventListener('blur', reset);
motion.addEventListener('change', reset);
pointer.addEventListener('change', reset);
