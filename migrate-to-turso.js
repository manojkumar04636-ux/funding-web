const sqlite3 = require('sqlite3').verbose();
const { db, initDb } = require('./database');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const localDbPath = path.join(__dirname, 'nexora.db');
const localDb = new sqlite3.Database(localDbPath);

console.log("🚀 Starting Turso Cloud Database Migration...");

// Step 1: Initialize schemas on Turso Cloud Database
initDb();

db.onIdle(() => {
  console.log("✅ Cloud Database schemas initialized successfully!");
  
  // Step 2: Migrate data table-by-table
  const tables = ['admin_users', 'settings', 'products', 'orders', 'reviews', 'admin_logs', 'download_logs'];
  let currentTableIndex = 0;

  function migrateNextTable() {
    if (currentTableIndex >= tables.length) {
      console.log("\n🎉 All tables migrated successfully to Turso Cloud!");
      localDb.close();
      process.exit(0);
    }

    const tableName = tables[currentTableIndex];
    console.log(`\n⏳ Migrating table: ${tableName}...`);

    localDb.all(`SELECT * FROM ${tableName}`, [], (err, rows) => {
      if (err) {
        console.error(`❌ Error reading local table ${tableName}:`, err);
        currentTableIndex++;
        migrateNextTable();
        return;
      }

      if (rows.length === 0) {
        console.log(`ℹ️ Table ${tableName} is empty. Skipping rows.`);
        currentTableIndex++;
        migrateNextTable();
        return;
      }

      // Generate insertion query
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const insertSql = `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;

      let insertedCount = 0;
      let errorOccurred = false;

      rows.forEach(row => {
        const values = columns.map(col => row[col]);
        db.run(insertSql, values, (insertErr) => {
          if (insertErr && !errorOccurred) {
            console.error(`❌ Error inserting into cloud table ${tableName}:`, insertErr);
            errorOccurred = true;
          }
          insertedCount++;
          if (insertedCount === rows.length) {
            if (!errorOccurred) {
              console.log(`✅ Successfully migrated ${rows.length} rows to ${tableName}.`);
            }
            currentTableIndex++;
            migrateNextTable();
          }
        });
      });
    });
  }

  migrateNextTable();
});
