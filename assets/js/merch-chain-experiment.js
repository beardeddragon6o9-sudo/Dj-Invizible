// Experimental chain-drop storefront. Intentionally does not alter the original
// rack, checkout, existing mascot script, or either DJ's conversation history.
const chainTrigger = document.getElementById('merch-chain-trigger');
const chainOverlay = document.getElementById('merch-chain-experiment');
const chainPicked = document.getElementById('chain-picked');

const chainProducts = {
  'invizible-tee': {
    brand: 'invizible', name: 'Invizible Tee',
    kind: 'INVIZIBLE / T-SHIRT',
    description: 'A stripped-back Invizible wordmark on a dark everyday tee.'
  },
  'invizible-hoodie': {
    brand: 'invizible', name: 'Invizible Hoodie',
    kind: 'INVIZIBLE / HOODIE',
    description: 'The same understated logo on a deeper green, oversized hoodie concept.'
  },
  'maverick-tee': {
    brand: 'maverick', name: 'Maverick Tee',
    kind: 'MIDNITE MAVERICK / T-SHIRT',
    description: 'Dark western-inspired colours and a restrained Midnite Maverick chest print.'
  },
  'maverick-hoodie': {
    brand: 'maverick', name: 'Maverick Hoodie',
    kind: 'MIDNITE MAVERICK / HOODIE',
    description: 'A warm charcoal-brown hoodie with the Maverick identity front and centre.'
  }
};

if (chainTrigger && chainOverlay && chainPicked) {
  const closeButton = chainOverlay.querySelector('.merch-chain-close');
  const cards = Array.from(chainOverlay.querySelectorAll('[data-chain-product]'));
  const originalRackLink = document.getElementById('chain-original-rack');
  const title = document.getElementById('chain-picked-name');
  const kind = document.getElementById('chain-picked-kind');
  const description = document.getElementById('chain-picked-description');
  let previousFocus = null;

  function selectChainProduct(productId) {
    const product = chainProducts[productId];
    if (!product) return;

    cards.forEach(card => {
      card.setAttribute('aria-pressed', String(card.dataset.chainProduct === productId));
    });
    title.textContent = product.name;
    kind.textContent = product.kind;
    description.textContent = product.description;
    chainPicked.dataset.brand = product.brand;
  }

  function openChain() {
    if (!chainOverlay.hidden) return;
    previousFocus = document.activeElement;
    chainOverlay.hidden = false;
    chainOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('merch-chain-active');
    chainTrigger.setAttribute('aria-expanded', 'true');

    // Commit the off-screen starting frame before rolling the line in.
    void chainOverlay.offsetWidth;
    chainOverlay.classList.add('is-open');
    closeButton.focus({ preventScroll: true });
  }

  function closeChain(restoreFocus = true) {
    if (chainOverlay.hidden) return;
    chainOverlay.classList.remove('is-open');
    chainOverlay.hidden = true;
    chainOverlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('merch-chain-active');
    chainTrigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) (previousFocus || chainTrigger).focus({ preventScroll: true });
  }

  chainTrigger.setAttribute('aria-expanded', 'false');
  chainTrigger.addEventListener('click', openChain);

  chainOverlay.addEventListener('click', event => {
    if (event.target.closest('[data-chain-close]')) {
      closeChain();
      return;
    }
    const card = event.target.closest('[data-chain-product]');
    if (card && chainOverlay.contains(card)) selectChainProduct(card.dataset.chainProduct);
  });

  // The original scroll-down rack is deliberately preserved for comparison.
  originalRackLink?.addEventListener('click', () => closeChain(false));

  document.addEventListener('keydown', event => {
    if (chainOverlay.hidden) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeChain();
    }
    if (event.key !== 'Tab') return;
    const controls = [closeButton, ...cards, originalRackLink].filter(Boolean);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}
