// check_cloud.js
const mysql = require('mysql2/promise');
require('dotenv').config();

// Run this script to see if your Cloud DB has data
// Usage: node check_cloud.js "YOUR_RAILWAY_MYSQL_URL"

const cloudUrl = process.argv[2];
if (!cloudUrl) {
    console.error('Usage: node check_cloud.js <YOUR_RAILWAY_MYSQL_URL>');
    process.exit(1);
}

async function check() {
    try {
        const cloud = await mysql.createConnection(cloudUrl);
        console.log('📡 Connected to Cloud Database...');

        const [students] = await cloud.query('SELECT student_id, student_code, full_name, fingerprint_id FROM students');
        
        console.log(`\n👨‍🎓 Found ${students.length} students in Cloud:`);
        students.forEach(s => {
            console.log(`- [${s.student_code}] ${s.full_name} | Fingerprint ID: ${s.fingerprint_id || '❌ NOT SET'}`);
        });

        const [[activeSession]] = await cloud.query("SELECT * FROM scan_sessions WHERE status='scanning' LIMIT 1");
        if (activeSession) {
            console.log(`\n🟢 Live Session Active: ID ${activeSession.session_id} on Device ${activeSession.device_id}`);
        } else {
            console.log('\n⚪ No Live Session is currently active in the Cloud.');
        }

        await cloud.end();
    } catch (err) {
        console.error('❌ Connection Failed:', err.message);
    }
}

check();
