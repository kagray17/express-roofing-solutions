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

  // Before / after slider and job switcher
  const ba = d.getElementById('ba');
  const range = d.getElementById('ba-range');
  const jobs = [
    {
      native: false,
      before: {
        alt: 'Before: worn asphalt shingle roof',
        w: 1440, h: 1920,
        webp: 'assets/photos/jobs/before-1-800.webp 800w, assets/photos/jobs/before-1.webp 1440w',
        jpg: 'assets/photos/jobs/before-1.jpg',
        sizes: '(max-width:1100px) 100vw, 60vw'
      },
      after: {
        alt: 'After: new roof with new soffit and fascia',
        w: 1920, h: 1440,
        webp: 'assets/photos/jobs/after-1-800.webp 800w, assets/photos/jobs/after-1.webp 1920w',
        jpg: 'assets/photos/jobs/after-1.jpg',
        sizes: '(max-width:1100px) 100vw, 60vw'
      }
    },
    {
      native: false,
      before: {
        alt: 'Before: worn roof edge and fascia',
        w: 1440, h: 1920,
        webp: 'assets/photos/jobs/before-2-800.webp 800w, assets/photos/jobs/before-2.webp 1440w',
        jpg: 'assets/photos/jobs/before-2.jpg',
        sizes: '(max-width:1100px) 100vw, 60vw'
      },
      after: {
        alt: 'After: new roof with new soffit and fascia',
        w: 1920, h: 1440,
        webp: 'assets/photos/jobs/after-2-800.webp 800w, assets/photos/jobs/after-2.webp 1920w',
        jpg: 'assets/photos/jobs/after-2.jpg',
        sizes: '(max-width:1100px) 100vw, 60vw'
      }
    },
    {
      native: true,
      before: {
        alt: 'Before: old commercial flat-roof membrane during tear-off, Lafayette, IN',
        w: 480, h: 640,
        webp: 'assets/photos/jobs/before-3.webp 480w',
        jpg: 'assets/photos/jobs/before-3.jpg',
        sizes: '480px'
      },
      after: {
        alt: 'After: new white membrane on a commercial flat roof, Lafayette, IN',
        w: 640, h: 480,
        webp: 'assets/photos/jobs/after-3.webp 640w',
        jpg: 'assets/photos/jobs/after-3.jpg',
        sizes: '480px'
      }
    }
  ];
  const setPic = (id, photo) => {
    const picture = d.getElementById(id);
    if (!picture) return;
    const source = picture.querySelector('source');
    const img = picture.querySelector('img');
    source.srcset = photo.webp;
    source.sizes = photo.sizes;
    img.src = photo.jpg;
    img.alt = photo.alt;
    img.width = photo.w;
    img.height = photo.h;
  };
  if (ba && range) {
    const set = () => ba.style.setProperty('--pos', range.value + '%');
    range.addEventListener('input', set);
    set();
    const tabs = [...d.querySelectorAll('.ba-switch [role="tab"]')];
    const show = (index) => {
      const job = jobs[index];
      if (!job) return;
      ba.classList.toggle('is-native', job.native);
      setPic('ba-before-pic', job.before);
      setPic('ba-after-pic', job.after);
      tabs.forEach((tab, i) => tab.setAttribute('aria-selected', String(i === index)));
      range.value = '50';
      set();
    };
    tabs.forEach((tab, index) => tab.addEventListener('click', () => show(index)));
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
