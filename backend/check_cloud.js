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
            const [sessInfo] = await cloud.query("SELECT date, start_time, late_condition, absent_condition FROM sessions WHERE session_id = ?", [activeSession.session_id]);
            const s = sessInfo[0];
            console.log(`\n🟢 Live Session Active: ID ${activeSession.session_id}`);
            console.log(`- Start Time: ${s.start_time} (Date: ${s.date.toISOString().split('T')[0]})`);
            console.log(`- Rules: Late > ${s.late_condition}m, Absent > ${s.absent_condition}m`);
            
            const nowUTC = new Date();
            const nowTH = new Date(nowUTC.getTime() + (7 * 60 * 60 * 1000));
            console.log(`- Server Now (Thailand): ${nowTH.toISOString()}`);
        } else {
            console.log('\n⚪ No Live Session is currently active in the Cloud.');
        }

        await cloud.end();
    } catch (err) {
        console.error('❌ Connection Failed:', err.message);
    }
}

check();
