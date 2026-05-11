// db.js
const { Pool, types } = require('pg');
require('dotenv').config();

// PostgreSQL returns COUNT(*) as int8 text by default.
types.setTypeParser(20, (value) => parseInt(value, 10));

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sslMode = String(process.env.DB_SSL || '').toLowerCase();
const useSsl = sslMode === 'true' || sslMode === '1' || sslMode === 'require' || (connectionString || '').includes('sslmode=require');

const poolConfig = connectionString
    ? { connectionString }
    : {
        host: process.env.DB_HOST || process.env.PGHOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || process.env.PGPORT || 5432),
        user: process.env.DB_USER || process.env.PGUSER || 'postgres',
        password: process.env.DB_PASS || process.env.PGPASSWORD || '',
        database: process.env.DB_NAME || process.env.PGDATABASE || 'fingerprint_attendance',
    };

if (useSsl) {
    poolConfig.ssl = { rejectUnauthorized: false };
}

poolConfig.max = Number(process.env.DB_CONNECTION_LIMIT || 10);

const pgPool = new Pool(poolConfig);

const INSERT_PRIMARY_KEYS = {
    attendance: 'attendance_id',
    enroll_commands: 'id',
    enrollments: 'enrollment_id',
    scan_sessions: 'id',
    sessions: 'session_id',
    students: 'student_id',
    subjects: 'subject_id',
    teachers: 'teacher_id',
    users: 'user_id',
};

function replaceQuestionPlaceholders(sql) {
    let index = 1;
    let output = '';
    let quote = null;

    for (let i = 0; i < sql.length; i += 1) {
        const char = sql[i];
        const next = sql[i + 1];

        if (quote) {
            output += char;
            if (char === quote) {
                if (quote === '\'' && next === '\'') {
                    output += next;
                    i += 1;
                } else {
                    quote = null;
                }
            }
            continue;
        }

        if (char === '\'' || char === '"' || char === '`') {
            quote = char;
            output += char === '`' ? '"' : char;
            continue;
        }

        if (char === '?') {
            output += `$${index}`;
            index += 1;
            continue;
        }

        output += char;
    }

    return output;
}

function addReturningToInsert(sql, insertIgnore) {
    let text = sql.trim().replace(/;$/, '');
    const isInsert = /^\s*INSERT\s+INTO\b/i.test(text);

    if (!isInsert) return text;

    if (insertIgnore && !/\bON\s+CONFLICT\b/i.test(text)) {
        text += ' ON CONFLICT DO NOTHING';
    }

    if (!/\bRETURNING\b/i.test(text)) {
        text += ' RETURNING *';
    }

    return text;
}

function prepareSql(sql) {
    const insertIgnore = /\bINSERT\s+IGNORE\s+INTO\b/i.test(sql);
    let text = sql
        .replace(/\bINSERT\s+IGNORE\s+INTO\b/gi, 'INSERT INTO')
        .replace(/\bCURDATE\s*\(\s*\)/gi, 'CURRENT_DATE')
        .replace(/\bNOW\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP');

    text = addReturningToInsert(text, insertIgnore);
    text = replaceQuestionPlaceholders(text);

    return text;
}

function getInsertId(sql, row) {
    const match = sql.match(/\bINSERT\s+INTO\s+"?([a-z_][a-z0-9_]*)"?/i);
    if (!match || !row) return 0;

    const primaryKey = INSERT_PRIMARY_KEYS[match[1].toLowerCase()];
    return primaryKey ? row[primaryKey] || 0 : 0;
}

async function query(sql, params = []) {
    const text = prepareSql(sql);
    const result = await pgPool.query(text, params);

    if (result.command === 'SELECT') {
        return [result.rows, result.fields];
    }

    return [{
        affectedRows: result.rowCount,
        insertId: getInsertId(text, result.rows[0]),
        rowCount: result.rowCount,
        rows: result.rows,
    }, result.fields];
}

module.exports = {
    query,
    execute: query,
    end: () => pgPool.end(),
    raw: pgPool,
};
