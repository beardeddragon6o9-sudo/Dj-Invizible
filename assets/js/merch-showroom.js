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
let stopFollowingMerch = () => {};

function followMerch() {
  stopFollowingMerch();
  const scroller = getComputedStyle(document.body).overflowY === 'auto' ? document.body : document.scrollingElement;
  const startY = scroller.scrollTop;
  // Use layout coordinates once so animation, sway, and browser toolbar changes
  // cannot move the destination back and forth while the viewport is travelling.
  const rackTop = merchSection.offsetTop;
  const rackHeight = merchSection.scrollHeight;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const inset = Math.max(0, Math.min(16, (viewportHeight - rackHeight) / 2));
  const remark = document.getElementById('merch-remark');
  let targetTop = rackTop;
  if (remark?.offsetHeight && rackTop + rackHeight - remark.offsetTop <= viewportHeight - 32) {
    targetTop = remark.offsetTop;
  }
  const targetY = Math.max(0, targetTop - inset);
  const started = performance.now();
  const entrance = merchSection.getAnimations().find(animation => animation.animationName === 'merchReelDown');
  const duration = entrance?.effect.getComputedTiming().duration || 650;
  const controls = new AbortController();
  let frame;
  stopFollowingMerch = () => {
    cancelAnimationFrame(frame);
    controls.abort();
  };
  // Let visitors take over as soon as they touch, scroll, or use the keyboard.
  for (const event of ['touchstart', 'pointerdown', 'wheel', 'keydown']) {
    window.addEventListener(event, stopFollowingMerch, { passive: true, signal: controls.signal });
  }
  function follow(now) {
    if (!stackedMerch.matches || !merchSection.classList.contains('is-open')) {
      stopFollowingMerch();
      return;
    }
    const progress = reducedMotion.matches ? 1 : Math.min(1, (now - started) / duration);
    const eased = progress * progress * (3 - 2 * progress);
    scroller.scrollTo({ top: startY + (targetY - startY) * eased, behavior: 'instant' });
    if (progress < 1) frame = requestAnimationFrame(follow);
    else stopFollowingMerch();
  }
  frame = requestAnimationFrame(follow);
}

function tellChat(product = null) {
  window.dispatchEvent(new CustomEvent('merch-selection', { detail: product }));
}
function setOpen(open) {
  stopFollowingMerch();
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
    if (stackedMerch.matches) followMerch();
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
  stopFollowingMerch();
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
