// migrate_cloud.js
const mysql = require('mysql2/promise');
const fs = require('fs');
require('dotenv').config();

/**
 * INSTRUCTIONS:
 * 1. Ensure your local .env is correct (Source).
 * 2. Run this script: node migrate_cloud.js "mysql://user:pass@host:port/db"
 */

const cloudUrl = process.argv[2];
if (!cloudUrl) {
    console.error('Usage: node migrate_cloud.js <YOUR_RAILWAY_MYSQL_URL>');
    process.exit(1);
}

async function migrate() {
    console.log('🚀 Starting Cloud Migration...');

    // 1. Connect to Local (Source)
    const local = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME
    });

    // 2. Connect to Cloud (Target)
    const cloud = await mysql.createConnection(cloudUrl);

    const tables = [
        'users',
        'students',
        'subjects',
        'subject_teachers',
        'enrollments',
        'sessions',
        'attendance',
        'iot_commands'
    ];

    for (const table of tables) {
        try {
            console.log(`\n📦 Processing Table: ${table}...`);

            // Get Schema
            const [createRow] = await local.query(`SHOW CREATE TABLE ${table}`);
            const createSql = createRow[0]['Create Table'];

            // Create on Cloud
            await cloud.query(`DROP TABLE IF EXISTS ${table}`);
            await cloud.query(createSql);
            console.log(`✅ Created schema for ${table}`);

            // Get Data
            const [rows] = await local.query(`SELECT * FROM ${table}`);
            if (rows.length > 0) {
                const keys = Object.keys(rows[0]);
                const values = rows.map(r => keys.map(k => r[k]));
                const placeholders = keys.map(() => '?').join(',');
                const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`;

                for (const rowVal of values) {
                    await cloud.query(sql, rowVal);
                }
                console.log(`✅ Migrated ${rows.length} rows to ${table}`);
            } else {
                console.log(`ℹ️ Table ${table} is empty, skipping data sync.`);
            }

        } catch (err) {
            console.error(`❌ Error migrating ${table}:`, err.message);
        }
    }

    console.log('\n✨ Migration Complete! Your Cloud DB is now synced with your local data.');
    await local.end();
    await cloud.end();
}

migrate().catch(console.error);
