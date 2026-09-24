// Hanging stage display; product concepts are not an inventory or checkout.
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


const toggle = document.getElementById('merch-toggle');
const cards = [...merchSection.querySelectorAll('.merch-item')];
const rack = merchSection.querySelector('.merch-rack-viewport');
const back = document.getElementById('merch-back');
let selectedCard = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function tellChat(product = null) {
  window.dispatchEvent(new CustomEvent('merch-selection', { detail: product }));
}
function overview(focus = true) {
  merchFeatured.hidden = true;
  rack.hidden = false;
  cards.forEach(card => card.setAttribute('aria-pressed', 'false'));
  if (focus) selectedCard?.focus({ preventScroll: true });
  selectedCard = null;
  tellChat();
}
function setOpen(open) {
  if (!open) { toggle.focus({ preventScroll: true }); overview(false); }
  document.body.classList.toggle('merch-open', open);
  merchSection.classList.toggle('is-open', open);
  merchSection.inert = !open;
  merchSection.setAttribute('aria-hidden', String(!open));
  toggle.setAttribute('aria-expanded', String(open));
  if (open) {
    window.dispatchEvent(new CustomEvent('merch-open'));
    cards[0].focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 1499px)').matches) {
      merchSection.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
    }
  }
}
toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
document.getElementById('merch-close').addEventListener('click', () => setOpen(false));
back.addEventListener('click', () => overview());
merchSection.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  if (!merchFeatured.hidden) overview(); else setOpen(false);
});
cards.forEach(card => card.addEventListener('click', () => {
  const product = merchConcepts[card.dataset.merchId];
  selectedCard = card;
  cards.forEach(item => item.setAttribute('aria-pressed', String(item === card)));
  merchFeatured.dataset.brand = product.brand;
  merchFeatured.dataset.merchId = card.dataset.merchId;
  document.getElementById('merch-feature-name').textContent = product.name;
  document.getElementById('merch-feature-category').textContent = product.category;
  document.getElementById('merch-feature-description').textContent = product.description;
  document.getElementById('merch-feature-shape').setAttribute('href', `#merch-${product.type}`);
  document.getElementById('merch-feature-logo').style.display = product.brand === 'invizible' ? '' : 'none';
  document.getElementById('merch-feature-maverick').toggleAttribute('hidden', product.brand === 'invizible');
  rack.hidden = true;
  merchFeatured.hidden = false;
  tellChat(product);
  back.focus({ preventScroll: true });
}));
document.getElementById('merch-chat').addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('merch-chat'));
});
