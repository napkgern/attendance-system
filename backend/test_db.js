const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkDb() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME
    });

    try {
        const [rows] = await pool.query('DESCRIBE students');
        console.log("Students:", rows.map(r => r.Field));

        const [tRows] = await pool.query('SELECT student_id, template_data FROM students WHERE template_data IS NOT NULL');
        console.log("Students with templates:", tRows.length);
    } catch(err) {
        console.log("Error:", err.message);
    }
    pool.end();
}
checkDb();
