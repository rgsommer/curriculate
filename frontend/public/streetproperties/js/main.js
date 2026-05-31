// Street Properties — site interactions

document.addEventListener('DOMContentLoaded', () => {
  // Sticky header shadow when scrolled
  const header = document.querySelector('.site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Mobile menu toggle
  const toggle = document.querySelector('.nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      document.body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', document.body.classList.contains('nav-open') ? 'true' : 'false');
    });
    document.querySelectorAll('.nav-links a').forEach((a) =>
      a.addEventListener('click', () => {
        document.body.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      })
    );
  }

  // Mark active nav link by path
  const path = location.pathname.replace(/\/+$/, '');
  const file = (path.split('/').pop() || 'index.html').replace('.html', '') || 'index';
  document.querySelectorAll('.nav-links a').forEach((a) => {
    const target = (a.getAttribute('href') || '').replace(/\/+$/, '').split('/').pop().replace('.html', '') || 'index';
    if (target === file || (file === 'index' && (target === '' || target === 'streetproperties'))) {
      a.classList.add('active');
    }
  });

  // Reveal on scroll — progressive enhancement only
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.classList.add('js-anim');
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    document.querySelectorAll('.reveal').forEach((el) => obs.observe(el));
    // Safety net — reveal anything still hidden after 6s (e.g., screenshot tools)
    setTimeout(() => {
      document.querySelectorAll('.reveal:not(.in)').forEach((el) => el.classList.add('in'));
    }, 6000);
  }

  // Contact form (demo handler — no backend wired yet)
  const form = document.querySelector('.form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      if (!btn) return;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Thank you — we will be in touch';
      setTimeout(() => {
        form.reset();
        btn.disabled = false;
        btn.textContent = original;
      }, 4000);
    });
  }
});
