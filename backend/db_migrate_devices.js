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
        console.log('1) Creating devices table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS devices (
                device_id VARCHAR(50) PRIMARY KEY,
                room_name VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Table devices ready.');

        console.log('2) Inserting default device (ROOM_1_SCANNER)...');
        await pool.query('INSERT IGNORE INTO devices (device_id, room_name) VALUES (?, ?)', ['ROOM_1_SCANNER', 'Room 1 (Default Scanner)']);

        console.log('3) Altering scan_sessions to add device_id...');
        try {
            await pool.query('ALTER TABLE scan_sessions ADD COLUMN device_id VARCHAR(50) DEFAULT "ROOM_1_SCANNER"');
            console.log('Added device_id to scan_sessions.');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log('device_id already exists in scan_sessions.');
            else throw e;
        }

        console.log('4) Altering enroll_commands to add device_id...');
        try {
            await pool.query('ALTER TABLE enroll_commands ADD COLUMN device_id VARCHAR(50) DEFAULT "ROOM_1_SCANNER"');
            console.log('Added device_id to enroll_commands.');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log('device_id already exists in enroll_commands.');
            else throw e;
        }

        console.log('Migration complete!');

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        pool.end();
    }
}

migrate();
