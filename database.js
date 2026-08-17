require('dotenv').config();
const { createClient } = require('@libsql/client');
const path = require('path');
const bcrypt = require('bcryptjs');

// Create the Turso client
const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

// A wrapper that acts like sqlite3 database connection
const db = {
  pendingQueries: 0,
  onIdleCallbacks: [],
  
  _track(promise) {
    this.pendingQueries++;
    return promise.finally(() => {
      this.pendingQueries--;
      if (this.pendingQueries === 0) {
        // Execute callbacks asynchronously to avoid blocking the resolve sequence
        setTimeout(() => {
          if (this.pendingQueries === 0) {
            while (this.onIdleCallbacks.length > 0) {
              const cb = this.onIdleCallbacks.shift();
              cb();
            }
          }
        }, 50);
      }
    });
  },

  onIdle(callback) {
    if (this.pendingQueries === 0) {
      callback();
    } else {
      this.onIdleCallbacks.push(callback);
    }
  },

  serialize(callback) {
    callback();
  },
  
  run(sql, ...args) {
    let callback;
    let params = [];
    if (args.length > 0) {
      if (typeof args[args.length - 1] === 'function') {
        callback = args.pop();
      }
      if (args.length === 1 && Array.isArray(args[0])) {
        params = args[0];
      } else if (args.length > 0) {
        params = args;
      }
    }

    const promise = client.execute({ sql, args: params })
      .then(result => {
        if (callback) {
          const mockContext = {
            lastID: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : null,
            changes: Number(result.rowsAffected)
          };
          callback.call(mockContext, null);
        }
      })
      .catch(err => {
        if (callback) callback(err);
      });
    this._track(promise);
  },

  get(sql, ...args) {
    let callback;
    let params = [];
    if (args.length > 0) {
      if (typeof args[args.length - 1] === 'function') {
        callback = args.pop();
      }
      if (args.length === 1 && Array.isArray(args[0])) {
        params = args[0];
      } else if (args.length > 0) {
        params = args;
      }
    }

    const promise = client.execute({ sql, args: params })
      .then(result => {
        const row = result.rows[0] || null;
        if (callback) callback(null, row);
      })
      .catch(err => {
        if (callback) callback(err);
      });
    this._track(promise);
  },

  all(sql, ...args) {
    let callback;
    let params = [];
    if (args.length > 0) {
      if (typeof args[args.length - 1] === 'function') {
        callback = args.pop();
      }
      if (args.length === 1 && Array.isArray(args[0])) {
        params = args[0];
      } else if (args.length > 0) {
        params = args;
      }
    }

    const promise = client.execute({ sql, args: params })
      .then(result => {
        if (callback) callback(null, result.rows);
      })
      .catch(err => {
        if (callback) callback(err);
      });
    this._track(promise);
  },

  prepare(sql) {
    const self = this;
    return {
      run(...args) {
        let callback;
        let params = [];
        if (args.length > 0) {
          if (typeof args[args.length - 1] === 'function') {
            callback = args.pop();
          }
          if (args.length === 1 && Array.isArray(args[0])) {
            params = args[0];
          } else if (args.length > 0) {
            params = args;
          }
        }

        const promise = client.execute({ sql, args: params })
          .then(result => {
            if (callback) {
              const mockContext = {
                lastID: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : null,
                changes: Number(result.rowsAffected)
              };
              callback.call(mockContext, null);
            }
          })
          .catch(err => {
            if (callback) callback(err);
          });
        self._track(promise);
      },
      finalize(callback) {
        if (callback) callback();
      }
    };
  }
};

function initDb() {
  db.serialize(() => {
    // 1. Admin Users Table
    db.run(`
      CREATE TABLE IF NOT EXISTS admin_users (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed Admin User
    const adminUsername = 'yuvraj9794';
    const adminPassword = '9794yuvraj';
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(adminPassword, salt);

    db.run(
      `INSERT OR IGNORE INTO admin_users (username, password_hash) VALUES (?, ?)`,
      [adminUsername, passwordHash]
    );

    // 2. Settings Table
    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Seed Settings
    const defaultSettings = [
      { key: 'upi_id', value: '9794142912@fam' },
      { key: 'whatsapp_number', value: '979414912' },
      { key: 'banner_text', value: '🔥 MEGA DISCOUNT OFFER ACTIVE! GET 150K+ REELS FOR JUST ₹999!' },
      { key: 'offers_discount_percentage', value: '0' }
    ];

    const stmtSettings = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
    defaultSettings.forEach(s => stmtSettings.run(s.key, s.value));
    stmtSettings.finalize();

    // 3. Products Table
    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        price INTEGER NOT NULL,
        original_price INTEGER,
        quantity_text TEXT,
        category TEXT NOT NULL,
        image_url TEXT,
        file_path TEXT,
        license TEXT DEFAULT 'Personal & Commercial Use (Verify Rights)',
        is_bundle INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        google_drive_url TEXT,
        google_drive_file_id TEXT,
        google_drive_folder_id TEXT,
        download_status TEXT DEFAULT 'NOT CONFIGURED'
      )
    `);

    // Run ALTER TABLE sequentially to ensure columns exist before prepared statements run
    db.run("ALTER TABLE products ADD COLUMN google_drive_url TEXT", () => {});
    db.run("ALTER TABLE products ADD COLUMN google_drive_file_id TEXT", () => {});
    db.run("ALTER TABLE products ADD COLUMN google_drive_folder_id TEXT", () => {});
    db.run("ALTER TABLE products ADD COLUMN download_status TEXT DEFAULT 'NOT CONFIGURED'", () => {});

    // Seed Products
    const productsList = [
      // Mega Bundle
      {
        slug: 'mega-bundle',
        title: '🎉 150K+ REELS MEGA BUNDLE',
        description: 'Everything creators need to fill their content library — in one massive collection. Includes travel, money, motivation, luxury, AI, fitness, cars, nature, and many more categories!',
        price: 999,
        original_price: 1499,
        quantity_text: '150,000+ Reels',
        category: 'Mega Bundle',
        image_url: '/images/mega-bundle.png',
        file_path: 'mega_bundle_150k_reels.zip',
        license: 'Standard Creator License (Review terms before commercial use)',
        is_bundle: 1,
        sort_order: 1
      },
      // Individual Reels
      {
        slug: 'travel-reels',
        title: '🌍 Travel Reels',
        description: 'Breathtaking wanderlust travel clips, aesthetic resort video clips, aerial drone shots, scenic mountain heights, beach views, and lifestyle footage.',
        price: 199,
        original_price: 399,
        quantity_text: '4,000+ Travel Reels',
        category: 'Reels',
        image_url: '/images/travel.png',
        file_path: 'travel_reels_4k.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 10
      },
      {
        slug: 'money-motivation-reels',
        title: '💰 Money & Motivational Reels',
        description: 'High energy entrepreneurial videos, wealth motivation quotes, stock market, and hustle-themed visual content.',
        price: 149,
        original_price: 299,
        quantity_text: '1,000+ Money & Motivational Reels',
        category: 'Reels',
        image_url: '/images/money.png',
        file_path: 'money_motivation_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 11
      },
      {
        slug: 'luxury-reels',
        title: '💎 Luxury Reels',
        description: 'Supercars, hypercars, luxury mansions, yachts, private jets, and billionaire lifestyle aesthetic videos.',
        price: 299,
        original_price: 599,
        quantity_text: '10,000+ Luxury Reels',
        category: 'Reels',
        image_url: '/images/luxury.png',
        file_path: 'luxury_reels_10k.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 12
      },
      {
        slug: 'motivation-1400-reels',
        title: '🔥 Motivational Reels (1,400+ Pack)',
        description: 'Impactful speech overlaps, fitness quotes, discipline mindset videos, and cinematic backgrounds.',
        price: 199,
        original_price: 399,
        quantity_text: '1,400+ Motivational Reels',
        category: 'Reels',
        image_url: '/images/motivation_1400.png',
        file_path: 'motivation_1400_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 13
      },
      {
        slug: 'motivation-1300-reels',
        title: '⚡ Motivational Reels (1,300+ Pack)',
        description: 'Powerful visual storytelling, morning routines, self-improvement tips, and dynamic captions.',
        price: 179,
        original_price: 349,
        quantity_text: '1,300+ Motivational Reels',
        category: 'Reels',
        image_url: '/images/motivation_1300.png',
        file_path: 'motivation_1300_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 14
      },
      {
        slug: 'motivation-1000-reels',
        title: '🚀 Motivational Reels (1,000+ Pack)',
        description: 'Short dynamic mindset quotes, modern overlays, aesthetic urban visual assets, and high contrast texts.',
        price: 149,
        original_price: 299,
        quantity_text: '1,000+ Motivational Reels',
        category: 'Reels',
        image_url: '/images/motivation_1000.png',
        file_path: 'motivation_1000_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 15
      },
      {
        slug: 'ai-tech-reels',
        title: '🤖 AI Tech Reels',
        description: 'Dozens of topics including futuristic tech, artificial intelligence updates, robotic automation, software guides, and sci-fi aesthetic videos.',
        price: 129,
        original_price: 249,
        quantity_text: '500+ AI Tech Reels',
        category: 'Reels',
        image_url: '/images/ai_tech.png',
        file_path: 'ai_tech_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 16
      },
      {
        slug: 'fitness-reels',
        title: '💪 Fitness Reels',
        description: 'Bodybuilding motivation, calorie guides, workout splits, aesthetic gym shots, and general diet advice clips.',
        price: 129,
        original_price: 249,
        quantity_text: '500+ Fitness Reels',
        category: 'Reels',
        image_url: '/images/fitness.png',
        file_path: 'fitness_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 17
      },
      {
        slug: 'nature-reels',
        title: '🌿 Nature Reels',
        description: 'Relaxing waterfalls, lush forests, beautiful rain sounds backdrop, mountain landscapes, and high definition ocean waves.',
        price: 99,
        original_price: 199,
        quantity_text: '500+ Nature Reels',
        category: 'Reels',
        image_url: '/images/nature.png',
        file_path: 'nature_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 18
      },
      {
        slug: 'art-craft-reels',
        title: '🎨 Art & Craft Reels',
        description: 'Acrylic painting, resin casting, woodwork, sketching, DIY paper crafts, and satisfying painting compilation clips.',
        price: 149,
        original_price: 299,
        quantity_text: '1,000+ Art & Craft Reels',
        category: 'Reels',
        image_url: '/images/art_craft.png',
        file_path: 'art_craft_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 19
      },
      {
        slug: 'cars-reels',
        title: '🚗 Cars Reels',
        description: 'High-speed supercar races, drifting clips, cinematic rolling shots of sports cars, and luxury interior showcases.',
        price: 129,
        original_price: 249,
        quantity_text: '500+ Cars Reels',
        category: 'Reels',
        image_url: '/images/cars.png',
        file_path: 'cars_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 20
      },
      {
        slug: 'cartoon-reels',
        title: '😂 Cartoon Reels',
        description: 'Funny anime moments, cartoon edits, childhood memories clips, and colorful retro animation edits.',
        price: 99,
        original_price: 199,
        quantity_text: '500+ Cartoon Reels',
        category: 'Reels',
        image_url: '/images/cartoon.png',
        file_path: 'cartoon_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 21
      },
      {
        slug: 'animation-2d-reels',
        title: '🎬 2D Animation Reels',
        description: 'Sleek motion graphics, 2D characters, cartoon shorts, and explainer-style animated video clips.',
        price: 149,
        original_price: 299,
        quantity_text: '1,000+ 2D Animation Reels',
        category: 'Reels',
        image_url: '/images/2d_animation.png',
        file_path: 'animation_2d_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 22
      },
      {
        slug: 'wood-work-reels',
        title: '🪵 Wood Work Reels',
        description: 'Satisfying carpentry, furniture making, wood carving compilation, polishing, and joinery showcases.',
        price: 129,
        original_price: 249,
        quantity_text: '1,000+ Wood Work Reels',
        category: 'Reels',
        image_url: '/images/wood_work.png',
        file_path: 'wood_work_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 23
      },
      {
        slug: 'tools-reels',
        title: '🛠️ Tools Reels',
        description: 'Satisfying mechanical assemblies, tool restorations, factory automation, and heavy machinery operations.',
        price: 179,
        original_price: 349,
        quantity_text: '2,000+ Tools Reels',
        category: 'Reels',
        image_url: '/images/tools.png',
        file_path: 'tools_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 24
      },
      {
        slug: 'tips-tricks-reels',
        title: '💡 Tips & Tricks Reels',
        description: 'Life hacks, kitchen organization tips, office setup tweaks, cleaning advice, and productivity shortcuts.',
        price: 129,
        original_price: 249,
        quantity_text: '1,000+ Tips & Tricks Reels',
        category: 'Reels',
        image_url: '/images/tips_tricks.png',
        file_path: 'tips_tricks_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 25
      },
      {
        slug: 'satisfying-reels',
        title: '😍 Satisfying Reels',
        description: 'ASMR kinetic sand cutting, paint mixing, slime squishing, industrial processing, and visual satisfying loops.',
        price: 129,
        original_price: 249,
        quantity_text: '1,000+ Satisfying Reels',
        category: 'Reels',
        image_url: '/images/satisfying.png',
        file_path: 'satisfying_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 26
      },
      {
        slug: 'funny-reels',
        title: '😂 Funny Reels',
        description: 'Comedy skits, fail compilations, animal videos, viral memes, and humorous public interactions.',
        price: 149,
        original_price: 299,
        quantity_text: '1,400+ Funny Reels',
        category: 'Reels',
        image_url: '/images/funny.png',
        file_path: 'funny_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 27
      },
      {
        slug: 'shark-tank-reels',
        title: '💼 Shark Tank Reels',
        description: 'Famous pitch clips, business negotiation tactics, business analysis clips, and entrepreneur insights.',
        price: 199,
        original_price: 399,
        quantity_text: '3,500+ Shark Tank Reels',
        category: 'Reels',
        image_url: '/images/shark_tank.png',
        file_path: 'shark_tank_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 28
      },
      {
        slug: 'omegle-reels',
        title: '🎥 Omegle Reels',
        description: 'Funny chat interactions, musical improv on camera, wholesome pranks, and hilarious reactions.',
        price: 99,
        original_price: 199,
        quantity_text: '500+ Omegle Reels',
        category: 'Reels',
        image_url: '/images/omegle.png',
        file_path: 'omegle_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 29
      },
      {
        slug: 'gym-reels',
        title: '🏋️ Gym Reels',
        description: 'Heavy weight lifting, personal trainer guides, correct forms instruction, workout routines, and aesthetic lifts.',
        price: 179,
        original_price: 349,
        quantity_text: '2,000+ Gym Reels',
        category: 'Reels',
        image_url: '/images/gym.png',
        file_path: 'gym_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 30
      },
      {
        slug: 'gadget-reels',
        title: '📱 Useful Gadgets Reels',
        description: 'Sleek smart home gadgets, smart devices reviews, kitchen appliances, and viral tech tool reviews.',
        price: 199,
        original_price: 399,
        quantity_text: '3,000+ Useful Gadgets Reels',
        category: 'Reels',
        image_url: '/images/gadgets.png',
        file_path: 'gadgets_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 31
      },
      {
        slug: 'emotional-reels',
        title: '❤️ Emotional Reels',
        description: 'Heartwarming messages, relationship lessons, motivational quotes, family guidance, and cinematic stories.',
        price: 129,
        original_price: 249,
        quantity_text: '1,000+ Emotional Reels',
        category: 'Reels',
        image_url: '/images/emotional.png',
        file_path: 'emotional_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 32
      },
      {
        slug: 'ai-doctor-reels',
        title: '🩺 AI Doctor Reels',
        description: 'Fascinating medical facts, AI generated doctors talking about health tips, anatomy facts, and diet rules.',
        price: 179,
        original_price: 349,
        quantity_text: '1,500+ AI Doctor Reels',
        category: 'Reels',
        image_url: '/images/ai_doctor.png',
        file_path: 'ai_doctor_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 33
      },
      {
        slug: 'ai-business-reels',
        title: '🤖 AI Business Reels',
        description: 'AI tools for business, workflow automations guides, passive income tips, and faceless business tips.',
        price: 129,
        original_price: 249,
        quantity_text: '500+ AI Business Reels',
        category: 'Reels',
        image_url: '/images/ai_business.png',
        file_path: 'ai_business_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 34
      },
      {
        slug: 'superhero-reels',
        title: '🦸 Superhero Reels',
        description: 'MCU, DC Cinematic Universe edits, character highlight compilation, comics discussions, and high frame edits.',
        price: 149,
        original_price: 299,
        quantity_text: '500+ Superhero Reels',
        category: 'Reels',
        image_url: '/images/superhero.png',
        file_path: 'superhero_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 35
      },
      {
        slug: 'lofi-reels',
        title: '🎵 Lo-Fi Emotional Songs Reels',
        description: 'Calm lo-fi music with retro anime aesthetic background video clips, aesthetic rainy streets, and mood text.',
        price: 129,
        original_price: 249,
        quantity_text: '1,000+ Lo-Fi Songs Reels',
        category: 'Reels',
        image_url: '/images/lofi_songs.png',
        file_path: 'lofi_songs_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 36
      },
      {
        slug: 'study-reels',
        title: '📚 Study Reels Bundle',
        description: 'Aesthetic desk setups, study tips, active recall flashcards guides, Pomodoro study sessions, and calligraphy notes visual assets.',
        price: 129,
        original_price: 249,
        quantity_text: '500+ Study Reels',
        category: 'Reels',
        image_url: '/images/study.png',
        file_path: 'study_reels.zip',
        license: 'Creator License',
        is_bundle: 0,
        sort_order: 37
      },

      // Creator Packages
      {
        slug: 'starter-pack',
        title: '🌱 STARTER PACK',
        description: 'Get any 3 selected bundles from our entire reels catalog. Pick your custom niches at checkout!',
        price: 299,
        original_price: 597,
        quantity_text: 'Any 3 Selected Reels Bundles',
        category: 'Packages',
        image_url: '/images/starter_pack.png',
        file_path: 'custom_selection',
        license: 'Creator License',
        is_bundle: 1,
        sort_order: 50
      },
      {
        slug: 'creator-pack',
        title: '🚀 CREATOR PACK',
        description: 'Choose any 8 selected reels bundles from our catalog. Perfect for multi-niche creators and agency accounts!',
        price: 599,
        original_price: 1592,
        quantity_text: 'Any 8 Selected Reels Bundles',
        category: 'Packages',
        image_url: '/images/creator_pack.png',
        file_path: 'custom_selection',
        license: 'Creator License',
        is_bundle: 1,
        sort_order: 51
      },

      // Bonus Creator Resources (Ebooks)
      {
        slug: 'chatgpt-ebook',
        title: '📕 50 TIPS FOR USING CHATGPT — EBOOK',
        description: 'Learn the exact prompt frameworks, system instructions, and workflow shortcuts to supercharge your writing and business with ChatGPT.',
        price: 99,
        original_price: 199,
        quantity_text: 'Interactive PDF Ebook',
        category: 'Ebooks',
        image_url: '/images/chatgpt_ebook.png',
        file_path: 'chatgpt_50_tips_ebook.pdf',
        license: 'Personal Read License',
        is_bundle: 0,
        sort_order: 70
      },
      {
        slug: 'canva-ebook',
        title: '📘 CANVA CRASH COURSE — EBOOK',
        description: 'Go from zero to pro designer. Learn color theory, typography settings, design systems, grid alignments, and animation hacks in Canva.',
        price: 149,
        original_price: 299,
        quantity_text: 'Canva Design Guide Ebook',
        category: 'Ebooks',
        image_url: '/images/canva_course.png',
        file_path: 'canva_crash_course_ebook.pdf',
        license: 'Personal Read License',
        is_bundle: 0,
        sort_order: 71
      },
      {
        slug: 'faceless-instagram-ebook',
        title: '📗 FACELESS INSTAGRAM MARKETING — EBOOK',
        description: 'Step-by-step masterclass on how to grow, viral-hack, and monetize a completely faceless Instagram page from 0 to 100K+ followers.',
        price: 149,
        original_price: 299,
        quantity_text: 'Marketing Blueprint Ebook',
        category: 'Ebooks',
        image_url: '/images/faceless_insta.png',
        file_path: 'faceless_instagram_marketing_ebook.pdf',
        license: 'Personal Read License',
        is_bundle: 0,
        sort_order: 72
      },
      {
        slug: 'social-media-planner',
        title: '📅 SOCIAL MEDIA PLANNER',
        description: 'Complete digital content calendar templates, video scripting cards, analytics sheets, and hooks list to organize your production workflow.',
        price: 99,
        original_price: 199,
        quantity_text: 'Digital Planner Sheets',
        category: 'Ebooks',
        image_url: '/images/planner.png',
        file_path: 'social_media_planner_template.xlsx',
        license: 'Personal Use Only',
        is_bundle: 0,
        sort_order: 73
      },
      {
        slug: 'test-reels-bundle',
        title: '🧪 TEST REELS BUNDLE',
        description: 'A mock product bundle to test sandbox payment and Google Drive downloads.',
        price: 9,
        original_price: 99,
        quantity_text: 'Test Package (1 Reels)',
        category: 'Reels',
        image_url: '/images/default.png',
        file_path: 'test_reels.zip',
        license: 'Test License',
        is_bundle: 0,
        sort_order: 99,
        google_drive_url: 'https://drive.google.com/file/d/1t_2e3s4t5_drive_url_demo/view?usp=sharing',
        download_status: 'READY'
      }
    ];

    const stmtProduct = db.prepare(`
      INSERT OR REPLACE INTO products (slug, title, description, price, original_price, quantity_text, category, image_url, file_path, license, is_bundle, sort_order, google_drive_url, google_drive_file_id, google_drive_folder_id, download_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    productsList.forEach(p => {
      stmtProduct.run(
        p.slug,
        p.title,
        p.description,
        p.price,
        p.original_price,
        p.quantity_text,
        p.category,
        p.image_url,
        p.file_path,
        p.license,
        p.is_bundle,
        p.sort_order,
        p.google_drive_url || '',
        p.google_drive_file_id || '',
        p.google_drive_folder_id || '',
        p.download_status || 'NOT CONFIGURED'
      );
    });
    stmtProduct.finalize();

    // 4. Orders Table
    db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        items TEXT NOT NULL,          -- JSON string of items: [{productId, slug, title, price, quantity, selection: []}]
        total_amount INTEGER NOT NULL,
        payment_status TEXT NOT NULL CHECK (payment_status IN ('PENDING', 'PAYMENT_SUBMITTED', 'VERIFYING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED')),
        utr TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        download_revoked INTEGER DEFAULT 0
      )
    `);

    // Run ALTER TABLE sequentially
    db.run("ALTER TABLE orders ADD COLUMN download_revoked INTEGER DEFAULT 0", () => {});

    // 5. Reviews Table
    db.run(`
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        rating INTEGER CHECK (rating BETWEEN 1 AND 5),
        review_text TEXT NOT NULL,
        date TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
      )
    `);

    // 6. Admin Logs Table
    db.run(`
      CREATE TABLE IF NOT EXISTS admin_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        action TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 7. Download Logs Table
    db.run(`
      CREATE TABLE IF NOT EXISTS download_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        download_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT NOT NULL
      )
    `);

    // Seed Reviews (Genuine placeholders for admin confirmation, or real reviews)
    const reviewsList = [
      {
        customer_name: "Yuvraj Sharma",
        rating: 5,
        review_text: "Highly recommended for content creators. The motivates and travels category saved me hundreds of hours editing reels from scratch. Videos are true 4K quality!",
        date: "2026-08-01",
        status: "APPROVED"
      },
      {
        customer_name: "Priya Patel",
        rating: 5,
        review_text: "The faceless Instagram guide and luxury reels are so high quality. My page grew from 2K to 35K in less than 3 weeks using these clips.",
        date: "2026-08-10",
        status: "APPROVED"
      }
    ];

    const stmtReview = db.prepare(`
      INSERT OR IGNORE INTO reviews (customer_name, rating, review_text, date, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    reviewsList.forEach(r => {
      stmtReview.run(r.customer_name, r.rating, r.review_text, r.date, r.status);
    });
    stmtReview.finalize();
  });

  console.log("Database initialized successfully!");
}

module.exports = {
  db,
  initDb
};

// Run if called directly
if (require.main === module) {
  initDb();
}
