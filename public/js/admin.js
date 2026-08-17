// Dashboard State
let adminOrders = [];
let adminProducts = [];
let activeTab = 'analytics';

document.addEventListener('DOMContentLoaded', () => {
  checkAdminAuth();
});

// Check if authenticated
async function checkAdminAuth() {
  try {
    const response = await fetch('/api/admin/status');
    const result = await response.json();
    
    if (result.loggedIn) {
      document.getElementById('admin-username').textContent = result.user;
      document.getElementById('admin-body').style.display = 'block';
      loadDashboardData();
    } else {
      window.location.href = '/admin/index.html';
    }
  } catch (err) {
    window.location.href = '/admin/index.html';
  }
}

// Load Tab Data depending on Tab Switch
function switchTab(tabName) {
  activeTab = tabName;
  
  // Update sidebar active classes
  document.querySelectorAll('.menu-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // Find clicked item and set active
  const menuItems = Array.from(document.querySelectorAll('.menu-item'));
  const clickedItem = menuItems.find(item => item.textContent.toLowerCase().includes(tabName.toLowerCase()));
  if (clickedItem) clickedItem.classList.add('active');

  // Switch content panels
  document.querySelectorAll('.admin-tab').forEach(panel => {
    panel.classList.remove('active');
  });
  document.getElementById(`tab-${tabName}`).classList.add('active');

  // Trigger reload of specific tab data
  if (tabName === 'analytics') loadAnalytics();
  if (tabName === 'orders') loadOrders();
  if (tabName === 'products') loadProducts();
  if (tabName === 'settings') loadSettings();
  if (tabName === 'reviews') loadReviews();
  if (tabName === 'logs') loadLogs();
}

// Load all required data initially
async function loadDashboardData() {
  await loadProducts(); // Load products list first
  loadAnalytics();
  loadOrders(); // Load orders count for pending badge
  setupFormListeners();
}

// 1. ANALYTICS MANAGEMENT
async function loadAnalytics() {
  try {
    const response = await fetch('/api/admin/analytics');
    const data = await response.json();

    document.getElementById('stat-revenue').textContent = `₹${data.revenue}`;
    document.getElementById('stat-orders-count').textContent = data.paidOrdersCount;
    document.getElementById('stat-pending-count').textContent = data.pendingOrdersCount;

    // Update pending badge in menu
    const badge = document.getElementById('pending-badge');
    if (badge) {
      if (data.pendingOrdersCount > 0) {
        badge.style.display = 'inline-block';
        badge.textContent = data.pendingOrdersCount;
      } else {
        badge.style.display = 'none';
      }
    }

    // Render popular bundles list
    const popularContainer = document.getElementById('popular-bundles-list');
    popularContainer.innerHTML = '';
    if (data.popularBundles && data.popularBundles.length > 0) {
      data.popularBundles.forEach(b => {
        popularContainer.insertAdjacentHTML('beforeend', `
          <div style="display:flex; justify-content:space-between; padding:0.6rem 0; border-bottom:1px solid rgba(139,92,246,0.06); font-weight:600;">
            <span>${b.title}</span>
            <span style="color:var(--purple); font-weight:800;">${b.sales} sold</span>
          </div>
        `);
      });
    } else {
      popularContainer.innerHTML = `<p style="color:#64748B; font-size:0.9rem;">No data available yet.</p>`;
    }
  } catch (err) {
    console.error('Error loading analytics:', err);
  }
}

// 2. ORDERS MANAGEMENT
async function loadOrders() {
  try {
    const response = await fetch('/api/admin/orders');
    adminOrders = await response.json();

    // Populate recent orders in analytics view
    const recentTable = document.getElementById('recent-orders-list');
    if (recentTable) {
      recentTable.innerHTML = '';
      adminOrders.slice(0, 5).forEach(o => {
        recentTable.insertAdjacentHTML('beforeend', `
          <tr>
            <td><strong>${o.id}</strong></td>
            <td>${o.created_at.split(' ')[0]}</td>
            <td>₹${o.total_amount}</td>
            <td><span class="status-pill status-${o.payment_status.toLowerCase()}">${o.payment_status}</span></td>
          </tr>
        `);
      });
    }

    // Populate full order manager list
    renderOrdersList(adminOrders);
  } catch (err) {
    console.error('Error loading orders:', err);
  }
}

function renderOrdersList(orders) {
  const container = document.getElementById('all-orders-list');
  if (!container) return;
  
  container.innerHTML = '';

  if (orders.length === 0) {
    container.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:2rem; color:#64748B;">No orders found.</td></tr>`;
    return;
  }

  orders.forEach(o => {
    const itemsHtml = o.items.map(i => {
      const selections = i.selection && i.selection.length > 0 
        ? `<div style="font-size:0.75rem; color:#94A3B8; margin-top:2px;">Selections: ${i.selection.join(', ')}</div>` 
        : '';
      return `<div style="font-weight:700; font-size:0.88rem; margin-bottom:4px;">${i.title} (x${i.quantity})${selections}</div>`;
    }).join('');

    // Map download statuses of products in this order
    let downloadStatusHtml = '';
    if (o.payment_status !== 'PAID') {
      downloadStatusHtml = `<span style="font-size:0.8rem; color:#64748B; font-weight:700;">N/A (Unpaid)</span>`;
    } else if (o.download_revoked === 1) {
      downloadStatusHtml = `<span class="status-pill status-failed" style="background:#FEE2E2; color:#EF4444; font-weight:700;">🛑 REVOKED</span>`;
    } else {
      const statuses = o.items.map(item => {
        const prod = adminProducts.find(p => p.slug === item.slug);
        const status = prod ? prod.download_status : 'NOT CONFIGURED';
        return `${item.title}: <strong>${status}</strong>`;
      });
      downloadStatusHtml = `<div style="font-size:0.8rem; line-height:1.3;">${statuses.join('<br>')}</div>`;
    }

    let actionButtons = `<div style="display:flex; flex-direction:column; gap:0.4rem;">`;
    
    // VIEW ORDER button
    actionButtons += `<button class="btn-secondary" onclick="viewOrderDetails('${o.id}')" style="padding:0.3rem 0.6rem; font-size:0.75rem; border-color:var(--purple); color:var(--purple); box-shadow:none;">View Order 👁️</button>`;

    // Approve/Reject payment verification
    if (o.payment_status === 'PAYMENT_SUBMITTED' || o.payment_status === 'PENDING' || o.payment_status === 'VERIFYING') {
      actionButtons += `
        <div style="display:flex; gap:0.3rem;">
          <button class="btn-primary" onclick="updateOrderStatus('${o.id}', 'PAID')" style="padding:0.3rem 0.6rem; font-size:0.75rem; background:var(--green); box-shadow:none;">Approve ✅</button>
          <button class="btn-secondary" onclick="updateOrderStatus('${o.id}', 'FAILED')" style="padding:0.3rem 0.6rem; font-size:0.75rem; border-color:#EF4444; color:#EF4444; box-shadow:none;">Reject ❌</button>
        </div>
      `;
    }

    // Revoke / Restore downloads
    if (o.payment_status === 'PAID') {
      if (o.download_revoked === 1) {
        actionButtons += `<button class="btn-primary" onclick="restoreDownload('${o.id}')" style="padding:0.3rem 0.6rem; font-size:0.75rem; background:var(--green); box-shadow:none;">Restore Download 🟢</button>`;
      } else {
        actionButtons += `<button class="btn-secondary" onclick="revokeDownload('${o.id}')" style="padding:0.3rem 0.6rem; font-size:0.75rem; border-color:#EF4444; color:#EF4444; box-shadow:none;">Revoke Download 🛑</button>`;
      }
    }

    actionButtons += `</div>`;

    container.insertAdjacentHTML('beforeend', `
      <tr>
        <td><strong>${o.id}</strong></td>
        <td>
          <div style="font-weight:800;">${o.customer_name}</div>
          <div style="font-size:0.8rem; color:#64748B;">${o.customer_email}</div>
          <div style="font-size:0.8rem; color:#64748B;">${o.customer_phone}</div>
        </td>
        <td>${itemsHtml}</td>
        <td style="font-weight:800; color:var(--purple);">₹${o.total_amount}</td>
        <td><code style="background:#F1F5F9; padding:0.2rem 0.4rem; border-radius:4px; font-weight:bold; font-size:0.9rem;">${o.utr || 'N/A'}</code></td>
        <td><span class="status-pill status-${o.payment_status.toLowerCase()}">${o.payment_status}</span></td>
        <td>${downloadStatusHtml}</td>
        <td style="font-size:0.8rem; color:#64748B; white-space:nowrap;">${o.created_at}</td>
        <td>${actionButtons}</td>
      </tr>
    `);
  });
}

function filterOrdersTable() {
  const query = document.getElementById('order-search').value.toLowerCase().trim();
  if (!query) {
    renderOrdersList(adminOrders);
    return;
  }

  const filtered = adminOrders.filter(o => 
    o.id.toLowerCase().includes(query) || 
    (o.utr && o.utr.toLowerCase().includes(query)) || 
    o.customer_name.toLowerCase().includes(query) ||
    o.customer_phone.includes(query)
  );
  renderOrdersList(filtered);
}

async function updateOrderStatus(orderId, status) {
  if (!confirm(`Are you sure you want to change order ${orderId} status to ${status}?`)) {
    return;
  }

  try {
    const response = await fetch(`/api/orders/${orderId}`);
    const order = await response.json();

    const responseStatus = await fetch(`/api/admin/orders/${orderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    
    const result = await responseStatus.json();
    if (responseStatus.ok) {
      showToast(`🎉 Order status updated to ${status}!`);
      loadOrders();
      loadAnalytics();
      
      // Auto-trigger WhatsApp message instruction to custom support alert or user if needed
      // (Optionally can send message dynamically if user phone provided)
    } else {
      showToast(`⚠️ ${result.error || 'Failed to update order status'}`);
    }
  } catch (err) {
    showToast('⚠️ Error connecting to server.');
  }
}

// 3. PRODUCTS MANAGEMENT
async function loadProducts() {
  try {
    const response = await fetch('/api/products');
    adminProducts = await response.json();

    const container = document.getElementById('admin-products-list');
    container.innerHTML = '';

    adminProducts.forEach(p => {
      container.insertAdjacentHTML('beforeend', `
        <tr>
          <td><code>${p.slug}</code></td>
          <td><strong>${p.title}</strong></td>
          <td><span class="status-pill" style="background:#F1F5F9; color:var(--dark-text); font-weight:700;">${p.category}</span></td>
          <td>${p.quantity_text || 'N/A'}</td>
          <td style="font-weight:800;">₹${p.price}</td>
          <td>
            <div style="display:flex; gap:0.5rem;">
              <button class="btn-primary" onclick="openProductModal('edit', ${p.id})" style="padding:0.4rem 0.8rem; font-size:0.8rem; background:var(--blue); box-shadow:none;">Edit ✏️</button>
              <button class="btn-secondary" onclick="deleteProduct(${p.id})" style="padding:0.4rem 0.8rem; font-size:0.8rem; border-color:#EF4444; color:#EF4444;">Delete 🗑️</button>
            </div>
          </td>
        </tr>
      `);
    });
  } catch (err) {
    console.error('Error loading products:', err);
  }
}

// Open Product Form modal for Add / Edit
function openProductModal(mode, productId = null) {
  const modal = document.getElementById('product-modal');
  const backdrop = document.getElementById('modal-backdrop');
  const title = document.getElementById('product-modal-title');
  const form = document.getElementById('product-crud-form');
  
  form.reset();
  document.getElementById('crud-id').value = '';
  document.getElementById('crud-file-display').textContent = '';

  if (mode === 'add') {
    title.textContent = '🛍️ Add New Product';
    document.getElementById('crud-drive-url').value = '';
    document.getElementById('crud-download-status').value = 'NOT CONFIGURED';
    document.getElementById('crud-drive-file-id').value = '';
    document.getElementById('crud-drive-folder-id').value = '';
    document.getElementById('test-link-result').textContent = '';
  } else {
    title.textContent = '✏️ Edit Product Details';
    const prod = adminProducts.find(p => p.id === productId);
    if (prod) {
      document.getElementById('crud-id').value = prod.id;
      document.getElementById('crud-slug').value = prod.slug;
      document.getElementById('crud-title').value = prod.title;
      document.getElementById('crud-desc').value = prod.description || '';
      document.getElementById('crud-price').value = prod.price;
      document.getElementById('crud-orig-price').value = prod.original_price || '';
      document.getElementById('crud-qty').value = prod.quantity_text || '';
      document.getElementById('crud-category').value = prod.category;
      document.getElementById('crud-license').value = prod.license || '';
      document.getElementById('crud-sort').value = prod.sort_order || 0;
      document.getElementById('crud-img').value = prod.image_url || '';
      document.getElementById('crud-file-display').textContent = prod.file_path ? `Current file: ${prod.file_path}` : 'No file uploaded';
      document.getElementById('crud-drive-url').value = prod.google_drive_url || '';
      document.getElementById('crud-download-status').value = prod.download_status || 'NOT CONFIGURED';
      document.getElementById('crud-drive-file-id').value = prod.google_drive_file_id || '';
      document.getElementById('crud-drive-folder-id').value = prod.google_drive_folder_id || '';
      document.getElementById('test-link-result').textContent = '';
    }
  }

  modal.style.display = 'block';
  backdrop.classList.add('open');
}

function closeProductModal() {
  document.getElementById('product-modal').style.display = 'none';
  document.getElementById('modal-backdrop').classList.remove('open');
}

async function deleteProduct(productId) {
  if (!confirm('Are you sure you want to delete this product? This action cannot be undone.')) {
    return;
  }

  try {
    const response = await fetch(`/api/admin/products/${productId}`, {
      method: 'DELETE'
    });
    const result = await response.json();
    if (response.ok) {
      showToast('🎉 Product deleted successfully!');
      loadProducts();
    } else {
      showToast(`⚠️ ${result.error || 'Failed to delete product'}`);
    }
  } catch (err) {
    showToast('⚠️ Error connecting to server.');
  }
}

// 4. SETTINGS CONFIG
async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    const settings = await response.json();

    document.getElementById('set-upi-id').value = settings.upi_id || '';
    document.getElementById('set-wa-num').value = settings.whatsapp_number || '';
    document.getElementById('set-banner').value = settings.banner_text || '';
    document.getElementById('set-discount').value = settings.offers_discount_percentage || 0;
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

// 5. REVIEWS APPROVALS
async function loadReviews() {
  try {
    const response = await fetch('/api/admin/reviews');
    const reviews = await response.json();

    const container = document.getElementById('admin-reviews-list');
    container.innerHTML = '';

    if (reviews.length === 0) {
      container.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:#64748B;">No customer reviews submitted.</td></tr>`;
      return;
    }

    reviews.forEach(r => {
      let actionButtons = '';
      if (r.status === 'PENDING') {
        actionButtons = `
          <div style="display:flex; gap:0.5rem;">
            <button class="btn-primary" onclick="updateReviewStatus(${r.id}, 'APPROVED')" style="padding:0.4rem 0.8rem; font-size:0.8rem; background:var(--green); box-shadow:none;">Approve ✅</button>
            <button class="btn-secondary" onclick="updateReviewStatus(${r.id}, 'REJECTED')" style="padding:0.4rem 0.8rem; font-size:0.8rem; border-color:#EF4444; color:#EF4444;">Reject ❌</button>
          </div>
        `;
      } else {
        actionButtons = `<span style="font-size:0.8rem; color:#94A3B8; font-weight:700;">Handled</span>`;
      }

      container.insertAdjacentHTML('beforeend', `
        <tr>
          <td><strong>${r.customer_name}</strong></td>
          <td>${'★'.repeat(r.rating)}</td>
          <td><p style="max-width:300px; font-size:0.88rem; font-style:italic;">"${r.review_text}"</p></td>
          <td>${r.date}</td>
          <td><span class="status-pill status-${r.status.toLowerCase()}">${r.status}</span></td>
          <td>${actionButtons}</td>
        </tr>
      `);
    });
  } catch (err) {
    console.error('Error loading reviews:', err);
  }
}

async function updateReviewStatus(reviewId, status) {
  try {
    const response = await fetch(`/api/admin/reviews/${reviewId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    
    const result = await response.json();
    if (response.ok) {
      showToast(`🎉 Review marked as ${status}!`);
      loadReviews();
    } else {
      showToast(`⚠️ ${result.error || 'Failed to update review'}`);
    }
  } catch (err) {
    showToast('⚠️ Error connecting to server.');
  }
}

// 6. SETUP FORM LISTENERS
function setupFormListeners() {
  // Save global settings
  const settingsForm = document.getElementById('admin-settings-form');
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const upi_id = document.getElementById('set-upi-id').value;
    const whatsapp_number = document.getElementById('set-wa-num').value;
    const banner_text = document.getElementById('set-banner').value;
    const offers_discount_percentage = document.getElementById('set-discount').value;

    try {
      const response = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upi_id, whatsapp_number, banner_text, offers_discount_percentage })
      });
      const result = await response.json();
      if (response.ok) {
        showToast('🎉 Store configurations saved successfully!');
      } else {
        showToast(`⚠️ ${result.error || 'Failed to save settings'}`);
      }
    } catch (err) {
      showToast('⚠️ Error saving settings.');
    }
  });

  // Change Admin Password
  const passwordForm = document.getElementById('admin-password-form');
  passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('cur-pass').value;
    const newPassword = document.getElementById('new-pass').value;

    try {
      const response = await fetch('/api/admin/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const result = await response.json();
      if (response.ok) {
        showToast('🎉 Admin password changed successfully!');
        passwordForm.reset();
      } else {
        showToast(`⚠️ ${result.error || 'Failed to update password'}`);
      }
    } catch (err) {
      showToast('⚠️ Error updating password.');
    }
  });

  // Product CRUD Form submit handler (Multi-part form data)
  const productForm = document.getElementById('product-crud-form');
  productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const prodId = document.getElementById('crud-id').value;
    const slug = document.getElementById('crud-slug').value;
    const title = document.getElementById('crud-title').value;
    const description = document.getElementById('crud-desc').value;
    const price = document.getElementById('crud-price').value;
    const original_price = document.getElementById('crud-orig-price').value;
    const quantity_text = document.getElementById('crud-qty').value;
    const category = document.getElementById('crud-category').value;
    const license = document.getElementById('crud-license').value;
    const sort_order = document.getElementById('crud-sort').value;
    const image_url = document.getElementById('crud-img').value;
    const fileField = document.getElementById('crud-file-upload');

    const google_drive_url = document.getElementById('crud-drive-url').value;
    const download_status = document.getElementById('crud-download-status').value;
    const google_drive_file_id = document.getElementById('crud-drive-file-id').value;
    const google_drive_folder_id = document.getElementById('crud-drive-folder-id').value;

    const formData = new FormData();
    formData.append('slug', slug);
    formData.append('title', title);
    formData.append('description', description);
    formData.append('price', price);
    if (original_price) formData.append('original_price', original_price);
    formData.append('quantity_text', quantity_text);
    formData.append('category', category);
    formData.append('license', license);
    formData.append('sort_order', sort_order);
    formData.append('image_url', image_url);
    formData.append('google_drive_url', google_drive_url);
    formData.append('download_status', download_status);
    formData.append('google_drive_file_id', google_drive_file_id);
    formData.append('google_drive_folder_id', google_drive_folder_id);

    if (fileField.files.length > 0) {
      formData.append('digital_file', fileField.files[0]);
    }

    const url = prodId ? `/api/admin/products/${prodId}` : '/api/admin/products';
    const method = prodId ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method: method,
        body: formData // Note: Content-type is boundary generated by browser automatically for FormData!
      });
      const result = await response.json();
      if (response.ok) {
        showToast(prodId ? '🎉 Product updated successfully!' : '🎉 Product added successfully!');
        closeProductModal();
        loadProducts();
      } else {
        showToast(`⚠️ ${result.error || 'Failed to save product'}`);
      }
    } catch (err) {
      showToast('⚠️ Error connecting to server.');
    }
  });
}

// Log out admin
async function adminLogout() {
  try {
    const response = await fetch('/api/admin/logout', { method: 'POST' });
    if (response.ok) {
      window.location.href = '/admin/index.html';
    }
  } catch (e) {
    showToast('⚠️ Logout failed');
  }
}

// Show Toast Alert
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

// 7. SECURE DRIVE & AUDIT LOGS FUNCTIONS
async function loadLogs() {
  try {
    const response = await fetch('/api/admin/logs');
    const data = await response.json();
    
    const downloadContainer = document.getElementById('download-logs-list');
    downloadContainer.innerHTML = '';
    if (data.downloadLogs.length === 0) {
      downloadContainer.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:1.5rem; color:#64748B;">No downloads recorded.</td></tr>`;
    } else {
      data.downloadLogs.forEach(log => {
        downloadContainer.insertAdjacentHTML('beforeend', `
          <tr>
            <td><strong>${log.order_id}</strong></td>
            <td><code>${log.product_id}</code></td>
            <td style="font-size:0.8rem; color:#64748B;">${log.download_time}</td>
            <td><span class="status-pill status-${log.status === 'SUCCESS' ? 'paid' : 'failed'}" style="font-weight:700;">${log.status}</span></td>
          </tr>
        `);
      });
    }

    const adminContainer = document.getElementById('admin-logs-list');
    adminContainer.innerHTML = '';
    if (data.adminLogs.length === 0) {
      adminContainer.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:1.5rem; color:#64748B;">No admin actions recorded.</td></tr>`;
    } else {
      data.adminLogs.forEach(log => {
        adminContainer.insertAdjacentHTML('beforeend', `
          <tr>
            <td><strong>${log.admin_id}</strong></td>
            <td>${log.order_id}</td>
            <td><span class="status-pill" style="background:#E0F2FE; color:#0369A1; font-weight:700;">${log.action}</span></td>
            <td style="font-size:0.8rem; color:#64748B;">${log.timestamp}</td>
          </tr>
        `);
      });
    }
  } catch (err) {
    console.error('Error loading logs:', err);
  }
}

async function saveDownloadSettings() {
  const prodId = document.getElementById('crud-id').value;
  if (!prodId) {
    showToast('⚠️ Please save the product details first before configuring download settings!');
    return;
  }
  
  const google_drive_url = document.getElementById('crud-drive-url').value;
  const download_status = document.getElementById('crud-download-status').value;
  const google_drive_file_id = document.getElementById('crud-drive-file-id').value;
  const google_drive_folder_id = document.getElementById('crud-drive-folder-id').value;
  
  try {
    const response = await fetch(`/api/admin/products/${prodId}/download-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_drive_url, download_status, google_drive_file_id, google_drive_folder_id })
    });
    const result = await response.json();
    if (response.ok) {
      showToast('🎉 Download settings saved successfully!');
      loadProducts();
    } else {
      showToast(`⚠️ ${result.error || 'Failed to save download settings'}`);
    }
  } catch (err) {
    showToast('⚠️ Error connecting to server.');
  }
}

function testDownloadLink() {
  const url = document.getElementById('crud-drive-url').value.trim();
  const resultSpan = document.getElementById('test-link-result');
  
  if (!url) {
    resultSpan.textContent = '❌ DOWNLOAD SOURCE INVALID';
    resultSpan.style.color = '#EF4444';
    showToast('⚠️ Link cannot be empty.');
    return;
  }
  
  const isDriveLink = /^(https?:\/\/)?(www\.)?(drive|docs)\.google\.com\/(file\/d\/[a-zA-Z0-9_-]+|drive\/folders\/[a-zA-Z0-9_-]+|open\?id=[a-zA-Z0-9_-]+|document\/d\/[a-zA-Z0-9_-]+)/i.test(url);
  
  if (isDriveLink) {
    resultSpan.textContent = '✅ DOWNLOAD SOURCE READY';
    resultSpan.style.color = 'var(--green)';
    showToast('🎉 Link is valid Google Drive source!');
  } else {
    resultSpan.textContent = '❌ DOWNLOAD SOURCE INVALID';
    resultSpan.style.color = '#EF4444';
    showToast('⚠️ Invalid Google Drive URL format.');
  }
}

async function revokeDownload(orderId) {
  if (!confirm(`Are you sure you want to revoke download access for Order ${orderId}?`)) {
    return;
  }
  try {
    const response = await fetch(`/api/admin/orders/${orderId}/revoke-download`, { method: 'POST' });
    const result = await response.json();
    if (response.ok) {
      showToast('🎉 Download access revoked!');
      loadOrders();
    } else {
      showToast(`⚠️ ${result.error || 'Failed to revoke download'}`);
    }
  } catch (err) {
    showToast('⚠️ Error connecting to server.');
  }
}

async function restoreDownload(orderId) {
  if (!confirm(`Are you sure you want to restore download access for Order ${orderId}?`)) {
    return;
  }
  try {
    const response = await fetch(`/api/admin/orders/${orderId}/restore-download`, { method: 'POST' });
    const result = await response.json();
    if (response.ok) {
      showToast('🎉 Download access restored!');
      loadOrders();
    } else {
      showToast(`⚠️ ${result.error || 'Failed to restore download'}`);
    }
  } catch (err) {
    showToast('⚠️ Error connecting to server.');
  }
}

function viewOrderDetails(orderId) {
  const o = adminOrders.find(ord => ord.id === orderId);
  if (!o) return;
  
  const itemsStr = o.items.map(i => {
    const sel = i.selection && i.selection.length > 0 ? ` [Selections: ${i.selection.join(', ')}]` : '';
    return `- ${i.title} (Qty: ${i.quantity}) (Price: ₹${i.price})${sel}`;
  }).join('\n');
  
  alert(
    `📋 ORDER DETAILS: ${o.id}\n` +
    `---------------------------------------\n` +
    `Customer Name: ${o.customer_name}\n` +
    `Customer Email: ${o.customer_email}\n` +
    `WhatsApp Phone: ${o.customer_phone}\n` +
    `UTR/Transaction ID: ${o.utr || 'N/A'}\n` +
    `Payment Status: ${o.payment_status}\n` +
    `Download Status: ${o.download_revoked ? 'REVOKED (Access Blocked)' : 'ACTIVE'}\n` +
    `Purchase Date: ${o.created_at}\n\n` +
    `🛒 Items Purchased:\n${itemsStr}\n` +
    `---------------------------------------\n` +
    `Final Total Amount Paid: ₹${o.total_amount}`
  );
}
