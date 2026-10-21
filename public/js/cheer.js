// Friendly touches for the student screen: cheers, confetti, and replaying
// small CSS animations. Nothing here changes what the page does.

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const CHEERS = ['Nailed it! 🎉', 'You got it! ⭐', 'Great teamwork! 🙌', 'Correct! 💪', 'Awesome! 🚀', 'Way to go! 🌟'];
export const NUDGES = ['Not quite. Try again! 🤔', 'Not yet. Check your work together. 🔍', 'Hmm, give it another go! 💭', 'Not yet. Talk it through and try again. 💬'];

export const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Start a CSS animation class over, even if it's already on the element. */
export function replay(node, className) {
  if (!node) return;
  node.classList.remove(className);
  void node.offsetWidth; // a reflow lets the same animation run again
  node.classList.add(className);
  // Children's animations bubble up here too; wait for the node's own.
  const done = (event) => {
    if (event.target !== node) return;
    node.classList.remove(className);
    node.removeEventListener('animationend', done);
  };
  node.addEventListener('animationend', done);
}

const COLORS = ['#F6A23C', '#FFD23F', '#FF7A8A', '#1FA58F', '#2456C9', '#7B4FD6'];

/** A burst of confetti from an element (or the top of the screen), drawn on a throwaway canvas. */
export function confetti(from, count = 70) {
  if (calm()) return;
  requestAnimationFrame(() => {
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.append(canvas);
    const w = innerWidth;
    const h = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const rect = from?.getBoundingClientRect();
    const x0 = rect?.width ? rect.left + rect.width / 2 : w / 2;
    const y0 = rect?.width ? rect.top + rect.height / 2 : h / 4;
    const pieces = Array.from({ length: count }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      const speed = 7 + Math.random() * 9;
      return {
        x: x0,
        y: y0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 7 + Math.random() * 6,
        turn: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.35,
        color: pick(COLORS),
        round: Math.random() < 0.35,
      };
    });

    const LIFE = 1700;
    const start = performance.now();
    const frame = (now) => {
      const t = now - start;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = t < LIFE * 0.6 ? 1 : Math.max(0, 1 - (t - LIFE * 0.6) / (LIFE * 0.4));
      for (const p of pieces) {
        p.vy += 0.32;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.turn += p.spin;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.turn);
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        ctx.restore();
      }
      if (t < LIFE) requestAnimationFrame(frame);
      else canvas.remove();
    };
    requestAnimationFrame(frame);
  });
}
