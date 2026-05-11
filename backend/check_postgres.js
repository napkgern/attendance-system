require('dotenv').config();
const pool = require('./db');

async function main() {
    const [rows] = await pool.query(`
        SELECT
            current_database() AS database_name,
            current_user AS database_user,
            NOW() AS checked_at
    `);

    console.log('PostgreSQL connection OK');
    console.table(rows);
}

main()
    .catch((err) => {
        console.error('PostgreSQL connection failed:', err.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
