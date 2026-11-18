// Hanging stage display; product concepts are not an inventory or checkout.
const merchSection = document.getElementById('merch');
const merchFeatured = document.getElementById('merch-featured');
const merchConcepts = {
  'invizible-tee': {
    brand: 'invizible',
    name: 'Invizible Tee',
    description: 'Washed charcoal with a diagonal Invizible chest wordmark and a mask that breaks into vinyl grooves on the back.',
    photos: 'invizible-vinyl-tee',
    initialView: 'front'
  },
  'invizible-hoodie': {
    brand: 'invizible',
    name: 'Invizible Hoodie',
    description: 'Forest-green hoodie with a small chest wordmark and a silver-and-sage mask with angular brows and a halftone fade on the back.',
    photos: 'invizible-silver-mask-hoodie',
    initialView: 'back'
  },
  'invizible-longsleeve': {
    brand: 'invizible',
    name: 'Invizible Long Sleeve',
    description: 'White long sleeve with a black vinyl back print, a small chest wordmark, and half-faded dancers up the right sleeve.',
    photos: 'invizible-record-longsleeve',
    initialView: 'back'
  },
  'maverick-hoodie': {
    brand: 'maverick', type: 'hoodie',
    name: 'Maverick Hoodie',
    description: 'A warm charcoal-brown hoodie with the Maverick identity front and centre.'
  }
};


const toggle = document.getElementById('merch-toggle');
const cards = [...merchSection.querySelectorAll('.merch-item')];
const back = document.getElementById('merch-back');
const photo = document.getElementById('merch-feature-photo');
const garment = merchFeatured.querySelector('.merch-feature-garment');
const garmentShape = document.getElementById('merch-feature-shape');
const garmentPrint = document.getElementById('merch-feature-maverick');
const viewButtons = [...document.querySelectorAll('#merch-views button[data-view]')];
let selectedCard = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const stackedMerch = window.matchMedia('(max-width: 1499px)');
function tellChat(product = null) {
  window.dispatchEvent(new CustomEvent('merch-selection', { detail: product }));
}
function setOpen(open) {
  if (!open) {
    toggle.focus({ preventScroll: true });
    tellChat();
  }
  document.body.classList.toggle('merch-open', open);
  merchSection.classList.toggle('is-open', open);
  merchSection.inert = !open;
  merchSection.setAttribute('aria-hidden', String(!open));
  toggle.setAttribute('aria-expanded', String(open));
  window.dispatchEvent(new CustomEvent('booth-merch', { detail: { open } }));
  if (open) {
    window.dispatchEvent(new CustomEvent('merch-open', { detail: { stacked: stackedMerch.matches } }));
    cards[0].focus({ preventScroll: true });
    if (stackedMerch.matches) {
      const remark = document.getElementById('merch-remark');
      const scrollTarget = remark?.hasChildNodes() ? remark : merchSection;
      scrollTarget.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
    }
  }
}
toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
document.getElementById('merch-close').addEventListener('click', () => setOpen(false));
back.addEventListener('click', () => merchFeatured.close());
function showView(product, side) {
  const label = `${product.name}, ${side} view`;
  if (product.photos) {
    photo.src = `assets/images/merch/${product.photos}-${side}.webp`;
    photo.alt = label;
  } else {
    const suffix = side === 'back' ? '-back' : '';
    garmentShape.setAttribute('href', `#merch-${product.type}${suffix}`);
    garment.setAttribute('aria-label', label);
    garmentPrint.toggleAttribute('hidden', side === 'back');
  }
  for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === side));
}
for (const button of viewButtons) {
  button.addEventListener('click', () => {
    const product = merchConcepts[selectedCard?.dataset.merchId];
    if (product) showView(product, button.dataset.view);
  });
}
merchSection.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  setOpen(false);
});
cards.forEach(card => card.addEventListener('click', () => {
  const product = merchConcepts[card.dataset.merchId];
  selectedCard = card;
  merchFeatured.dataset.brand = product.brand;
  merchFeatured.dataset.merchId = card.dataset.merchId;
  document.getElementById('merch-feature-name').textContent = product.name;
  document.getElementById('merch-feature-description').textContent = product.description;
  photo.hidden = !product.photos;
  garment.toggleAttribute('hidden', Boolean(product.photos));
  showView(product, product.initialView ?? 'front');
  merchFeatured.returnValue = '';
  merchFeatured.showModal();
  merchFeatured.scrollTop = 0;
  tellChat(product);
}));

document.getElementById('merch-chat').addEventListener('click', () => merchFeatured.close('chat'));
merchFeatured.addEventListener('close', () => {
  const trigger = selectedCard;
  selectedCard = null;
  if (merchFeatured.returnValue === 'chat') {
    window.dispatchEvent(new CustomEvent('merch-chat', { detail: { trigger } }));
  } else {
    trigger?.focus({ preventScroll: true });
    tellChat();
  }
});
