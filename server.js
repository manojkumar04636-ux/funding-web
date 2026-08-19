const express = require('express');
const session = require('cookie-session');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const qrcode = require('qrcode');
const multer = require('multer');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const { db } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const PAYMENT_MODE = process.env.PAYMENT_MODE || 'test';

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    // fs.mkdirSync(uploadsDir);
  }
} catch (err) {
  console.warn("Could not check/create uploads directory:", err.message);
}

// Ensure images folder exists in public
const publicImagesDir = path.join(__dirname, 'public', 'images');
try {
  if (!fs.existsSync(publicImagesDir)) {
    fs.mkdirSync(publicImagesDir, { recursive: true });
  }
} catch (err) {
  console.warn("Could not check/create public/images directory:", err.message);
}

// Multer Storage Configuration for Admin Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session setup (using stateless cookie-session for Vercel Serverless environment compatibility)
app.use(session({
  name: 'nexora_session',
  keys: [process.env.SESSION_SECRET || 'nexora_creator_universe_secret_key_150k_9794142912_fam'],
  maxAge: 24 * 60 * 60 * 1000 // 24 Hours
}));

// Serves static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Admin Authorization Middleware
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized admin access' });
  }
}

// ==========================================
// 1. PUBLIC PRODUCT & SETTINGS ENDPOINTS
// ==========================================

// Get all active products
app.get('/api/products', (req, res) => {
  db.all('SELECT * FROM products ORDER BY sort_order ASC, id DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    // Return products with mapped is_bundle as boolean
    const products = rows.map(r => ({
      ...r,
      is_bundle: !!r.is_bundle
    }));
    res.json(products);
  });
});

// Get settings
app.get('/api/settings', (req, res) => {
  db.all('SELECT * FROM settings', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const settingsObj = {};
    rows.forEach(r => {
      settingsObj[r.key] = r.value;
    });
    res.json(settingsObj);
  });
});

// Get approved reviews
app.get('/api/reviews', (req, res) => {
  db.all("SELECT * FROM reviews WHERE status = 'APPROVED' ORDER BY id DESC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Submit a review
app.post('/api/reviews', (req, res) => {
  const { customer_name, rating, review_text } = req.body;
  if (!customer_name || !rating || !review_text) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const ratingInt = parseInt(rating);
  if (ratingInt < 1 || ratingInt > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }

  const today = new Date().toISOString().split('T')[0];
  const stmt = db.prepare('INSERT INTO reviews (customer_name, rating, review_text, date, status) VALUES (?, ?, ?, ?, ?)');
  stmt.run([customer_name, ratingInt, review_text, today, 'PENDING'], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, message: 'Review submitted. It will appear after verification!' });
  });
  stmt.finalize();
});

// ==========================================
// 2. CHECKOUT & ORDER ENDPOINTS
// ==========================================

// Create a new order (Validate prices server-side)
app.post('/api/orders', (req, res) => {
  const { customer_name, customer_email, customer_phone, items } = req.body;

  if (!customer_name || !customer_email || !customer_phone || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Missing required order details' });
  }

  // Fetch all products to validate pricing
  db.all('SELECT * FROM products', [], async (err, dbProducts) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const dbProductsMap = {};
    dbProducts.forEach(p => {
      dbProductsMap[p.slug] = p;
    });

    let calculatedTotal = 0;
    const validatedItems = [];

    for (let item of items) {
      const dbProd = dbProductsMap[item.slug];
      if (!dbProd) {
        return res.status(400).json({ error: `Product slug "${item.slug}" not found` });
      }

      // Check if price is correct
      const price = dbProd.price;
      const quantity = parseInt(item.quantity) || 1;
      calculatedTotal += price * quantity;

      validatedItems.push({
        productId: dbProd.id,
        slug: dbProd.slug,
        title: dbProd.title,
        price: price,
        quantity: quantity,
        selection: item.selection || [] // E.g., chosen 3 or 8 items for packs
      });
    }

    // Load discount settings if any
    db.get("SELECT value FROM settings WHERE key = 'offers_discount_percentage'", [], async (err, row) => {
      let discountPercentage = 0;
      if (row && row.value) {
        discountPercentage = parseFloat(row.value) || 0;
      }

      const discountAmount = Math.round(calculatedTotal * (discountPercentage / 100));
      const finalAmount = calculatedTotal - discountAmount;

      // Generate Unique Order ID (Format: NEX-YYMMDD-RANDOM)
      const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
      const randPart = Math.random().toString(36).substring(2, 6).toUpperCase();
      const orderId = `NEX-${datePart}-${randPart}`;

      // Get UPI ID from settings
      db.get("SELECT value FROM settings WHERE key = 'upi_id'", [], async (err, upiRow) => {
        const upiId = (upiRow && upiRow.value) ? upiRow.value : '9794142912@fam';

        // Generate UPI Deep Link
        // Format: upi://pay?pa=address&pn=name&am=amount&tr=transactionRef&cu=currency
        const cleanStoreName = 'NEXORA';
        const upiLink = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(cleanStoreName)}&am=${finalAmount}.00&tr=${orderId}&cu=INR`;

        try {
          // Generate QR Code as DataURL
          const qrDataUrl = await qrcode.toDataURL(upiLink);

          // Save order to Database with PENDING status
          const itemsJson = JSON.stringify(validatedItems);
          const stmt = db.prepare(`
            INSERT INTO orders (id, customer_name, customer_email, customer_phone, items, total_amount, payment_status, utr)
            VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL)
          `);

          stmt.run([orderId, customer_name, customer_email, customer_phone, itemsJson, finalAmount], function (err) {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            res.json({
              orderId: orderId,
              customer_name,
              customer_email,
              customer_phone,
              items: validatedItems,
              totalAmount: finalAmount,
              payment_status: 'PENDING',
              upiQrCode: qrDataUrl,
              upiId: upiId
            });
          });
          stmt.finalize();

        } catch (qrErr) {
          res.status(500).json({ error: 'Failed to generate QR code' });
        }
      });
    });
  });
});

// Submit Payment UTR / Transaction Details
app.post('/api/orders/:id/submit-payment', (req, res) => {
  const orderId = req.params.id;
  const { utr } = req.body;

  if (!utr || utr.trim().length < 6) {
    return res.status(400).json({ error: 'Please enter a valid UPI UTR / Transaction ID (minimum 6 digits)' });
  }

  const cleanUtr = utr.trim();

  // First, check if this UTR has already been used on ANY order
  db.get('SELECT id, payment_status FROM orders WHERE utr = ? AND id != ?', [cleanUtr, orderId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (row) {
      return res.status(400).json({
        error: 'This Transaction/UTR ID has already been submitted for another order. Duplicate payments are not allowed.'
      });
    }

    // Check if the current order exists and is not already paid
    db.get('SELECT payment_status FROM orders WHERE id = ?', [orderId], (err, order) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      if (order.payment_status === 'PAID') {
        return res.status(400).json({ error: 'This order is already verified and marked as PAID!' });
      }

      // Update Order Status to PAYMENT_SUBMITTED
      db.run(
        "UPDATE orders SET payment_status = 'PAYMENT_SUBMITTED', utr = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [cleanUtr, orderId],
        function (updateErr) {
          if (updateErr) {
            return res.status(500).json({ error: updateErr.message });
          }

          res.json({
            success: true,
            message: 'Payment details submitted successfully! Your payment is currently under verification.',
            status: 'PAYMENT_SUBMITTED'
          });
        }
      );
    });
  });
});

// Get order details & status
app.get('/api/orders/:id', (req, res) => {
  const orderId = req.params.id;

  db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!row) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const items = JSON.parse(row.items);

    // Fetch products to map download_status
    db.all('SELECT slug, download_status FROM products', [], (prodErr, products) => {
      if (prodErr) {
        return res.status(500).json({ error: prodErr.message });
      }

      const prodMap = {};
      products.forEach(p => {
        prodMap[p.slug] = p.download_status;
      });

      const orderObj = {
        ...row,
        items: items,
        product_statuses: prodMap
      };

      res.json(orderObj);
    });
  });
});

// Get payment mode (test/production)
app.get('/api/payment-mode', (req, res) => {
  res.json({ paymentMode: PAYMENT_MODE });
});

// Simulate successful payment (TEST MODE ONLY)
app.post('/api/orders/:id/simulate-payment-success', (req, res) => {
  const orderId = req.params.id;

  if (PAYMENT_MODE !== 'test') {
    return res.status(403).json({ error: 'Simulated payment is only allowed in test/sandbox mode.' });
  }

  // Check if order exists
  db.get('SELECT payment_status FROM orders WHERE id = ?', [orderId], (err, order) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.payment_status === 'PAID') {
      return res.json({ success: true, message: 'Order is already PAID', payment_status: 'PAID' });
    }

    // Update order status to PAID
    db.run(
      "UPDATE orders SET payment_status = 'PAID', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [orderId],
      function (updateErr) {
        if (updateErr) {
          return res.status(500).json({ error: updateErr.message });
        }

        res.json({
          success: true,
          message: 'Test payment simulated successfully. Order status updated to PAID.',
          payment_status: 'PAID'
        });
      }
    );
  });
});

// Secure Download Route
app.get('/api/download/:orderId/:productSlug', (req, res) => {
  const { orderId, productSlug } = req.params;

  db.get('SELECT payment_status, items, download_revoked FROM orders WHERE id = ?', [orderId], (err, order) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!order) {
      return res.status(404).send('<h3>Order not found</h3>');
    }

    if (order.payment_status !== 'PAID') {
      return res.status(403).send('<h3>Access Denied: Payment has not been verified yet.</h3>');
    }

    if (order.download_revoked === 1) {
      db.run('INSERT INTO download_logs (order_id, product_id, status) VALUES (?, ?, ?)', [orderId, productSlug, 'REVOKED']);
      return res.status(403).send('<h3>Access Denied: Download access has been temporarily disabled. Contact NEXORA support.</h3>');
    }

    const items = JSON.parse(order.items);
    // Verify product ownership (or bundle check)
    const hasAccess = items.some(item => {
      if (item.slug === productSlug) return true;
      if (item.selection && item.selection.includes(productSlug)) return true;
      if (item.slug === 'mega-bundle') return true;
      return false;
    });

    if (!hasAccess) {
      return res.status(403).send('<h3>Access Denied: Product not included in this purchase.</h3>');
    }

    // Fetch product details
    db.get('SELECT download_status, google_drive_url, file_path, title FROM products WHERE slug = ?', [productSlug], (err, product) => {
      if (err || !product) {
        return res.status(404).send('<h3>Product details not found</h3>');
      }

      if (product.download_status === 'DISABLED') {
        db.run('INSERT INTO download_logs (order_id, product_id, status) VALUES (?, ?, ?)', [orderId, productSlug, 'DISABLED']);
        return res.status(403).send('<h3>Access Denied: Download temporarily unavailable. Contact NEXORA support.</h3>');
      }

      if (product.download_status === 'NOT CONFIGURED') {
        db.run('INSERT INTO download_logs (order_id, product_id, status) VALUES (?, ?, ?)', [orderId, productSlug, 'NOT CONFIGURED']);
        return res.status(403).send('<h3>Access Denied: Download is being prepared. Contact NEXORA support.</h3>');
      }

      if (product.download_status === 'READY') {
        db.run('INSERT INTO download_logs (order_id, product_id, status) VALUES (?, ?, ?)', [orderId, productSlug, 'SUCCESS']);

        if (product.google_drive_url && product.google_drive_url.trim() !== '') {
          return res.redirect(product.google_drive_url.trim());
        } else {
          const filePath = path.join(uploadsDir, product.file_path);
          if (!fs.existsSync(filePath)) {
            const dummyContent = `NEXORA DIGITAL DOWNLOAD - ${product.title}\nThank you for purchasing! This is your download delivery file.`;
            fs.writeFileSync(filePath, dummyContent);
          }
          return res.download(filePath, `${productSlug}_nexora.zip`);
        }
      }

      return res.status(400).send('<h3>Invalid download configuration</h3>');
    });
  });
});

// ==========================================
// 3. ADMIN PANEL API (SECURE)
// ==========================================

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  db.get('SELECT * FROM admin_users WHERE username = ?', [username], (err, admin) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!admin) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    // Compare passwords
    bcrypt.compare(password, admin.password_hash, (bcryptErr, match) => {
      if (match) {
        req.session.isAdmin = true;
        req.session.adminUser = username;
        res.json({ success: true, message: 'Logged in successfully!' });
      } else {
        res.status(401).json({ error: 'Invalid admin credentials' });
      }
    });
  });
});

// Admin Check Status
app.get('/api/admin/status', (req, res) => {
  if (req.session && req.session.isAdmin) {
    res.json({ loggedIn: true, user: req.session.adminUser });
  } else {
    res.json({ loggedIn: false });
  }
});

// Admin Logout
app.post('/api/admin/logout', (req, res) => {
  req.session = null;
  res.json({ success: true });
});

// Change Admin Password
app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both current and new passwords are required' });
  }

  const username = req.session.adminUser;

  db.get('SELECT password_hash FROM admin_users WHERE username = ?', [username], (err, admin) => {
    if (err || !admin) {
      return res.status(500).json({ error: 'Failed to verify admin' });
    }

    bcrypt.compare(currentPassword, admin.password_hash, (bcryptErr, match) => {
      if (!match) {
        return res.status(400).json({ error: 'Incorrect current password' });
      }

      const salt = bcrypt.genSaltSync(10);
      const newHash = bcrypt.hashSync(newPassword, salt);

      db.run('UPDATE admin_users SET password_hash = ? WHERE username = ?', [newHash, username], (updateErr) => {
        if (updateErr) {
          return res.status(500).json({ error: 'Failed to update password' });
        }
        res.json({ success: true, message: 'Password updated successfully!' });
      });
    });
  });
});

// Analytics Dashboard Endpoint
app.get('/api/admin/analytics', requireAdmin, (req, res) => {
  const analytics = {};

  // Total sales revenue
  db.get("SELECT SUM(total_amount) as total FROM orders WHERE payment_status = 'PAID'", [], (err, rowPaid) => {
    analytics.revenue = rowPaid ? (rowPaid.total || 0) : 0;

    // Total orders count
    db.get("SELECT COUNT(id) as cnt FROM orders WHERE payment_status = 'PAID'", [], (err, rowOrders) => {
      analytics.paidOrdersCount = rowOrders ? rowOrders.cnt : 0;

      // Pending / submitted orders count
      db.get("SELECT COUNT(id) as cnt FROM orders WHERE payment_status IN ('PENDING', 'PAYMENT_SUBMITTED', 'VERIFYING')", [], (err, rowPending) => {
        analytics.pendingOrdersCount = rowPending ? rowPending.cnt : 0;

        // Fetch daily analytics (Last 7 days)
        db.all(`
          SELECT DATE(created_at) as order_date, COUNT(id) as order_count, SUM(total_amount) as daily_revenue
          FROM orders
          WHERE payment_status = 'PAID'
          GROUP BY order_date
          ORDER BY order_date DESC
          LIMIT 7
        `, [], (err, dailyData) => {
          analytics.dailyPerformance = dailyData || [];

          // Popular bundles count
          db.all("SELECT items FROM orders WHERE payment_status = 'PAID'", [], (err, orders) => {
            const popularityMap = {};
            if (orders) {
              orders.forEach(order => {
                try {
                  const items = JSON.parse(order.items);
                  items.forEach(item => {
                    popularityMap[item.title] = (popularityMap[item.title] || 0) + item.quantity;
                    if (item.selection && item.selection.length > 0) {
                      item.selection.forEach(s => {
                        popularityMap[s] = (popularityMap[s] || 0) + 1;
                      });
                    }
                  });
                } catch (e) {
                  // Catch parsing errors
                }
              });
            }

            analytics.popularBundles = Object.keys(popularityMap).map(key => ({
              title: key,
              sales: popularityMap[key]
            })).sort((a, b) => b.sales - a.sales).slice(0, 5);

            res.json(analytics);
          });
        });
      });
    });
  });
});

// Admin view all orders
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  db.all('SELECT * FROM orders ORDER BY created_at DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const orders = rows.map(r => ({
      ...r,
      items: JSON.parse(r.items)
    }));
    res.json(orders);
  });
});

// Update order status (Approve/Reject payment verification)
app.post('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const orderId = req.params.id;
  const { status } = req.body;

  const validStatuses = ['PENDING', 'PAYMENT_SUBMITTED', 'VERIFYING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid payment status' });
  }

  db.run(
    'UPDATE orders SET payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [status, orderId],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (status === 'PAID') {
        const adminUser = req.session.adminUser || 'admin';
        db.run(
          'INSERT INTO admin_logs (admin_id, order_id, action) VALUES (?, ?, ?)',
          [adminUser, orderId, 'MARK PAID']
        );
      }

      res.json({ success: true, message: `Order status successfully updated to ${status}!` });
    }
  );
});

// Admin save settings
app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const { upi_id, whatsapp_number, banner_text, offers_discount_percentage } = req.body;

  db.serialize(() => {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    if (upi_id !== undefined) stmt.run('upi_id', upi_id.trim());
    if (whatsapp_number !== undefined) stmt.run('whatsapp_number', whatsapp_number.trim());
    if (banner_text !== undefined) stmt.run('banner_text', banner_text.trim());
    if (offers_discount_percentage !== undefined) stmt.run('offers_discount_percentage', offers_discount_percentage.toString());
    stmt.finalize();

    res.json({ success: true, message: 'Settings saved successfully!' });
  });
});

// Update product download settings only
app.post('/api/admin/products/:id/download-settings', requireAdmin, (req, res) => {
  const prodId = req.params.id;
  const { google_drive_url, download_status, google_drive_file_id, google_drive_folder_id } = req.body;

  db.run(`
    UPDATE products
    SET google_drive_url = ?, download_status = ?, google_drive_file_id = ?, google_drive_folder_id = ?
    WHERE id = ?
  `, [
    google_drive_url || '',
    download_status || 'NOT CONFIGURED',
    google_drive_file_id || '',
    google_drive_folder_id || '',
    prodId
  ], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, message: 'Download settings updated successfully!' });
  });
});

// Admin view system logs
app.get('/api/admin/logs', requireAdmin, (req, res) => {
  db.all('SELECT * FROM download_logs ORDER BY download_time DESC', [], (err, downloadRows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    db.all('SELECT * FROM admin_logs ORDER BY timestamp DESC', [], (err2, adminRows) => {
      if (err2) {
        return res.status(500).json({ error: err2.message });
      }
      res.json({
        downloadLogs: downloadRows,
        adminLogs: adminRows
      });
    });
  });
});

// Revoke download access
app.post('/api/admin/orders/:id/revoke-download', requireAdmin, (req, res) => {
  const orderId = req.params.id;
  const adminUser = req.session.adminUser || 'admin';

  db.run('UPDATE orders SET download_revoked = 1 WHERE id = ?', [orderId], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    db.run(
      'INSERT INTO admin_logs (admin_id, order_id, action) VALUES (?, ?, ?)',
      [adminUser, orderId, 'REVOKE DOWNLOAD']
    );
    res.json({ success: true, message: 'Download access revoked successfully.' });
  });
});

// Restore download access
app.post('/api/admin/orders/:id/restore-download', requireAdmin, (req, res) => {
  const orderId = req.params.id;
  const adminUser = req.session.adminUser || 'admin';

  db.run('UPDATE orders SET download_revoked = 0 WHERE id = ?', [orderId], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    db.run(
      'INSERT INTO admin_logs (admin_id, order_id, action) VALUES (?, ?, ?)',
      [adminUser, orderId, 'RESTORE DOWNLOAD']
    );
    res.json({ success: true, message: 'Download access restored successfully.' });
  });
});

// Add new product
app.post('/api/admin/products', requireAdmin, upload.single('digital_file'), (req, res) => {
  const { slug, title, description, price, original_price, quantity_text, category, license, is_bundle, sort_order, google_drive_url, download_status, google_drive_file_id, google_drive_folder_id } = req.body;

  if (!slug || !title || !price || !category) {
    return res.status(400).json({ error: 'Missing essential fields (slug, title, price, category)' });
  }

  const filePath = req.file ? req.file.filename : (req.body.file_path || '');
  const image_url = req.body.image_url || '/images/default.png';

  const stmt = db.prepare(`
    INSERT INTO products (slug, title, description, price, original_price, quantity_text, category, image_url, file_path, license, is_bundle, sort_order, google_drive_url, download_status, google_drive_file_id, google_drive_folder_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run([
    slug.trim(),
    title.trim(),
    description,
    parseInt(price),
    original_price ? parseInt(original_price) : null,
    quantity_text,
    category.trim(),
    image_url,
    filePath,
    license || 'Creator License',
    is_bundle === 'true' || is_bundle === '1' ? 1 : 0,
    sort_order ? parseInt(sort_order) : 0,
    google_drive_url || '',
    download_status || 'NOT CONFIGURED',
    google_drive_file_id || '',
    google_drive_folder_id || ''
  ], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, message: 'Product added successfully!', productId: this.lastID });
  });
  stmt.finalize();
});

// Update product
app.put('/api/admin/products/:id', requireAdmin, upload.single('digital_file'), (req, res) => {
  const prodId = req.params.id;
  const { slug, title, description, price, original_price, quantity_text, category, license, is_bundle, sort_order, google_drive_url, download_status, google_drive_file_id, google_drive_folder_id } = req.body;

  db.get('SELECT file_path FROM products WHERE id = ?', [prodId], (err, product) => {
    if (err || !product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const filePath = req.file ? req.file.filename : product.file_path;
    const image_url = req.body.image_url || '/images/default.png';

    const isBundleVal = is_bundle === 'true' || is_bundle === '1' || is_bundle === true ? 1 : 0;

    db.run(`
      UPDATE products
      SET slug = ?, title = ?, description = ?, price = ?, original_price = ?, quantity_text = ?, category = ?, image_url = ?, file_path = ?, license = ?, is_bundle = ?, sort_order = ?, google_drive_url = ?, download_status = ?, google_drive_file_id = ?, google_drive_folder_id = ?
      WHERE id = ?
    `, [
      slug.trim(),
      title.trim(),
      description,
      parseInt(price),
      original_price ? parseInt(original_price) : null,
      quantity_text,
      category.trim(),
      image_url,
      filePath,
      license || 'Creator License',
      isBundleVal,
      sort_order ? parseInt(sort_order) : 0,
      google_drive_url || '',
      download_status || 'NOT CONFIGURED',
      google_drive_file_id || '',
      google_drive_folder_id || '',
      prodId
    ], function (updateErr) {
      if (updateErr) {
        return res.status(500).json({ error: updateErr.message });
      }
      res.json({ success: true, message: 'Product updated successfully!' });
    });
  });
});

// Delete product
app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const prodId = req.params.id;

  db.run('DELETE FROM products WHERE id = ?', [prodId], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, message: 'Product deleted successfully!' });
  });
});

// Get admin reviews
app.get('/api/admin/reviews', requireAdmin, (req, res) => {
  db.all('SELECT * FROM reviews ORDER BY id DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Update review status (Approve / Reject reviews)
app.post('/api/admin/reviews/:id/status', requireAdmin, (req, res) => {
  const reviewId = req.params.id;
  const { status } = req.body;

  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid review status' });
  }

  db.run('UPDATE reviews SET status = ? WHERE id = ?', [status, reviewId], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, message: `Review status updated to ${status}!` });
  });
});

// Admin Change Details (Banners/FAQs/Offers)
// Handled by generic settings update endpoint but we can add individual options in the UI

// Start Server
if (process.env.NODE_ENV !== 'production' && require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

module.exports = app;
