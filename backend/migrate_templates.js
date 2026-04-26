const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrateDb() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME
    });

    try {
        console.log("Checking students table...");
        const [rows] = await pool.query('DESCRIBE students');
        const fields = rows.map(r => r.Field);
        
        if (!fields.includes('template_data')) {
            console.log("Adding template_data column...");
            await pool.query('ALTER TABLE students ADD COLUMN template_data TEXT NULL');
            console.log("Column added successfully!");
        } else {
            console.log("template_data already exists.");
            const [tRows] = await pool.query('SELECT student_id FROM students WHERE template_data IS NOT NULL');
            console.log("Students with templates:", tRows.length);
        }
    } catch(err) {
        console.log("Error:", err.message);
    }
    
    await pool.end();
    process.exit(0);
}

migrateDb();
