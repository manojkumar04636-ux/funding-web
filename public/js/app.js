// State management
let products = [];
let settings = {};
let cart = [];

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadProducts();
  loadReviews();
  initCart();
  setupEventListeners();
});

// Load Global Settings from API
async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    settings = await response.json();
    
    // Update banner text if available
    const banner = document.getElementById('promo-banner');
    if (banner && settings.banner_text) {
      banner.textContent = settings.banner_text;
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Load Products from API
async function loadProducts() {
  try {
    const response = await fetch('/api/products');
    products = await response.json();
    renderProducts(products);
    renderCategoryChips();
  } catch (error) {
    console.error('Error loading products:', error);
    showToast('⚠️ Error loading products. Please try again.');
  }
}

// Load Reviews from API
async function loadReviews() {
  try {
    const response = await fetch('/api/reviews');
    const reviews = await response.json();
    renderReviews(reviews);
  } catch (error) {
    console.error('Error loading reviews:', error);
  }
}

// Setup Event Listeners
function setupEventListeners() {
  // Mobile Hamburger Toggle
  const hamburger = document.getElementById('hamburger-btn');
  const navLinks = document.getElementById('nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });
  }

  // FAQ Accordions
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    question.addEventListener('click', () => {
      // Toggle active status
      const isActive = item.classList.contains('active');
      faqItems.forEach(i => i.classList.remove('active'));
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });

  // Cart Button Click (Show Modal)
  const cartToggleButtons = document.querySelectorAll('.cart-toggle');
  const cartModal = document.getElementById('cart-modal');
  const backdrop = document.getElementById('modal-backdrop');
  
  cartToggleButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      cartModal.classList.add('open');
      backdrop.classList.add('open');
    });
  });

  // Close Cart Modal
  const cartClose = document.getElementById('cart-close');
  if (cartClose && cartModal && backdrop) {
    cartClose.addEventListener('click', () => {
      cartModal.classList.remove('open');
      backdrop.classList.remove('open');
    });
    backdrop.addEventListener('click', () => {
      cartModal.classList.remove('open');
      backdrop.classList.remove('open');
      document.getElementById('bundle-picker').classList.remove('open');
    });
  }

  // Submit Review Form
  const reviewForm = document.getElementById('review-submit-form');
  if (reviewForm) {
    reviewForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const customer_name = document.getElementById('review-name').value;
      const rating = document.getElementById('review-rating').value;
      const review_text = document.getElementById('review-text').value;

      try {
        const response = await fetch('/api/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customer_name, rating, review_text })
        });
        const result = await response.json();
        
        if (response.ok) {
          showToast('🎉 Review submitted! It will appear after admin approval.');
          reviewForm.reset();
        } else {
          showToast(`⚠️ ${result.error || 'Failed to submit review'}`);
        }
      } catch (err) {
        showToast('⚠️ Error connecting to server.');
      }
    });
  }

  // Checkout Button
  const checkoutBtn = document.getElementById('cart-checkout-btn');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => {
      if (cart.length === 0) {
        showToast('⚠️ Your cart is empty!');
        return;
      }
      localStorage.setItem('nexora_checkout_cart', JSON.stringify(cart));
      window.location.href = '/checkout.html';
    });
  }
}

// Render Products Grid
function renderProducts(items) {
  const reelsGrid = document.getElementById('reels-grid');
  const ebooksGrid = document.getElementById('ebooks-grid');
  const megaBundleGrid = document.getElementById('mega-bundle-container');

  if (reelsGrid) reelsGrid.innerHTML = '';
  if (ebooksGrid) ebooksGrid.innerHTML = '';
  if (megaBundleGrid) megaBundleGrid.innerHTML = '';

  items.forEach(p => {
    // 1. Mega Bundle Special Rendering
    if (p.slug === 'mega-bundle' && megaBundleGrid) {
      megaBundleGrid.innerHTML = `
        <div class="mega-bundle-card">
          <div class="best-value-badge">🔥 BEST VALUE</div>
          <h1 class="sec-title">${p.title}</h1>
          <p class="sec-sub">${p.description}</p>
          <div class="chips-container" id="mega-chips"></div>
          <div class="mega-price">
            <del>₹${p.original_price}</del>
            <ins>₹${p.price}</ins>
          </div>
          <div class="mega-ctas">
            <button class="btn-primary" onclick="addToCartBySlug('mega-bundle')">🚀 GET THE MEGA BUNDLE — ₹${p.price}</button>
            <button class="btn-whatsapp" onclick="orderOnWhatsApp('mega-bundle')">💬 ASK ABOUT MEGA BUNDLE</button>
          </div>
        </div>
      `;
      renderMegaChips();
      return;
    }

    // 2. Render Cards based on Category
    const cardHtml = `
      <div class="prod-card" data-slug="${p.slug}">
        <div class="prod-image-wrapper">
          <span class="prod-category-badge">${p.category}</span>
          ${getEmojiForProduct(p.slug)}
        </div>
        <div class="prod-info">
          <div class="prod-qty">${p.quantity_text || ''}</div>
          <h3 class="prod-title">${p.title}</h3>
          <p class="prod-desc">${p.description || ''}</p>
          <div class="prod-footer">
            <div class="prod-price">
              ₹${p.price}
              ${p.original_price ? `<del>₹${p.original_price}</del>` : ''}
            </div>
            <button class="btn-card-buy" onclick="addToCartBySlug('${p.slug}')" aria-label="Add to cart">🛒</button>
          </div>
        </div>
      </div>
    `;

    if (p.category === 'Reels' && reelsGrid) {
      reelsGrid.insertAdjacentHTML('beforeend', cardHtml);
    } else if (p.category === 'Ebooks' && ebooksGrid) {
      ebooksGrid.insertAdjacentHTML('beforeend', cardHtml);
    } else if (p.category === 'Packages' && reelsGrid) {
      // Creator Packages rendered on home in their own section but also fallback in Reels if needed.
      // We render creator packages inside the Packages Section instead.
    }
  });

  // Render Creator Packages in their section
  renderCreatorPackages();
}

function getEmojiForProduct(slug) {
  if (slug.includes('travel')) return '🌍';
  if (slug.includes('money')) return '💰';
  if (slug.includes('luxury')) return '💎';
  if (slug.includes('motivation')) return '🔥';
  if (slug.includes('ai-tech') || slug.includes('ai-business')) return '🤖';
  if (slug.includes('fitness') || slug.includes('gym')) return '💪';
  if (slug.includes('nature')) return '🌿';
  if (slug.includes('art')) return '🎨';
  if (slug.includes('cars')) return '🚗';
  if (slug.includes('cartoon') || slug.includes('funny')) return '😂';
  if (slug.includes('animation')) return '🎬';
  if (slug.includes('wood')) return '🪵';
  if (slug.includes('tools')) return '🛠️';
  if (slug.includes('tips')) return '💡';
  if (slug.includes('satisfying')) return '😍';
  if (slug.includes('gadget')) return '📱';
  if (slug.includes('emotional')) return '❤️';
  if (slug.includes('doctor')) return '🩺';
  if (slug.includes('superhero')) return '🦸';
  if (slug.includes('lofi')) return '🎵';
  if (slug.includes('study')) return '📚';
  if (slug.includes('chatgpt')) return '📕';
  if (slug.includes('canva')) return '📘';
  if (slug.includes('faceless')) return '📗';
  if (slug.includes('planner')) return '📅';
  return '📦';
}

// Render Category Chips on Mega Bundle
function renderMegaChips() {
  const chips = [
    "🌍 Travel", "💰 Money", "🔥 Motivation", "💎 Luxury", "🤖 AI Tech", 
    "💪 Fitness", "🚗 Cars", "🌿 Nature", "🎨 Art & Craft", "😂 Funny", 
    "📱 Gadgets", "🎬 Animation", "🏋️ Gym", "💡 Tips & Tricks", "❤️ Emotional"
  ];
  const container = document.getElementById('mega-chips');
  if (container) {
    container.innerHTML = chips.map(c => `<span class="category-chip">${c}</span>`).join('');
  }
}

// Render dynamic category selector chips list
function renderCategoryChips() {
  const categories = ["All", "Reels", "Ebooks", "Packages"];
  const slider = document.getElementById('category-slider');
  if (slider) {
    slider.innerHTML = categories.map(cat => `
      <div class="category-slider-card ${cat === 'All' ? 'active' : ''}" onclick="filterByCategory('${cat}', this)">
        ${cat === 'Reels' ? '🎬 Reels' : cat === 'Ebooks' ? '📚 Ebooks' : cat === 'Packages' ? '🎁 Packages' : '🌈 All Products'}
      </div>
    `).join('');
  }
}

// Filter products based on selected category chip
function filterByCategory(category, element) {
  // Toggle active class in slider
  document.querySelectorAll('.category-slider-card').forEach(c => c.classList.remove('active'));
  element.classList.add('active');

  const filtered = category === 'All' 
    ? products 
    : products.filter(p => p.category === category);
  
  // Re-render grids
  const reelsGrid = document.getElementById('reels-grid');
  if (reelsGrid) {
    reelsGrid.innerHTML = '';
    const reelsItems = filtered.filter(p => p.category === 'Reels');
    reelsItems.forEach(p => {
      reelsGrid.insertAdjacentHTML('beforeend', `
        <div class="prod-card" data-slug="${p.slug}">
          <div class="prod-image-wrapper">
            <span class="prod-category-badge">${p.category}</span>
            ${getEmojiForProduct(p.slug)}
          </div>
          <div class="prod-info">
            <div class="prod-qty">${p.quantity_text || ''}</div>
            <h3 class="prod-title">${p.title}</h3>
            <p class="prod-desc">${p.description || ''}</p>
            <div class="prod-footer">
              <div class="prod-price">
                ₹${p.price}
                ${p.original_price ? `<del>₹${p.original_price}</del>` : ''}
              </div>
              <button class="btn-card-buy" onclick="addToCartBySlug('${p.slug}')">🛒</button>
            </div>
          </div>
        </div>
      `);
    });
  }
}

// Render Creator Packages in their dedicated container
function renderCreatorPackages() {
  const container = document.getElementById('packages-container');
  if (!container) return;

  const starter = products.find(p => p.slug === 'starter-pack');
  const creator = products.find(p => p.slug === 'creator-pack');
  const mega = products.find(p => p.slug === 'mega-bundle');

  if (!starter || !creator || !mega) return;

  container.innerHTML = `
    <!-- STARTER PACK -->
    <div class="pkg-card">
      <div class="pkg-icon">🌱</div>
      <h3 class="pkg-title">${starter.title}</h3>
      <div class="pkg-price">₹${starter.price}</div>
      <ul class="pkg-features">
        <li>Any 3 Selected Reels Bundles</li>
        <li>Full 4K High Quality Clips</li>
        <li>Instant Download Access</li>
        <li>Personal Use License</li>
      </ul>
      <button class="btn-pkg" onclick="openBundlePicker('starter-pack', 3)">GET STARTER</button>
    </div>

    <!-- CREATOR PACK -->
    <div class="pkg-card popular">
      <div class="pkg-badge">MOST POPULAR ⭐</div>
      <div class="pkg-icon">🚀</div>
      <h3 class="pkg-title">${creator.title}</h3>
      <div class="pkg-price">₹${creator.price}</div>
      <ul class="pkg-features">
        <li>Any 8 Selected Reels Bundles</li>
        <li>Faceless Creator Resources</li>
        <li>Full Lifetime Updates</li>
        <li>Standard Creator License</li>
      </ul>
      <button class="btn-pkg" onclick="openBundlePicker('creator-pack', 8)">GET CREATOR PACK</button>
    </div>

    <!-- MEGA PACK -->
    <div class="pkg-card">
      <div class="pkg-icon">🎉</div>
      <h3 class="pkg-title">🎉 MEGA PACK</h3>
      <div class="pkg-price">₹${mega.price}</div>
      <ul class="pkg-features">
        <li>150K+ Reels Mega Bundle</li>
        <li>ALL 30+ Creator Niches</li>
        <li>Premium Faceless Ebooks</li>
        <li>Commercial Resell Rights</li>
      </ul>
      <button class="btn-pkg" onclick="addToCartBySlug('mega-bundle')">🔥 GET MEGA — ₹${mega.price}</button>
    </div>
  `;
}

// Custom Picker Modal for Starter Pack (3) and Creator Pack (8)
let activePackageSlug = '';
let activePackageLimit = 0;
let tempSelectedBundles = [];

function openBundlePicker(slug, limit) {
  activePackageSlug = slug;
  activePackageLimit = limit;
  tempSelectedBundles = [];

  const modal = document.getElementById('bundle-picker');
  const backdrop = document.getElementById('modal-backdrop');
  const body = document.getElementById('bundle-picker-list');
  const limitText = document.getElementById('picker-limit-text');

  if (!modal || !body) return;

  limitText.textContent = `Select exactly ${limit} bundles:`;

  // Get only individual Reels bundles
  const reelsList = products.filter(p => p.category === 'Reels' && p.slug !== 'mega-bundle');

  body.innerHTML = reelsList.map(r => `
    <div class="bundle-picker-item" data-slug="${r.slug}" onclick="togglePickerSelection('${r.slug}', this)">
      <span>${r.title}</span>
    </div>
  `).join('');

  modal.classList.add('open');
  backdrop.classList.add('open');
}

function togglePickerSelection(slug, element) {
  const index = tempSelectedBundles.indexOf(slug);
  if (index > -1) {
    // Already selected, remove it
    tempSelectedBundles.splice(index, 1);
    element.classList.remove('selected');
  } else {
    // Add it if limit not reached
    if (tempSelectedBundles.length >= activePackageLimit) {
      showToast(`⚠️ You can only select up to ${activePackageLimit} bundles.`);
      return;
    }
    tempSelectedBundles.push(slug);
    element.classList.add('selected');
  }

  // Update counter
  document.getElementById('picker-count-text').textContent = `${tempSelectedBundles.length} / ${activePackageLimit} Selected`;
}

function confirmBundleSelection() {
  if (tempSelectedBundles.length !== activePackageLimit) {
    showToast(`⚠️ Please select exactly ${activePackageLimit} bundles before adding to cart.`);
    return;
  }

  // Add to cart with selections
  const productObj = products.find(p => p.slug === activePackageSlug);
  if (productObj) {
    const cartItem = {
      ...productObj,
      quantity: 1,
      selection: [...tempSelectedBundles]
    };
    
    // Check if item already in cart
    const existingIndex = cart.findIndex(item => item.slug === activePackageSlug);
    if (existingIndex > -1) {
      cart[existingIndex] = cartItem; // Overwrite
    } else {
      cart.push(cartItem);
    }

    saveCart();
    updateCartUI();
    closeBundlePicker();
    showToast(`🎉 Added ${productObj.title} to cart!`);
    
    // Open Cart Modal automatically
    document.getElementById('cart-modal').classList.add('open');
    document.getElementById('modal-backdrop').classList.add('open');
  }
}

function closeBundlePicker() {
  document.getElementById('bundle-picker').classList.remove('open');
  document.getElementById('modal-backdrop').classList.remove('open');
}

// Render Reviews List
function renderReviews(reviews) {
  const container = document.getElementById('reviews-container');
  if (!container) return;

  if (reviews.length === 0) {
    container.innerHTML = `<p style="text-align: center; color: #64748B;">No verified reviews yet. Be the first to write one below!</p>`;
    return;
  }

  container.innerHTML = reviews.map(r => `
    <div class="review-card">
      <div class="review-rating">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>
      <p class="review-text">"${r.review_text}"</p>
      <div class="review-author">${r.customer_name} <span style="font-weight: normal; font-size: 0.8rem; color: #94A3B8; margin-left: 0.5rem;">${r.date}</span></div>
    </div>
  `).join('');
}

// CART ENGINE
function initCart() {
  const savedCart = localStorage.getItem('nexora_cart');
  if (savedCart) {
    try {
      cart = JSON.parse(savedCart);
    } catch (e) {
      cart = [];
    }
  }
  updateCartUI();
}

function saveCart() {
  localStorage.setItem('nexora_cart', JSON.stringify(cart));
}

function addToCartBySlug(slug) {
  const productObj = products.find(p => p.slug === slug);
  if (!productObj) return;

  // Starter & Creator pack must open the selector modal instead
  if (slug === 'starter-pack') {
    openBundlePicker('starter-pack', 3);
    return;
  }
  if (slug === 'creator-pack') {
    openBundlePicker('creator-pack', 8);
    return;
  }

  const existingIndex = cart.findIndex(item => item.slug === slug);
  if (existingIndex > -1) {
    cart[existingIndex].quantity += 1;
  } else {
    cart.push({
      ...productObj,
      quantity: 1,
      selection: []
    });
  }

  saveCart();
  updateCartUI();
  showToast(`🎉 Added ${productObj.title} to cart!`);
}

function removeFromCart(slug) {
  cart = cart.filter(item => item.slug !== slug);
  saveCart();
  updateCartUI();
}

function updateCartUI() {
  const countBadges = document.querySelectorAll('.cart-count');
  const cartList = document.getElementById('cart-items-list');
  const cartTotal = document.getElementById('cart-total');

  let totalItems = 0;
  let totalPrice = 0;

  if (cartList) cartList.innerHTML = '';

  cart.forEach(item => {
    totalItems += item.quantity;
    totalPrice += item.price * item.quantity;

    if (cartList) {
      const selectionText = item.selection && item.selection.length > 0
        ? `<div style="font-size: 0.75rem; color:#64748B;">Selection: ${item.selection.join(', ')}</div>`
        : '';

      cartList.insertAdjacentHTML('beforeend', `
        <div class="cart-item">
          <div class="cart-item-info">
            <div class="cart-item-title">${item.title}</div>
            ${selectionText}
            <div class="cart-item-price">₹${item.price} x ${item.quantity}</div>
          </div>
          <button class="cart-item-remove" onclick="removeFromCart('${item.slug}')">🗑️</button>
        </div>
      `);
    }
  });

  countBadges.forEach(badge => {
    badge.textContent = totalItems;
  });

  if (cartTotal) {
    cartTotal.textContent = `₹${totalPrice}`;
  }
}

// Pre-filled WhatsApp message redirects
function orderOnWhatsApp(slug) {
  const wpNumber = settings.whatsapp_number || '979414912';

  if (slug === 'mega-bundle') {
    const text = encodeURIComponent(
      `Hello! 🔥 I am interested in the NEXORA 150K+ Reels Mega Bundle.\n\n` +
      `📦 Bundle: 150K+ Reels Mega Bundle\n` +
      `🎬 Content: 150K+ Reels\n` +
      `🌈 Categories: Travel, Money, Motivation, Luxury, AI, Fitness, Cars, Nature, Gadgets, Animation and many more.\n` +
      `💰 Price: ₹999\n` +
      `💳 UPI: 9794142912@fam\n\n` +
      `Please send me the complete details and payment instructions.`
    );
    window.open(`https://wa.me/91${wpNumber}?text=${text}`, '_blank');
    return;
  }

  const p = products.find(prod => prod.slug === slug);
  if (!p) return;

  const text = encodeURIComponent(
    `Hello! 👋 I am interested in a NEXORA bundle.\n\n` +
    `📦 Bundle: ${p.title}\n` +
    `🎬 Reels: ${p.quantity_text || 'Multiple'}\n` +
    `📂 Category: ${p.category}\n` +
    `💰 Price: ₹${p.price}\n\n` +
    `Please send me the complete bundle details and payment instructions. Thank you! 😊`
  );
  window.open(`https://wa.me/91${wpNumber}?text=${text}`, '_blank');
}

// Toast message utility
function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}
