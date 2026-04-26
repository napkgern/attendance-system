require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'fingerprint_attendance',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function migrate() {
    try {
        console.log('Checking for academic_year column in subjects table...');
        const [rows] = await pool.query("SHOW COLUMNS FROM subjects LIKE 'academic_year'");
        if (rows.length === 0) {
            console.log('Adding academic_year column...');
            await pool.query("ALTER TABLE subjects ADD COLUMN academic_year VARCHAR(10) DEFAULT NULL");
            console.log('Column added successfully.');
        } else {
            console.log('Column already exists.');
        }
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        pool.end();
    }
}

migrate();
