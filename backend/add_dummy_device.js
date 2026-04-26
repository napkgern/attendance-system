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

async function addDummyDevice() {
    try {
        console.log('Inserting dummy device...');
        await pool.query('INSERT IGNORE INTO devices (device_id, room_name) VALUES (?, ?)', ['ROOM_2_DUMMY', 'Room 2 (Fake Scanner)']);
        console.log('Dummy device added successfully!');
    } catch (err) {
        console.error('Failed to add dummy device:', err);
    } finally {
        pool.end();
    }
}

addDummyDevice();
