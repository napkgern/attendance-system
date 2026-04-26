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
        console.log('1) Creating subject_teachers table if not exists...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS subject_teachers (
                subject_id INT NOT NULL,
                teacher_id INT NOT NULL,
                role ENUM('primary', 'co-teacher') DEFAULT 'co-teacher',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (subject_id, teacher_id),
                FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE,
                FOREIGN KEY (teacher_id) REFERENCES teachers(teacher_id) ON DELETE CASCADE
            )
        `);
        console.log('Table subject_teachers ready.');

        console.log('2) Migrating existing data from subjects table...');
        const [subjects] = await pool.query('SELECT subject_id, teacher_id FROM subjects WHERE teacher_id IS NOT NULL');
        
        let migratedCount = 0;
        for (const subj of subjects) {
            try {
                await pool.query(
                    'INSERT IGNORE INTO subject_teachers (subject_id, teacher_id, role) VALUES (?, ?, ?)',
                    [subj.subject_id, subj.teacher_id, 'primary']
                );
                migratedCount++;
            } catch (err) {
                console.error(`Error migrating subject_id ${subj.subject_id}:`, err);
            }
        }
        console.log(`Migrated ${migratedCount} existing instructor links.`);

        console.log('Migration complete!');

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        pool.end();
    }
}

migrate();
