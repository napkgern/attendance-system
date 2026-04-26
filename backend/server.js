// server.js (ปรับปรุง)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS || '10', 10);

/* ------------------ Helpers ------------------ */
async function findUserByUsernameOrEmail(identifier) {
    const [rows] = await pool.query(
        'SELECT user_id, username, email, password_hash, role FROM users WHERE username = ? OR email = ? LIMIT 1',
        [identifier, identifier]
    );
    return rows[0];
}

/* ------------------ Register ------------------ */
app.post('/api/register', async (req, res) => {
    try {
        const { name, username, email, password, role = 'student', student_code } = req.body;
        if (!username || !password || !name) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });

        const [existsRows] = await pool.query('SELECT user_id FROM users WHERE username = ? OR email = ? LIMIT 1', [username, email]);
        if (existsRows.length) return res.status(400).json({ error: 'username หรือ email มีแล้ว' });

        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        const [r] = await pool.query('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)', [username, email || null, hash, role]);
        const userId = r.insertId;

        if (role === 'student') {
            // Check if student exists by code
            let linked = false;
            if (student_code) {
                const [existing] = await pool.query('SELECT student_id FROM students WHERE student_code = ? LIMIT 1', [student_code]);
                if (existing.length > 0) {
                    await pool.query('UPDATE students SET user_id = ?, full_name = ? WHERE student_id = ?', [userId, name, existing[0].student_id]);
                    linked = true;
                }
            }
            if (!linked) {
                await pool.query('INSERT INTO students (user_id, student_code, full_name) VALUES (?, ?, ?)', [userId, student_code || null, name]);
            }
        } else if (role === 'teacher') {
            await pool.query('INSERT INTO teachers (user_id, full_name) VALUES (?, ?)', [userId, name]);
        }

        const token = jwt.sign({ user_id: userId, username, role }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ token, user: { user_id: userId, username, email, role } });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'server error' });
    }
});

/* ------------------ Login ------------------ */
app.post('/api/login', async (req, res) => {
    try {
        const { usernameOrEmail, password } = req.body;
        if (!usernameOrEmail || !password) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });

        const user = await findUserByUsernameOrEmail(usernameOrEmail);
        if (!user) return res.status(400).json({ error: 'ไม่พบผู้ใช้' });

        // password_hash must exist in user record
        if (!user.password_hash) return res.status(500).json({ error: 'user has no password hash' });

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(400).json({ error: 'รหัสผ่านไม่ถูกต้อง' });

        const token = jwt.sign({ user_id: user.user_id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ token, user: { user_id: user.user_id, username: user.username, email: user.email, role: user.role } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'server error' });
    }
});

/* ------------------ Auth middleware ------------------ */
function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: 'No token provided' });
    const parts = header.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'Invalid authorization header format' });
    const token = parts[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

/* ------------------ Get profile ------------------ */
// (Duplicate /api/me removed from here - verifying against bottom implementation)

/* ------------------ Create session (teacher) ------------------ */
app.post('/api/sessions', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') return res.status(403).json({ error: 'No permission' });
        const { subject_id, date, start_time, end_time, late_condition, absent_condition } = req.body;
        const [r] = await pool.query(
            'INSERT INTO sessions (subject_id, date, start_time, end_time, status, created_by, late_condition, absent_condition) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [subject_id, date, start_time, end_time || null, 'scheduled', req.user.user_id, late_condition || 15, absent_condition || 60]
        );
        res.json({ session_id: r.insertId });
    } catch (err) {
        console.error('Create session error:', err);
        res.status(500).json({ error: 'server error' });
    }
});

/* ------------------ Attendance POST (from ESP32) ------------------ */
/* ------------------ Attendance POST (from ESP32) ------------------ */
app.post('/api/attendance', async (req, res) => {
    try {
        const { fingerprint_id, session_id, device_id } = req.body;
        if (!fingerprint_id || !session_id) return res.status(400).json({ error: 'missing fingerprint_id or session_id' });

        // 1. Get Student Info
        const [stuRows] = await pool.query('SELECT student_id, student_code, full_name FROM students WHERE fingerprint_id = ? LIMIT 1', [fingerprint_id]);
        if (!stuRows.length) return res.status(404).json({ error: 'Unknown fingerprint', unknown: true });

        const student = stuRows[0];
        const student_id = student.student_id;

        // 2. Check for duplicate scan
        const [existing] = await pool.query(
            'SELECT attendance_id, status, time_stamp FROM attendance WHERE student_id = ? AND session_id = ? LIMIT 1',
            [student_id, session_id]
        );

        if (existing.length > 0) {
            return res.json({
                ok: true,
                already_present: true,
                name: student.full_name,
                code: student.student_code,
                status: existing[0].status
            });
        }

        // 3. Get Session rules for Late calculation
        const [sessRows] = await pool.query('SELECT date, start_time, late_condition, absent_condition FROM sessions WHERE session_id = ? LIMIT 1', [session_id]);
        if (!sessRows.length) return res.status(404).json({ error: 'Session not found' });

        const session = sessRows[0];

        // Calculate Status (Present vs Late)
        let status = 'Present';

        // Retrieve date from session and combine with start_time (assuming server timezone consistency)
        // Note: session.date is comparable to YYYY-MM-DD. session.start_time is 'HH:MM:SS'.
        const now = new Date();

        // Parse Session Start Time
        const sessionDate = new Date(session.date);
        const [h, m] = session.start_time.split(':');
        sessionDate.setHours(parseInt(h), parseInt(m), 0, 0);

        // Add Late Cushion (minutes)
        const lateThreshold = new Date(sessionDate.getTime() + (session.late_condition * 60000));
        const absentThreshold = new Date(sessionDate.getTime() + (session.absent_condition * 60000));

        if (now > absentThreshold) {
            status = 'Absent';
        } else if (now > lateThreshold) {
            status = 'Late';
        }

        // 4. Insert Attendance
        const [r] = await pool.query(
            'INSERT INTO attendance (student_id, session_id, status, fingerprint_id) VALUES (?, ?, ?, ?)',
            [student_id, session_id, status, fingerprint_id]
        );

        // 5. Return rich info for IoT Display
        res.json({
            ok: true,
            attendance_id: r.insertId,
            name: student.full_name,
            code: student.student_code,
            status: status
        });

    } catch (err) {
        console.error('Attendance error:', err);
        res.status(500).json({ error: 'server error' });
    }
});

/* ------------------ Simple query: sessions for subject ------------------ */
app.get('/api/subjects/:subjectId/sessions', authMiddleware, async (req, res) => {
    try {
        const subjectId = req.params.subjectId;
        const [rows] = await pool.query('SELECT * FROM sessions WHERE subject_id = ? ORDER BY date DESC', [subjectId]);
        res.json({ sessions: rows });
    } catch (err) {
        console.error('Get sessions error:', err);
        res.status(500).json({ error: 'server error' });
    }
});

/* ------------------ Health / root ------------------ */
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'auth.html')));

/* ------------------ Start ------------------ */
const PORT = process.env.PORT || 3000;

async function checkPool() {
    try {
        await pool.query('SELECT 1');
        console.log('DB connection OK');
    } catch (err) {
        console.error('DB connection failed:', err);
    }
}

app.listen(PORT, async () => {
    console.log(`API listening on port ${PORT}`);
    await checkPool();
});


// ดึงรายชื่อนักเรียนเฉพาะที่ลงทะเบียนเรียนในรายวิชาของครู
app.get('/api/teacher/students', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission' });
        }

        const { subject_id } = req.query;

        let query = `SELECT DISTINCT
                s.student_id,      -- PK ของตาราง students
                s.student_code,    -- รหัสนักเรียนที่อยากโชว์ในคอลัมน์ "รหัส"
                s.full_name,
                s.year_level,
                s.fingerprint_id
             FROM students s
             JOIN enrollments e ON s.student_id = e.student_id
             JOIN subjects sub ON e.subject_id = sub.subject_id
             JOIN teachers t ON sub.teacher_id = t.teacher_id
             WHERE t.user_id = ?`;

        const params = [req.user.user_id];

        if (subject_id) {
            query += ` AND sub.subject_id = ?`;
            params.push(subject_id);
        }

        query += ` ORDER BY s.student_code`;

        const [rows] = await pool.query(query, params);

        res.json({ students: rows });
    } catch (err) {
        console.error('Get students error:', err);
        res.status(500).json({ error: 'server error' });
    }
});

// CREATE student
app.post('/api/teacher/students', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission' });
        }

        const { student_code, full_name, year_level, subject_id } = req.body;
        if (!student_code || !full_name) {
            return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
        }

        const [r] = await pool.query(
            'INSERT INTO students (student_code, full_name, year_level) VALUES (?, ?, ?)',
            [student_code, full_name, year_level || null]
        );

        const newStudentId = r.insertId;

        // Auto-enroll if subject_id is provided
        if (subject_id) {
            await pool.query(
                'INSERT INTO enrollments (student_id, subject_id) VALUES (?, ?)',
                [newStudentId, subject_id]
            );
        }

        res.json({ ok: true, student_id: newStudentId });
    } catch (err) {
        console.error('POST /teacher/students error:', err);
        res.status(500).json({ error: 'server error' });
    }
});

// UPDATE student
app.put('/api/teacher/students/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission' });
        }

        const id = req.params.id;
        const { student_code, full_name, year_level } = req.body;

        await pool.query(
            'UPDATE students SET student_code = ?, full_name = ?, year_level = ? WHERE student_id = ?',
            [student_code, full_name, year_level || null, id]
        );

        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /teacher/students/:id error:', err);
        res.status(500).json({ error: 'server error' });
    }
});

// DELETE student
app.delete('/api/teacher/students/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission' });
        }

        const id = req.params.id;
        await pool.query('DELETE FROM students WHERE student_id = ?', [id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('DELETE /teacher/students/:id error:', err);
        res.status(500).json({ error: 'server error' });
    }
});


// เพิ่มวิชาใหม่ให้ครูคนนั้น
// ------------------ Teacher: subjects ------------------

// ดึงรายวิชาของครูที่ login
app.get('/api/teacher/subjects', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission' });
        }

        // หา teacher_id จาก user_id ที่ login
        const [trows] = await pool.query(
            'SELECT teacher_id FROM teachers WHERE user_id = ? LIMIT 1',
            [req.user.user_id]
        );
        if (!trows.length) {
            return res.status(400).json({ error: 'ไม่พบข้อมูลครูของ user นี้' });
        }
        const teacherId = trows[0].teacher_id;

        const [rows] = await pool.query(
            `SELECT s.subject_id, s.subject_name, s.academic_year, st.role, s.teacher_id as creator_id 
             FROM subjects s 
             JOIN subject_teachers st ON s.subject_id = st.subject_id 
             WHERE st.teacher_id = ?`,
            [teacherId]
        );

        res.json({ subjects: rows });
    } catch (err) {
        console.error('Get subjects error:', err);
        res.status(500).json({ error: 'server error' });
    }
});

// เพิ่มวิชาใหม่ให้ครูที่ login
app.post('/api/teacher/subjects', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission' });
        }

        const { subject_name, subject_code, academic_year } = req.body;
        if (!subject_name) {
            return res.status(400).json({ error: 'ต้องกรอกชื่อวิชา' });
        }

        const [trows] = await pool.query(
            'SELECT teacher_id FROM teachers WHERE user_id = ? LIMIT 1',
            [req.user.user_id]
        );
        if (!trows.length) {
            return res.status(400).json({ error: 'ไม่พบข้อมูลครูของ user นี้' });
        }
        const teacherId = trows[0].teacher_id;

        const [r] = await pool.query(
            'INSERT INTO subjects (subject_name, academic_year, teacher_id) VALUES (?, ?, ?)',
            [subject_name, academic_year || null, teacherId]
        );

        // Also link the creator as primary in subject_teachers
        await pool.query(
            'INSERT INTO subject_teachers (subject_id, teacher_id, role) VALUES (?, ?, ?)',
            [r.insertId, teacherId, 'primary']
        );

        res.json({
            subject: {
                subject_id: r.insertId,
                subject_name,
                subject_code: subject_code || null,
                academic_year: academic_year || null,
                teacher_id: teacherId
            }
        });
    } catch (err) {
        console.error('Add subject error:', err);
        res.status(500).json({ error: 'server error' });
    }
});

// --- Co-Teacher Management ---
app.get('/api/teacher/available-co-teachers', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission' });
        }
        // Fetch all teachers except the current one
        const [rows] = await pool.query(
            'SELECT teacher_id, full_name, user_id FROM teachers WHERE user_id != ? ORDER BY full_name',
            [req.user.user_id]
        );
        res.json({ teachers: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'server error' });
    }
});

app.get('/api/teacher/subjects/:id/co-teachers', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission' });
        }
        const subjectId = req.params.id;
        const [rows] = await pool.query(`
            SELECT t.teacher_id, t.full_name, st.role, u.email 
            FROM subject_teachers st
            JOIN teachers t ON st.teacher_id = t.teacher_id
            JOIN users u ON t.user_id = u.user_id
            WHERE st.subject_id = ?
        `, [subjectId]);
        res.json({ teachers: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'server error' });
    }
});

app.post('/api/teacher/subjects/:id/co-teachers', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission' });
        }
        const subjectId = req.params.id;
        const { teacher_id } = req.body;
        
        if (!teacher_id) return res.status(400).json({ error: 'Missing teacher_id' });

        await pool.query(
            'INSERT IGNORE INTO subject_teachers (subject_id, teacher_id, role) VALUES (?, ?, "co-teacher")',
            [subjectId, teacher_id]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'server error' });
    }
});

app.delete('/api/teacher/subjects/:id/co-teachers/:teacher_id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission' });
        }
        const { id, teacher_id } = req.params;
        await pool.query(
            'DELETE FROM subject_teachers WHERE subject_id = ? AND teacher_id = ? AND role != "primary"',
            [id, teacher_id]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'server error' });
    }
});

// ดึง session ของครู (ตามวิชา)
app.get('/api/teacher/sessions', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission' });
        }

        const { subject_id } = req.query;

        const [rows] = await pool.query(
            `SELECT session_id, subject_id, date, start_time, end_time
       FROM sessions
       WHERE created_by = ?
       AND (? IS NULL OR subject_id = ?)
       ORDER BY date DESC`,
            [req.user.user_id, subject_id || null, subject_id || null]
        );

        res.json({ sessions: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'server error' });
    }
});

app.get('/api/teacher/sessions/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission' });
        }
        const [rows] = await pool.query(
            'SELECT * FROM sessions WHERE session_id = ? LIMIT 1',
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Session not found' });
        res.json({ session: rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'server error' });
    }
});

app.put('/api/teacher/sessions/:id/rules', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission' });
        }
        const session_id = req.params.id;
        const { late_condition, absent_condition } = req.body;

        // Update session
        await pool.query(
            'UPDATE sessions SET late_condition = ?, absent_condition = ? WHERE session_id = ?',
            [late_condition, absent_condition, session_id]
        );

        // Fetch session info for recalculation
        const [sessRows] = await pool.query('SELECT date, start_time FROM sessions WHERE session_id = ? LIMIT 1', [session_id]);
        if (sessRows.length > 0) {
            const session = sessRows[0];
            const sessionDate = new Date(session.date);
            const [h, m] = session.start_time.split(':');
            sessionDate.setHours(parseInt(h), parseInt(m), 0, 0);

            const lateThresh = new Date(sessionDate.getTime() + (late_condition * 60000));
            const absentThresh = new Date(sessionDate.getTime() + (absent_condition * 60000));

            // Select all attendance for this session that have a time_stamp (auto-scanned ones)
            const [attRows] = await pool.query(
                'SELECT attendance_id, time_stamp FROM attendance WHERE session_id = ? AND time_stamp IS NOT NULL',
                [session_id]
            );

            for (const r of attRows) {
                const checkInTime = new Date(r.time_stamp);
                let newStatus = 'Present';
                if (checkInTime > absentThresh) {
                    newStatus = 'Absent';
                } else if (checkInTime > lateThresh) {
                    newStatus = 'Late';
                }
                
                await pool.query(
                    'UPDATE attendance SET status = ? WHERE attendance_id = ?',
                    [newStatus, r.attendance_id]
                );
            }
        }
        
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'server error' });
    }
});




app.get('/api/teacher/attendance', authMiddleware, async (req, res) => {
    try {
        const { subject_id, session_id } = req.query;

        if (!subject_id || !session_id) {
            return res.status(400).json({ error: 'missing subject_id or session_id' });
        }

        const [rows] = await pool.query(`
            SELECT
                st.student_id,
                st.student_code,
                st.full_name,
                s.date,
                s.start_time,
                s.end_time,
                COALESCE(a.status, 'Absent') AS status,
                a.time_stamp
            FROM enrollments e
            JOIN students st ON e.student_id = st.student_id
            JOIN sessions s ON s.session_id = ?
            LEFT JOIN attendance a
                ON a.student_id = st.student_id
               AND a.session_id = s.session_id
            WHERE e.subject_id = ?
            ORDER BY st.student_code
        `, [session_id, subject_id]);

        res.json({ records: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'server error' });
    }
});


app.post('/api/teacher/attendance/override', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission' });
        }

        const { session_id, overrides } = req.body;
        if (!session_id || !overrides || !Array.isArray(overrides)) {
            return res.status(400).json({ error: 'invalid payload' });
        }

        // Processing overrides sequentially to avoid complex dynamic SQL
        for (const override of overrides) {
            const { student_id, status } = override;
            if (!student_id || !status) continue;

            // Check if existing
            const [existing] = await pool.query(
                'SELECT attendance_id FROM attendance WHERE student_id = ? AND session_id = ? LIMIT 1',
                [student_id, session_id]
            );

            if (existing.length > 0) {
                // Update
                await pool.query(
                    'UPDATE attendance SET status = ? WHERE attendance_id = ?',
                    [status, existing[0].attendance_id]
                );
            } else {
                // Insert new (manual override for someone absent)
                await pool.query(
                    'INSERT INTO attendance (student_id, session_id, status) VALUES (?, ?, ?)',
                    [student_id, session_id, status]
                );
            }
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('Manual attendance override error:', err);
        res.status(500).json({ error: 'server error' });
    }
});




app.get('/api/devices', authMiddleware, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM devices');
        res.json({ devices: rows });
    } catch (err) {
        res.status(500).json({ error: 'server error' });
    }
});


app.post('/api/teacher/enroll', authMiddleware, async (req, res) => {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'No permission' });
    }

    const { student_id, device_id } = req.body;
    if (!student_id) {
        return res.status(400).json({ error: 'missing student_id' });
    }

    const finalDevice = device_id || 'ROOM_1_SCANNER';

    // ❗ ตัด scan ของเครื่องนี้ทิ้งก่อน
    await pool.query(`
        UPDATE scan_sessions 
        SET status='idle'
        WHERE status='scanning' AND device_id = ?
    `, [finalDevice]);

    // ใช้ student_id เป็น fingerprint_id
    const fingerprint_id = student_id;

    await pool.query(
        `INSERT INTO enroll_commands (student_id, fingerprint_id, status, device_id)
         VALUES (?, ?, 'pending', ?)`,
        [student_id, fingerprint_id, finalDevice]
    );

    res.json({ ok: true, message: 'Enroll started' });
});



app.post('/api/teacher/scan/start', authMiddleware, async (req, res) => {
    const { subject_id, session_id, device_id } = req.body;
    const finalDevice = device_id || 'ROOM_1_SCANNER';

    // ปิด scan เก่าของเครื่องนี้ก่อน
    await pool.query(`UPDATE scan_sessions SET status='idle' WHERE device_id = ?`, [finalDevice]);

    await pool.query(
        `INSERT INTO scan_sessions (subject_id, session_id, status, started_at, device_id)
         VALUES (?, ?, 'scanning', NOW(), ?)`,
        [subject_id, session_id, finalDevice]
    );

    res.json({ ok: true });
});

app.post('/api/teacher/scan/stop', authMiddleware, async (req, res) => {
    const { subject_id } = req.body;
    await pool.query(`
        UPDATE scan_sessions
        SET status='idle'
        WHERE status='scanning' AND subject_id = ?
    `, [subject_id]);

    res.json({ ok: true });
});


app.get('/api/iot/mode', async (req, res) => {
    const { device_id } = req.query;
    const finalDevice = device_id || 'ROOM_1_SCANNER';

    // 1️⃣ ENROLL มาก่อนเสมอ
    const [[enroll]] = await pool.query(`
        SELECT * FROM enroll_commands
        WHERE status='pending' AND device_id = ?
        ORDER BY created_at ASC
        LIMIT 1
    `, [finalDevice]);

    if (enroll) {
        return res.json({
            mode: 'enroll',
            command_id: enroll.id,
            fingerprint_id: enroll.fingerprint_id
        });
    }
    // 2️⃣ SCAN
    const [[scan]] = await pool.query(`
        SELECT * FROM scan_sessions
        WHERE status='scanning' AND device_id = ?
        ORDER BY started_at DESC
        LIMIT 1
    `, [finalDevice]);

    if (scan) {
        return res.json({
            mode: 'scan',
            session_id: scan.session_id
        });
    }

    // 3️⃣ IDLE
    res.json({ mode: 'idle' });
});

app.get('/api/teacher/scan/status', authMiddleware, async (req, res) => {
    const { subject_id } = req.query;
    let query = `SELECT * FROM scan_sessions WHERE status='scanning'`;
    let params = [];
    
    if (subject_id) {
        query += ` AND subject_id = ?`;
        params.push(subject_id);
    }
    query += ` ORDER BY started_at DESC LIMIT 1`;

    const [[scan]] = await pool.query(query, params);

    if (scan) {
        return res.json({
            mode: 'scan',
            session_id: scan.session_id,
            subject_id: scan.subject_id,
            device_id: scan.device_id
        });
    }
    res.json({ mode: 'idle' });
});

app.get('/api/teacher/latest-session', authMiddleware, async (req, res) => {
    const { subject_id } = req.query;
    
    let query = `
        SELECT s.*, sub.subject_name
        FROM sessions s
        JOIN subjects sub ON s.subject_id = sub.subject_id
    `;
    let params = [];
    if (subject_id) {
        query += ` WHERE s.subject_id = ? `;
        params.push(subject_id);
    }
    query += ` ORDER BY s.date DESC, s.start_time DESC LIMIT 1`;

    // 1. Find latest session
    const [sessions] = await pool.query(query, params);

    if (!sessions.length) {
        return res.json({ session: null });
    }

    const session = sessions[0];

    // 2. Count total enrolled students in subject
    const [[{ total }]] = await pool.query(
        'SELECT COUNT(*) as total FROM enrollments WHERE subject_id = ?',
        [session.subject_id]
    );

    // 3. Count Present/Late
    const [atts] = await pool.query(`
        SELECT status, COUNT(*) as cnt
        FROM attendance
        WHERE session_id = ?
        GROUP BY status
    `, [session.session_id]);

    let present = 0;
    let late = 0;

    atts.forEach(r => {
        if (r.status === 'Present') present = r.cnt;
        if (r.status === 'Late') late = r.cnt;
        // Absent in DB?
    });

    // Absent = Total - (Present + Late)
    // (Assuming 'Absent' rows aren't pre-filled)
    const absent = total - (present + late);

    res.json({
        session,
        stats: { total, present, late, absent }
    });
});



app.post('/api/iot/enroll/done', async (req, res) => {
    const { command_id, template_data } = req.body;
    if (!command_id) {
        return res.status(400).json({ error: 'missing command_id' });
    }

    const [[cmd]] = await pool.query(`
        SELECT student_id, fingerprint_id
        FROM enroll_commands
        WHERE id = ?
    `, [command_id]);

    if (!cmd) {
        return res.status(404).json({ error: 'command not found' });
    }

    // อัปเดตเฉพาะนักเรียนคนนี้ พร้อมเก็บบันทึก template_data หากมีแนบมา
    await pool.query(`
        UPDATE students
        SET fingerprint_id = ?, template_data = ?
        WHERE student_id = ?
    `, [cmd.fingerprint_id, template_data || null, cmd.student_id]);

    await pool.query(`
        UPDATE enroll_commands
        SET status='done'
        WHERE id = ?
    `, [command_id]);

    res.json({ ok: true });
});

// API สำหรับ ESP32 ดาวน์โหลดลายนิ้วมือเฉพาะของนักเรียนในรายวิชานั้นๆ
app.get('/api/iot/templates', async (req, res) => {
    try {
        const { session_id } = req.query;
        if (!session_id) {
            return res.status(400).json({ error: 'missing session_id' });
        }

        const [rows] = await pool.query(`
            SELECT s.fingerprint_id, s.template_data
            FROM students s
            JOIN enrollments e ON s.student_id = e.student_id
            JOIN sessions sess ON e.subject_id = sess.subject_id
            WHERE sess.session_id = ?
              AND s.template_data IS NOT NULL
        `, [session_id]);

        res.json({ templates: rows });
    } catch (err) {
        console.error('Fetch templates error:', err);
        res.status(500).json({ error: 'server error' });
    }
});

app.get('/api/enroll/status/:id', async (req, res) => {
    const [rows] = await pool.query('SELECT status FROM enroll_commands WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ status: rows[0].status });
});



// ดูประวัติของ student คนเดียว
app.get('/api/student/attendance', authMiddleware, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ error: 'No permission' });
    }

    const [rows] = await pool.query(`
    SELECT sub.subject_name, s.date, s.start_time, a.status
    FROM attendance a
    JOIN sessions s ON a.session_id = s.session_id
    JOIN subjects sub ON s.subject_id = sub.subject_id
    WHERE a.student_id = (
      SELECT student_id FROM students WHERE user_id = ?
    )
    ORDER BY s.date DESC
  `, [req.user.user_id]);

    res.json({ records: rows });
});

/* ------------------ Student: CHECK LIVE SESSION ------------------ */
app.get('/api/student/live-session', authMiddleware, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ error: 'No permission' });
    }

    try {
        // 1. Find ACTIVE scanning session
        const [[scan]] = await pool.query(`
            SELECT * FROM scan_sessions
            WHERE status='scanning'
            ORDER BY started_at DESC
            LIMIT 1
        `);

        if (!scan) {
            // No live session
            return res.json({ live: false });
        }

        // 2. Get Session Details
        const [[details]] = await pool.query(`
            SELECT 
                s.session_id,
                s.date,
                s.start_time,
                sub.subject_name,
                sub.subject_id
            FROM sessions s
            JOIN subjects sub ON s.subject_id = sub.subject_id
            WHERE s.session_id = ?
        `, [scan.session_id]);

        if (!details) {
            // Inconsistency found (scan points to missing session)
            return res.json({ live: false });
        }

        res.json({ live: true, session: details });

    } catch (err) {
        console.error('Check live session error:', err);
        res.status(500).json({ error: 'server error' });
    }
});


// Student dashboard summary
app.get('/api/student/summary', authMiddleware, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ error: 'No permission' });
    }

    // หา student_id
    const [[stu]] = await pool.query(
        'SELECT student_id, fingerprint_id FROM students WHERE user_id = ?',
        [req.user.user_id]
    );

    if (!stu) {
        return res.status(404).json({ error: 'student not found' });
    }

    /* 1️⃣ วันนี้เรียนกี่คาบ */
    const [[today]] = await pool.query(`
    SELECT COUNT(*) AS total
    FROM sessions
    WHERE date = CURDATE()
  `);

    /* 2️⃣ เช็กชื่อล่าสุด */
    const [[last]] = await pool.query(`
    SELECT 
      a.status, 
      a.time_stamp,
      sub.subject_name
    FROM attendance a
    JOIN sessions s ON a.session_id = s.session_id
    JOIN subjects sub ON s.subject_id = sub.subject_id
    WHERE a.student_id = ?
    ORDER BY a.time_stamp DESC
    LIMIT 1
  `, [stu.student_id]);

    res.json({
        today_sessions: today.total,
        last_attendance: last || null,
        fingerprint_id: stu.fingerprint_id
    });
});

// student ดู summary ของตัวเองตามวิชา (สำหรับหน้า detail 1 วิชา)
app.get('/api/student/summary/by-subject', authMiddleware, async (req, res) => {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'No permission' });
    const { subject_id } = req.query;
    if (!subject_id) return res.status(400).json({ error: 'misising subject_id' });

    const [[stu]] = await pool.query('SELECT student_id, fingerprint_id FROM students WHERE user_id = ?', [req.user.user_id]);
    if (!stu) return res.status(404).json({ error: 'Student not found' });

    /* 1️⃣ วันนี้เรียนกี่คาบ (สำหรับวิชานี้) */
    const [[today]] = await pool.query(`
        SELECT COUNT(*) AS total FROM sessions WHERE date = CURDATE() AND subject_id = ?
    `, [subject_id]);

    /* 2️⃣ เช็กชื่อล่าสุด (สำหรับวิชานี้) */
    const [[last]] = await pool.query(`
        SELECT a.status, a.time_stamp, sub.subject_name
        FROM attendance a
        JOIN sessions s ON a.session_id = s.session_id
        JOIN subjects sub ON s.subject_id = sub.subject_id
        WHERE a.student_id = ? AND sub.subject_id = ?
        ORDER BY a.time_stamp DESC LIMIT 1
    `, [stu.student_id, subject_id]);

    res.json({
        today_sessions: today.total,
        last_attendance: last || null,
        fingerprint_id: stu.fingerprint_id
    });
});


// student ดู attendance ของตัวเองตามวิชา
app.get('/api/student/attendance/by-subject', authMiddleware, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ error: 'No permission' });
    }

    const { subject_id, session_id } = req.query;

    const [rows] = await pool.query(`
        SELECT 
            sub.subject_name,
            s.date,
            s.start_time,
            s.end_time,
            COALESCE(a.status, 'Absent') AS status,
            a.time_stamp
        FROM sessions s
        JOIN subjects sub ON sub.subject_id = s.subject_id
        LEFT JOIN attendance a 
            ON a.session_id = s.session_id
           AND a.student_id = (
               SELECT student_id FROM students WHERE user_id = ?
           )
        WHERE s.subject_id = ?
          AND (? IS NULL OR s.session_id = ?)
        ORDER BY s.date DESC
    `, [
        req.user.user_id,
        subject_id,
        session_id || null,
        session_id || null
    ]);

    res.json({ records: rows });
});


// Debug endpoint
app.get('/api/test-subjects', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM subjects');
        res.json({ count: rows.length, rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// student ดูวิชาที่ตัวเองลงทะเบียนเรียนแล้ว
app.get('/api/student/subjects', authMiddleware, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ error: 'No permission' });
    }

    const [rows] = await pool.query(`
        SELECT sub.subject_id, sub.subject_name, sub.academic_year
        FROM subjects sub
        JOIN enrollments e ON sub.subject_id = e.subject_id
        JOIN students s ON e.student_id = s.student_id
        WHERE s.user_id = ?
        ORDER BY sub.subject_name
    `, [req.user.user_id]);

    res.json({ subjects: rows });
});

// student ดูรายวิชาที่สามารถลงทะเบียนเรียนได้ (วิชาที่ยังไม่ได้ลง)
app.get('/api/student/available-subjects', authMiddleware, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ error: 'No permission' });
    }

    const [rows] = await pool.query(`
        SELECT sub.subject_id, sub.subject_name, sub.academic_year, t.full_name as teacher_name
        FROM subjects sub
        LEFT JOIN subject_teachers st ON sub.subject_id = st.subject_id AND st.role = 'primary'
        LEFT JOIN teachers t ON st.teacher_id = t.teacher_id
        WHERE sub.subject_id NOT IN (
            SELECT e.subject_id 
            FROM enrollments e 
            JOIN students s ON e.student_id = s.student_id 
            WHERE s.user_id = ?
        )
        ORDER BY sub.subject_name
    `, [req.user.user_id]);

    res.json({ subjects: rows });
});

// student ลงทะเบียนเรียน
app.post('/api/student/enroll-subject', authMiddleware, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ error: 'No permission' });
    }

    const { subject_id } = req.body;
    if (!subject_id) return res.status(400).json({ error: 'Missing subject_id' });

    try {
        const [[student]] = await pool.query('SELECT student_id FROM students WHERE user_id = ?', [req.user.user_id]);
        if (!student) return res.status(404).json({ error: 'Student profile not found' });

        await pool.query(
            'INSERT IGNORE INTO enrollments (student_id, subject_id) VALUES (?, ?)',
            [student.student_id, subject_id]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error('Enroll subject error:', err);
        res.status(500).json({ error: 'server error' });
    }
});


app.get('/api/student/sessions', authMiddleware, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ error: 'No permission' });
    }

    const { subject_id } = req.query;
    if (!subject_id) {
        return res.status(400).json({ error: 'missing subject_id' });
    }

    const [rows] = await pool.query(`
    SELECT
      session_id,
      date,
      start_time,
      end_time
    FROM sessions
    WHERE subject_id = ?
    ORDER BY date DESC
  `, [subject_id]);

    console.log(`API /api/student/sessions subject_id=${subject_id} found ${rows.length} rows`);
    res.json({ sessions: rows });
});




// server.js
// server.js
app.get('/api/me', authMiddleware, async (req, res) => {
    try {
        const [[user]] = await pool.query(`
            SELECT 
              u.user_id,
              u.username,
              u.email,
              u.role,
              s.fingerprint_id
            FROM users u
            LEFT JOIN students s ON s.user_id = u.user_id
            WHERE u.user_id = ?
        `, [req.user.user_id]);

        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'server error' });
    }
});

app.delete('/api/teacher/subjects/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission' });
        }
        
        // Make sure the requested subject to delete belongs to this teacher or teacher is admin
        // Actually, the current subjects schema doesn't tightly couple to teacher ID strictly on deletion without a check,
        // but we'll allow standard cascade wipe for now based on parameter.
        const subject_id = req.params.id;
        
        await pool.query('DELETE FROM subjects WHERE subject_id = ?', [subject_id]);
        
        res.json({ ok: true, message: 'Subject deleted successfully.' });
    } catch (err) {
        console.error('Delete subject error:', err);
        res.status(500).json({ error: 'Failed to delete the subject completely.' });
    }
});

app.delete('/api/student/subjects/:id/unenroll', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({ error: 'No permission' });
        }
        
        const subject_id = req.params.id;
        const [[student]] = await pool.query('SELECT student_id FROM students WHERE user_id = ?', [req.user.user_id]);
        
        if (!student) return res.status(404).json({ error: 'Student profile not found' });
        
        await pool.query('DELETE FROM enrollments WHERE student_id = ? AND subject_id = ?', [student.student_id, subject_id]);
        
        res.json({ ok: true, message: 'Unenrolled successfully.' });
    } catch (err) {
        console.error('Unenroll subject error:', err);
        res.status(500).json({ error: 'Failed to unenroll from the subject.' });
    }
});
