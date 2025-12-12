const animatedElements = document.querySelectorAll('[data-animate]');

if (animatedElements.length) {
  document.body.classList.add('anim-ready');

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );

    animatedElements.forEach(el => observer.observe(el));
  } else {
    animatedElements.forEach(el => el.classList.add('visible'));
  }
}

document.getElementById('year').textContent = new Date().getFullYear();
