// Visual merch showroom only. Purchases, prices, inventory and chat integration come later.
const merchSection = document.getElementById('merch');
const merchFeatured = document.getElementById('merch-featured');

const merchConcepts = {
  'invizible-tee': {
    brand: 'invizible', type: 'tee',
    name: 'Invizible Tee',
    category: 'INVIZIBLE / T-SHIRT',
    description: 'A stripped-back Invizible wordmark on a dark everyday tee.'
  },
  'invizible-hoodie': {
    brand: 'invizible', type: 'hoodie',
    name: 'Invizible Hoodie',
    category: 'INVIZIBLE / HOODIE',
    description: 'The same understated logo on a deeper green, oversized hoodie concept.'
  },
  'maverick-tee': {
    brand: 'maverick', type: 'tee',
    name: 'Maverick Tee',
    category: 'MIDNITE MAVERICK / T-SHIRT',
    description: 'Dark western-inspired colours and a restrained Midnite Maverick chest print.'
  },
  'maverick-hoodie': {
    brand: 'maverick', type: 'hoodie',
    name: 'Maverick Hoodie',
    category: 'MIDNITE MAVERICK / HOODIE',
    description: 'A warm charcoal-brown hoodie with the Maverick identity front and centre.'
  }
};

if (merchSection && merchFeatured) {
  const cards = Array.from(merchSection.querySelectorAll('[data-merch-id]'));
  const title = document.getElementById('merch-feature-name');
  const category = document.getElementById('merch-feature-category');
  const description = document.getElementById('merch-feature-description');
  const featuredShape = document.getElementById('merch-feature-shape');
  const featuredLogo = document.getElementById('merch-feature-logo');
  const featuredMaverick = document.getElementById('merch-feature-maverick');
  const art = merchFeatured.querySelector('.merch-feature-garment');
  const prefersLessMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  // Reveal the rack once as it enters the viewport. Without JS/observer,
  // all items remain visible and fully selectable.
  if ('IntersectionObserver' in window && !prefersLessMotion) {
    merchSection.dataset.merchAnimate = 'ready';
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      merchSection.classList.add('is-visible');
      observer.disconnect();
    }, { threshold: .08 });
    observer.observe(merchSection);
  } else {
    merchSection.classList.add('is-visible');
  }

  function featureItem(id) {
    const product = merchConcepts[id];
    if (!product) return;

    for (const card of cards) {
      card.setAttribute('aria-pressed', String(card.dataset.merchId === id));
    }

    merchFeatured.dataset.brand = product.brand;
    merchFeatured.dataset.merchId = id;
    title.textContent = product.name;
    category.textContent = product.category;
    description.textContent = product.description;

    featuredShape.setAttribute('href', `#merch-${product.type}`);
    const inviziblePrint = product.brand === 'invizible';
    featuredLogo.style.display = inviziblePrint ? '' : 'none';
    featuredLogo.setAttribute('y', product.type === 'hoodie' ? '129' : '130');
    featuredMaverick.toggleAttribute('hidden', inviziblePrint);

    if (!prefersLessMotion && art) {
      art.style.animation = 'none';
      void art.offsetWidth;
      art.style.animation = '';
    }
  }

  merchSection.addEventListener('click', (event) => {
    const card = event.target.closest('[data-merch-id]');
    if (!card || !merchSection.contains(card)) return;
    featureItem(card.dataset.merchId);
    merchFeatured.scrollIntoView?.({
      behavior: prefersLessMotion ? 'auto' : 'smooth',
      block: 'nearest'
    });
  });
}
