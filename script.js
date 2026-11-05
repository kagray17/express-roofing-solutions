// Express Roofing Solutions — v3 (no dependencies)
(() => {
  const d = document;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const header = d.getElementById('site-header');
  const toggle = d.getElementById('nav-toggle');

  // Mobile nav
  if (header && toggle) {
    toggle.addEventListener('click', () => {
      const open = header.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    d.querySelectorAll('.main-nav a').forEach((a) => a.addEventListener('click', () => {
      header.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }));
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && header.classList.contains('open')) {
        header.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); toggle.focus();
      }
    });
  }

  // Scroll-driven bits (one rAF loop, passive listener)
  const media = d.querySelector('[data-parallax]');
  const timeline = d.getElementById('timeline');
  let ticking = false;
  const onScroll = () => {
    const y = window.scrollY;
    if (header) header.classList.toggle('scrolled', y > 12);
    if (media && !reduce && window.innerWidth > 720 && y < window.innerHeight * 1.2) {
      media.style.transform = `translate3d(0, ${y * 0.22}px, 0) scale(1.06)`;
    }
    if (timeline) {
      const r = timeline.getBoundingClientRect();
      const mid = window.innerHeight * 0.6;
      const p = Math.min(1, Math.max(0, (mid - r.top) / r.height));
      timeline.style.setProperty('--progress', p.toFixed(3));
      timeline.querySelectorAll('.step').forEach((s) => {
        s.classList.toggle('is-active', s.getBoundingClientRect().top < mid);
      });
    }
    ticking = false;
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  // Reveal + counters
  const fmt = (n) => n.toLocaleString('en-US');
  const count = (el) => {
    const target = parseInt(el.dataset.count, 10);
    if (reduce || !target) return;
    const dur = 1400; const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = fmt(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const reveals = d.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-visible');
        en.target.querySelectorAll('[data-count]').forEach(count);
        io.unobserve(en.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-visible'));
  }

  // Before / after slider
  const ba = d.getElementById('ba');
  const range = d.getElementById('ba-range');
  if (ba && range) {
    const set = () => ba.style.setProperty('--pos', range.value + '%');
    range.addEventListener('input', set);
    set();
  }

  // Service-area chips <-> map dots
  const chips = d.querySelectorAll('[data-town]');
  chips.forEach((el) => {
    const key = el.dataset.town;
    const on = (v) => d.querySelectorAll(`[data-town="${key}"]`).forEach((m) => m.classList.toggle('is-hot', v));
    el.addEventListener('mouseenter', () => on(true));
    el.addEventListener('mouseleave', () => on(false));
  });

  // FAQ: one open at a time
  const faqs = d.querySelectorAll('.faq-item');
  faqs.forEach((f) => f.addEventListener('toggle', () => {
    if (f.open) faqs.forEach((o) => { if (o !== f) o.open = false; });
  }));
})();
