/* =====================================================
   Config + Helpers
===================================================== */
const API_BASE = '/api';

function getAuthHeaders() {
    const token = localStorage.getItem('fa_token');
    return {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
    };
}

function verifyAuth(res) {
    if (res.status === 401) {
        alert('Session expired. Please login again.');
        localStorage.removeItem('fa_token');
        localStorage.removeItem('fa_user');
        window.location.href = '/auth.html';
        throw new Error('Unauthorized');
    }
    return res;
}

const $ = sel => document.querySelector(sel);

/* =====================================================
   Logged user
===================================================== */
let loggedUser = null;
try {
    const raw = localStorage.getItem('fa_user');
    if (raw) loggedUser = JSON.parse(raw);
} catch { }

/* =====================================================
   Global State (DB-based)
===================================================== */
const state = {
    students: [],
    subjects: [],
    sessions: [],
    attendance: []
};

/* =====================================================
   Header UI (ชื่อผู้ใช้ + Logout) ✅ สำคัญ
===================================================== */
(function setupHeader() {
    const userEl = $('#user-display') || $('#current-user');
    if (userEl && loggedUser) {
        userEl.innerText = `${loggedUser.username} (${loggedUser.role})`;
    }

    const logoutBtn = $('#btn-logout');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            localStorage.removeItem('fa_user');
            localStorage.removeItem('fa_token');
            location.href = '/auth.html';
        };
    }
})();

/* =====================================================
   Init
===================================================== */
async function init() {
    await loadSubjectsFromApi();
    await loadStudentsFromApi();

    renderSubjectSelectors();

    // Auto-select based on URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const subjectIdParam = urlParams.get('subject_id');

    const sel = document.getElementById('teacher-subject-select');
    if (subjectIdParam && sel) {
        sel.value = subjectIdParam;

        // Update display name
        const displayName = document.getElementById('display-subject-name');
        if (displayName) {
            const foundSubj = state.subjects.find(s => s.subject_id == subjectIdParam);
            displayName.innerText = foundSubj ? foundSubj.subject_name : 'Unknown Subject';
        }
    }

    renderStudents();
    renderTeacherSummary();
    await renderAttendanceBySession(); // Ensure sessions load explicitly for the selected subject

    // Check Live Status
    await checkLiveStatus();
}

async function checkLiveStatus() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const subjectIdParam = urlParams.get('subject_id');
        const q = subjectIdParam ? `?subject_id=${subjectIdParam}` : '';

        const res = await fetch(`${API_BASE}/teacher/scan/status${q}`, {
            headers: getAuthHeaders()
        });
        verifyAuth(res);
        const data = await res.json();

        if (data.mode === 'scan') {
            // Restore scanning UI
            const sessionId = data.session_id;
            const subjectId = data.subject_id; // Now available
            const deviceId = data.device_id; 

            // Try to get subject name from "latest session" or "sessions" state if possible.
            // Since we might not have state loaded yet, let's fetch latest-session to check if it matches.
            // Or just a generic name.
            let subjName = 'Live Class';

            try {
                // Quick fetch of latest session to see if it matches
                const resLat = await fetch(`${API_BASE}/teacher/latest-session${q}`, { headers: getAuthHeaders() });
                const dataLat = await resLat.json();
                if (dataLat.session && dataLat.session.session_id == sessionId) {
                    subjName = dataLat.session.subject_name;
                }
            } catch (e) { console.log('Could not resolve subject name'); }

            startLiveMode({
                subject_id: subjectId, // Use correct ID
                session_id: sessionId,
                subject_name: subjName,
                device_id: deviceId,
                skipApi: true
            });
        } else {
            // IDLE -> Show Latest Session
            await fetchLatestSession();
        }
    } catch (e) { console.error(e); }
}

async function fetchLatestSession() {
    const urlParams = new URLSearchParams(window.location.search);
    const subjectIdParam = urlParams.get('subject_id');
    const q = subjectIdParam ? `?subject_id=${subjectIdParam}` : '';

    const res = await fetch(`${API_BASE}/teacher/latest-session${q}`, {
        headers: getAuthHeaders()
    });
    if (!res.ok) return;
    const data = await res.json();

    const bar = $('#live-status-bar');
    const content = $('#live-content');

    if (!bar) return; // Guard for pages without this element (e.g. Manage.html)

    if (!data.session) {
        bar.innerText = 'No class session history available.';
        bar.className = 'status-bar idle';
        resetLiveStats();
        return;
    }

    // Show Last Session Details
    const s = data.session;
    const dStr = formatDateTh(s.date);
    const tStr = formatTime(s.start_time);

    bar.innerText = `No live class session at the moment. (Last: ${s.subject_name} ${dStr} ${tStr})`;
    bar.className = 'status-bar idle';

    // Update stats
    if ($('#live-total')) $('#live-total').innerText = data.stats.total;
    if ($('#live-ontime')) $('#live-ontime').innerText = data.stats.present;
    if ($('#live-late')) $('#live-late').innerText = data.stats.late;
    if ($('#live-absent')) $('#live-absent').innerText = data.stats.absent;

    // Ensure content shows "Start New", Table Hidden in Idle
    content.style.display = 'flex';
    $('#live-attendance-table').style.display = 'none';
    if ($('#live-status-bar')) $('#live-status-bar').className = 'status-bar idle';
}

function resetLiveStats() {
    if ($('#live-total')) $('#live-total').innerText = '-';
    if ($('#live-ontime')) $('#live-ontime').innerText = '-';
    if ($('#live-late')) $('#live-late').innerText = '-';
    if ($('#live-absent')) $('#live-absent').innerText = '-';
}
init();

/* =====================================================
   Load from DB
===================================================== */
async function loadStudentsFromApi() {
    const urlParams = new URLSearchParams(window.location.search);
    const subjectIdParam = urlParams.get('subject_id');
    const queryStr = subjectIdParam ? `?subject_id=${subjectIdParam}` : '';

    const res = await fetch(`${API_BASE}/teacher/students${queryStr}`, {
        headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'load students error');

    state.students = data.students.map(s => ({
        db_id: s.student_id,
        student_code: s.student_code,
        name: s.full_name,
        year: s.year_level,
        fingerprint_id: s.fingerprint_id
    }));
}

async function loadSubjectsFromApi() {
    const res = await fetch(`${API_BASE}/teacher/subjects`, {
        headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) return;

    state.subjects = data.subjects;
}

/* =====================================================
   Subjects UI
===================================================== */
function renderSubjectSelectors() {
    const sel = $('#teacher-subject-select');
    if (!sel) return;

    sel.innerHTML = '<option value="">-- เลือกวิชา --</option>';
    state.subjects.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.subject_id;
        opt.textContent = s.subject_name;
        sel.appendChild(opt);
    });
}

/* =====================================================
   Students Table (Edit / Delete / Enroll ใช้ได้)
===================================================== */
function renderStudents() {
    const box = $('#students-table');
    if (!box) return;

    let html = `
  <table>
    <thead>
      <tr>
        <th>รหัส</th>
        <th>ชื่อ</th>
        <th>ชั้นปี</th>
        <th>Fingerprint</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>`;

    state.students.forEach(s => {
        html += `
      <tr>
        <td>${s.student_code}</td>
        <td>${s.name}</td>
        <td>${s.year ?? '-'}</td>
        <td>${s.fingerprint_id ? 'ID ' + s.fingerprint_id : 'Not Registered'}</td>
        <td class="table-actions">
          <button class="btn secondary" onclick="openEditStudent(${s.db_id})">Edit</button>
          <button class="btn" onclick="openEnrollFingerprint(${s.db_id})">Enroll</button>
          <button class="btn secondary" onclick="deleteStudent(${s.db_id})">Delete</button>
        </td>
      </tr>`;
    });

    html += '</tbody></table>';
    box.innerHTML = html;

    const total = $('#teacher-total-students');
    if (total) total.innerText = state.students.length;
}



async function openEnrollFingerprint(studentId) {
    const res = await fetch(`${API_BASE}/devices`, { headers: getAuthHeaders() });
    const data = await res.json();
    let opts = data.devices.map(d => `<option value="${d.device_id}">${d.room_name}</option>`).join('');

    showModal(`
        <h3>Enroll Fingerprint</h3>
        <p>Select the IoT Scanner to use:</p>
        <select id="enroll-device">${opts}</select>
        <div class="row actions" style="margin-top:15px">
            <button class="btn" onclick="enrollFingerprint(${studentId}, document.getElementById('enroll-device').value)">Start</button>
            <button class="btn secondary" onclick="closeModal()">Cancel</button>
        </div>
    `);
}

async function enrollFingerprint(studentId, deviceId) {
    if (!confirm('เริ่มลงทะเบียนลายนิ้วมือ?')) return;

    const res = await fetch(`${API_BASE}/teacher/enroll`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ student_id: studentId, device_id: deviceId })
    });

    const data = await res.json();
    alert(data.message + '\\n(โปรดสแกนนิ้วที่เครื่อง IoT... ระบบจะรีเฟรชเมื่อเสร็จสิ้น)');
    closeModal(); // close the scanner selection modal

    // Start Polling
    if (data.command_id) {
        const pollId = setInterval(async () => {
            try {
                const sRes = await fetch(`${API_BASE}/enroll/status/${data.command_id}`);
                if (!sRes.ok) return;
                const sData = await sRes.json();
                if (sData.status === 'done') {
                    clearInterval(pollId);
                    alert('ลงทะเบียนนิ้วมือเสร็จสมบูรณ์!');
                    loadStudentsFromApi(); // Refresh Table
                }
            } catch (err) {
                console.error(err);
                clearInterval(pollId);
            }
        }, 1000);
    }
}





/* =====================================================
   Add / Edit / Delete Student (DB)
===================================================== */
function openAddStudent() {
    showModal(`
    <h3>เพิ่มนักศึกษา</h3>
    <input id="new-code" placeholder="รหัสนักศึกษา">
    <input id="new-name" placeholder="ชื่อ–สกุล">
    <input id="new-year" placeholder="ชั้นปี">
    <div class="row actions">
      <button class="btn" onclick="addStudent()">Save</button>
      <button class="btn secondary" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

async function addStudent() {
    const code = $('#new-code').value.trim();
    const name = $('#new-name').value.trim();
    const year = $('#new-year').value.trim();

    if (!code || !name) return alert('กรอกข้อมูลไม่ครบ');

    const urlParams = new URLSearchParams(window.location.search);
    const subjectIdParam = urlParams.get('subject_id');

    await fetch(`${API_BASE}/teacher/students`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
            student_code: code,
            full_name: name,
            year_level: year ? parseInt(year) : null,
            subject_id: subjectIdParam
        })
    });

    await loadStudentsFromApi();
    closeModal();
    renderStudents();
}


function openEditStudent(id) {
    const s = state.students.find(x => x.db_id === id);
    if (!s) return;

    showModal(`
    <h3>แก้ไขนักศึกษา</h3>
    <input id="edit-code" value="${s.student_code}">
    <input id="edit-name" value="${s.name}">
    <input id="edit-year" value="${s.year ?? ''}">
    <div class="row actions">
      <button class="btn" onclick="saveEditStudent(${id})">Save</button>
      <button class="btn secondary" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

async function saveEditStudent(id) {
    await fetch(`${API_BASE}/teacher/students/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
            student_code: $('#edit-code').value,
            full_name: $('#edit-name').value,
            year_level: $('#edit-year').value || null
        })
    });

    await loadStudentsFromApi();
    closeModal();
    renderStudents();
}

async function deleteStudent(id) {
    if (!confirm('ลบใช่ไหม')) return;

    await fetch(`${API_BASE}/teacher/students/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
    });

    await loadStudentsFromApi();
    renderStudents();
}



/* =====================================================
   Subjects & Sessions
===================================================== */
function openAddSubject() {
    showModal(`
    <h3>Create Subject</h3>
    <input id="sub-name" placeholder="ชื่อวิชา">
    <div class="row actions">
      <button class="btn" onclick="saveSubject()">Save</button>
      <button class="btn secondary" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

async function saveSubject() {
    await fetch(`${API_BASE}/teacher/subjects`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ subject_name: $('#sub-name').value })
    });

    await loadSubjectsFromApi();
    renderSubjectSelectors();
    closeModal();
}

function openCreateSession() {
    alert('Create Session (ต่อ DB ได้ทันที)');
}

function simulateScan() {
    alert('Scan (simulate)');
}

/* =====================================================
   Attendance + Summary
===================================================== */
function renderAttendanceBySession() {
    const box = $('#attendance-table');
    if (box) box.innerHTML = '<div class="muted">ยังไม่มีข้อมูล</div>';
}

function renderTeacherSummary() {
    const cur = $('#teacher-current-session');
    const cnt = $('#teacher-present-count');
    if (cur) cur.innerText = 'No session';
    if (cnt) cnt.innerText = '0';
}

/* =====================================================
   Modal helpers
===================================================== */
function showModal(html) {
    $('#modal').innerHTML = html;
    $('#modal-backdrop').style.display = 'flex';
}

function closeModal() {
    $('#modal-backdrop').style.display = 'none';
    $('#modal').innerHTML = '';
}

async function openStartScan() {
    const urlParams = new URLSearchParams(window.location.search);
    const subjectIdParam = urlParams.get('subject_id');

    const options = state.subjects
        .filter(s => subjectIdParam ? s.subject_id == subjectIdParam : true)
        .map(s => `<option value="${s.subject_id}" selected>${s.subject_name}</option>`)
        .join('');

    const devRes = await fetch(`${API_BASE}/devices`, { headers: getAuthHeaders() });
    const devData = await devRes.json();
    const devOpts = devData.devices.map(d => `<option value="${d.device_id}">${d.room_name}</option>`).join('');

    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5); // HH:mm

    showModal(`
    <h3>Start scan</h3>

    <div class="form-row" style="flex-direction:column; align-items:flex-start; gap:12px;">
        <div style="display:flex; align-items:center; gap:10px;">
            <label style="width:80px">วิชา</label>
            <select id="new-subject" disabled>${options}</select>
        </div>

        <div style="display:flex; align-items:center; gap:10px;">
             <label style="width:80px">เครื่องสแกน</label>
             <select id="new-device">${devOpts}</select>
        </div>

        <div style="display:flex; align-items:center; gap:10px;">
             <label style="width:80px">เวลาเริ่ม</label>
             <input id="new-start" type="time" value="${timeStr}" readonly style="background:#f3f4f6">
        </div>
        
        <div style="display:flex; align-items:center; gap:10px;">
             <label style="width:120px">สายหลัง (นาที)</label>
             <input id="new-late" type="number" value="15" style="width:100px">
        </div>

        <div style="display:flex; align-items:center; gap:10px;">
             <label style="width:120px">ขาดหลัง (นาที)</label>
             <input id="new-absent" type="number" value="60" style="width:100px">
        </div>
    </div>

    <div class="row actions" style="margin-top:20px">
      <button class="btn" onclick="createSession()">ยืนยัน</button>
      <button class="btn secondary" onclick="closeModal()">ยกเลิก</button>
    </div>
  `);
}


async function createSession() {
    const subject_id = $('#new-subject').value;
    const device_id = $('#new-device').value;
    const start = $('#new-start').value;
    const late = $('#new-late').value;
    const absent = $('#new-absent').value;

    // Fix: Use local Thailand date instead of UTC ISO date
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-CA'); // en-CA gives YYYY-MM-DD format reliably

    if (!subject_id || !start || !device_id) {
        alert('กรอกข้อมูลไม่ครบ');
        return;
    }

    const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
            subject_id,
            date: dateStr,
            start_time: start,
            late_condition: late,
            absent_condition: absent
        })
    });

    const data = await res.json();
    if (!res.ok) {
        alert(data.error || 'สร้าง session ไม่สำเร็จ');
        return;
    }

    // New: Immediately Start Scan Mode
    const session_id = data.session_id; // Server must return session_id

    // Find subject name for display
    const subjName = $('#new-subject option:checked').text;

    await startLiveMode({ subject_id, session_id, subject_name: subjName, device_id: device_id });

    closeModal();
}

async function startLiveMode({ subject_id, session_id, subject_name, device_id, skipApi = false }) {
    // 1. Tell Server to Start Scan (only if not restoring)
    if (!skipApi) {
        await fetch(`${API_BASE}/teacher/scan/start`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ subject_id, session_id, device_id })
        });
    }

    // 2. UI Updates
    window.currentLiveSessionId = session_id; // store for edit mode
    const content = $('#live-content');
    const tableContainer = $('#live-attendance-table');
    const statusBar = $('#live-status-bar');
    const stopBtn = $('#btn-stop-class');
    const editBtn = $('#btn-edit-attendance');
    const rulesBtn = $('#btn-edit-rules');

    content.style.display = 'none'; // Hide ZZZ/Button
    tableContainer.style.display = 'block'; // Show Table
    if (stopBtn) stopBtn.style.display = 'inline-block'; // Show Stop Button
    if (editBtn) {
        editBtn.style.display = 'inline-block';
        editBtn.innerText = 'Edit Attendance';
        editBtn.className = 'btn secondary';
    }
    if (rulesBtn) rulesBtn.style.display = 'inline-block';

    statusBar.className = 'status-bar active';
    statusBar.innerText = `กำลังบันทึกเวลาเรียน: ${subject_name} (อุปกรณ์: ${device_id || 'N/A'})`;

    // 3. Start Polling
    if (window.liveInterval) clearInterval(window.liveInterval);
    fetchLiveAttendance(subject_id, session_id);
    window.liveInterval = setInterval(() => {
        fetchLiveAttendance(subject_id, session_id);
    }, 2000);
}

function showEnrollmentGuide() {
    showModal(`
        <h2 style="margin-bottom: 20px;">📘 Enrollment Guide</h2>
        <div style="text-align: left; line-height: 1.6; font-size: 15px;">
            <p><strong>ขั้นตอนการลงทะเบียนลายนิ้วมือนักศึกษา:</strong></p>
            <ol style="padding-left: 20px; margin-bottom: 15px;">
                <li>ไปที่หน้า <span style="color: var(--primary); font-weight: 600;">Manage Students</span> ของวิชานั้นๆ</li>
                <li>คลิกปุ่ม <span style="background: var(--primary); color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">Enroll</span> ในแถวของนักศึกษาที่ต้องการ</li>
                <li>เลือกเครื่องสแกน (IoT Device) ที่ต้องการใช้งานแล้วกด Start</li>
                <li>ให้นักศึกษาวางนิ้วบนเครื่องสแกน <span style="color: var(--danger); font-weight: 600;">2 ครั้ง</span> ตามคำแนะนำบนหน้าจอเครื่อง IoT</li>
                <li>เมื่อขึ้นข้อความ Success ระบบจะบันทึกข้อมูลลงฐานข้อมูลโดยอัตโนมัติ</li>
            </ol>
            <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border-left: 4px solid var(--warning);">
                <p class="muted" style="font-size: 13px; margin: 0;">
                    💡 <strong>คำแนะนำ:</strong> หากสแกนไม่ติด หรือขึ้น Unknown Fingerprint บ่อยครั้ง ให้ลองลบและลงทะเบียนนิ้วเดิมใหม่อีกครั้งโดยวางนิ้วให้เต็มเซนเซอร์
                </p>
            </div>
        </div>
        <div class="row actions" style="margin-top:24px; justify-content: flex-end;">
            <button class="btn" onclick="closeModal()">เข้าใจแล้ว</button>
        </div>
    `);
}


async function loadSessionsFromApi() {
    const subjectId = $('#teacher-subject-select')?.value || '';

    if (!subjectId) {
        state.sessions = [];
        return;
    }

    const res = await fetch(
        `${API_BASE}/teacher/sessions?subject_id=${subjectId}`,
        { headers: getAuthHeaders() }
    );

    const data = await res.json();
    if (!res.ok) return;

    state.sessions = data.sessions;
}


async function renderAttendanceBySession() {
    const sessSel = $('#teacher-session-select');
    if (!sessSel) return;

    await loadSessionsFromApi();   // ⭐ ดึงจาก DB จริง

    sessSel.innerHTML = '<option value="">-- เลือกรอบเรียน --</option>';

    if (state.sessions.length === 0) {
        const subjectId = $('#teacher-subject-select')?.value || '';
        if (!subjectId) {
            sessSel.innerHTML = '<option value="">-- กรุณาเลือกวิชาก่อน --</option>';
            $('#attendance-table').innerHTML = '<div class="muted">กรุณาเลือกวิชาและรอบเรียน</div>';
        } else {
            sessSel.innerHTML = '<option value="">-- ไม่มีรอบเรียน --</option>';
            $('#attendance-table').innerHTML = '<div class="muted">รายวิชานี้ยังไม่มีการสร้างรอบเรียน</div>';
        }
    }

    state.sessions.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.session_id;
        const dateStr = formatDateTh(s.date);
        const timeStr = formatTime(s.start_time);
        opt.textContent = `${dateStr} ${timeStr}`;
        sessSel.appendChild(opt);
    });
}



function openScanModal() {
    const urlParams = new URLSearchParams(window.location.search);
    const subjectIdParam = urlParams.get('subject_id');

    const subjectOptions = state.subjects
        .filter(s => subjectIdParam ? s.subject_id == subjectIdParam : true)
        .map(s => `<option value="${s.subject_id}" selected>${s.subject_name}</option>`)
        .join('');

    showModal(`
    <div class="flex-between">
      <h3>Scan Attendance</h3>
      <button class="btn secondary" onclick="closeModal()">Close</button>
    </div>

    <div style="margin-top:12px">
      <div class="form-row">
        <label>วิชา</label>
        <select id="scan-subject" onchange="loadSessionsForScan()" disabled>
          ${subjectOptions}
        </select>
      </div>

      <div class="form-row">
        <label>รอบเรียน</label>
        <select id="scan-session">
          <option value="">-- เลือกรอบเรียน --</option>
        </select>
      </div>

      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn" onclick="startScan()">Start Scan</button>
        <button class="btn secondary" onclick="stopScan()">Stop</button>
      </div>
    </div>
  `);
    // Automatically load the sessions for this subject
    loadSessionsForScan();
}

function loadSessionsForScan() {
    const subjectId = document.getElementById('scan-subject').value;
    const sessionSel = document.getElementById('scan-session');

    sessionSel.innerHTML = '<option value="">-- เลือกรอบเรียน --</option>';

    if (!subjectId) return;

    const sessions = state.sessions.filter(
        s => s.subject_id == subjectId
    );

    sessions.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.session_id;
        opt.textContent = `${s.date} ${s.start_time}`;
        sessionSel.appendChild(opt);
    });
}


// startScan is now mostly redundant if we use startLiveMode, 
// but if "Scan" button exists separately (re-scan existing), keep it compatible.
async function startScan() {
    const subjSel = document.getElementById('scan-subject');
    const sessSel = document.getElementById('scan-session');

    if (!subjSel.value || !sessSel.value) { return alert('Select subject/session'); }

    const subject = state.subjects.find(s => s.subject_id == subjSel.value);
    const session_id = sessSel.value;

    await startLiveMode({
        subject_id: subject.subject_id,
        session_id: session_id,
        subject_name: subject.subject_name
    });

    closeModal();
}

async function fetchLiveAttendance(subjectId, sessionId) {
    try {
        const res = await fetch(
            `/api/teacher/attendance?subject_id=${subjectId}&session_id=${sessionId}`,
            { headers: getAuthHeaders() }
        );
        verifyAuth(res);

        if (!res.ok) return;

        const data = await res.json();
        window.liveRecordsCache = data.records;
        if (!window.isEditingLive) {
            renderLiveTable(data.records);
        }
        updateLiveStats(data.records);
    } catch (e) {
        // Stop polling if unauthorized or other error
        if (e.message === 'Unauthorized') {
            if (window.liveInterval) clearInterval(window.liveInterval);
        }
        console.error(e);
    }
}

function renderLiveTable(rows) {
    const box = document.getElementById('live-attendance-table');
    if (!rows.length) {
        box.innerHTML = '<div class="muted">ยังไม่มีข้อมูลการสแกน</div>';
        return;
    }

    let html = `
    <table>
        <thead>
            <tr>
                <th>รหัส</th>
                <th>ชื่อ</th>
                <th>สถานะ</th>
                <th>เวลาเช็กชื่อ</th>
            </tr>
        </thead>
        <tbody>`;

    rows.forEach(r => {
        let displayStatus = r.status;
        if (displayStatus === 'Absent') displayStatus = 'Not scanned'; // Initial state display
        if (r.status === 'Present') displayStatus = 'Present';

        let statusHtml = '';
        if (window.isEditingLive) {
            const possibleStatuses = ['Present', 'Late', 'Absent'];
            statusHtml = `<select class="live-edit-status" data-id="${r.student_id}">
                ${possibleStatuses.map(s => `<option value="${s}" ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>`;
        } else {
            statusHtml = `<span class="${statusClass(displayStatus)}">${displayStatus}</span>`;
        }

        html += `
        <tr>
            <td>${r.student_code}</td>
            <td>${r.full_name}</td>
            <td>${statusHtml}</td>
            <td>${r.time_stamp ? formatDateTimeTh(r.time_stamp) : '-'}</td>
        </tr>`;
    });
    html += '</tbody></table>';
    box.innerHTML = html;
}

window.isEditingLive = false;
window.liveRecordsCache = [];

async function toggleEditLiveAttendance() {
    window.isEditingLive = !window.isEditingLive;
    const btn = $('#btn-edit-attendance');

    if (window.isEditingLive) {
        btn.innerText = 'Save Changes';
        btn.className = 'btn success';
        // Re-render table with selects using cached data
        renderLiveTable(window.liveRecordsCache || []);
    } else {
        btn.innerText = 'Saving...';
        btn.className = 'btn secondary';
        
        // Gather edits
        const selects = document.querySelectorAll('.live-edit-status');
        const overrides = [];
        selects.forEach(sel => {
            overrides.push({
                student_id: sel.dataset.id,
                status: sel.value
            });
        });

        if (overrides.length > 0 && window.currentLiveSessionId) {
            try {
                await fetch(`${API_BASE}/teacher/attendance/override`, {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        session_id: window.currentLiveSessionId,
                        overrides: overrides
                    })
                });
            } catch (err) {
                console.error('Failed to save attendance overrides:', err);
                alert('Save failed.');
            }
        }
        
        btn.innerText = 'Edit Attendance';
        // Immediately fetch to show updated static rows
        const subjectIdParam = new URLSearchParams(window.location.search).get('subject_id');
        fetchLiveAttendance(subjectIdParam, window.currentLiveSessionId);
    }
}

async function openEditTimeRules() {
    if (!window.currentLiveSessionId) return;

    // Fetch current rules
    try {
        const res = await fetch(`${API_BASE}/teacher/sessions/${window.currentLiveSessionId}`, {
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const s = data.session;
        showModal(`
            <h3>⚙️ Edit Session Time Rules</h3>
            <p class="muted">Adjusting these parameters will instantly re-evaluate existing automated attendance scans matching this session.</p>

            <div class="form-row" style="flex-direction:column; align-items:flex-start; gap:12px; margin-top:20px;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <label style="width:120px">สายหลัง (นาที)</label>
                    <input id="edit-late" type="number" value="${s.late_condition}" style="width:80px">
                </div>

                <div style="display:flex; align-items:center; gap:10px;">
                    <label style="width:120px">ขาดหลัง (นาที)</label>
                    <input id="edit-absent" type="number" value="${s.absent_condition}" style="width:80px">
                </div>
            </div>

            <div class="row actions" style="margin-top:20px">
                <button class="btn" onclick="saveTimeRules()">บันทึก (Save Changes)</button>
                <button class="btn secondary" onclick="closeModal()">ยกเลิก</button>
            </div>
        `);
    } catch (e) {
        alert('Failed to load session rules');
    }
}

async function saveTimeRules() {
    const late = $('#edit-late').value;
    const absent = $('#edit-absent').value;

    try {
        const res = await fetch(`${API_BASE}/teacher/sessions/${window.currentLiveSessionId}/rules`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ late_condition: late, absent_condition: absent })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        closeModal();
        alert('อัปเดตกฎและคำนวณเวลาเข้าเรียนใหม่สำเร็จ');
        
        // Refresh table display instantly
        const subjectIdParam = new URLSearchParams(window.location.search).get('subject_id');
        fetchLiveAttendance(subjectIdParam, window.currentLiveSessionId);

    } catch (e) {
        alert('Save failed: ' + e.message);
    }
}

function updateLiveStats(records) {
    const total = records.length;
    const present = records.filter(r => r.status === 'Present').length;
    const late = records.filter(r => r.status === 'Late').length;
    const absent = records.filter(r => r.status === 'Absent').length;

    if ($('#live-total')) $('#live-total').innerText = total;
    if ($('#live-ontime')) $('#live-ontime').innerText = present;
    if ($('#live-late')) $('#live-late').innerText = late;
    if ($('#live-absent')) $('#live-absent').innerText = absent;
}

async function stopScan() {
    if (window.liveInterval) clearInterval(window.liveInterval);

    const urlParams = new URLSearchParams(window.location.search);
    const subjectIdParam = urlParams.get('subject_id');

    await fetch(`${API_BASE}/teacher/scan/stop`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ subject_id: subjectIdParam })
    });

    // Reset UI to Idle
    $('#live-content').style.display = 'flex'; // Show Start Button
    $('#live-attendance-table').style.display = 'none'; // Hide Table
    if ($('#btn-stop-class')) $('#btn-stop-class').style.display = 'none'; // Hide Stop Button
    if ($('#btn-edit-attendance')) $('#btn-edit-attendance').style.display = 'none'; // Hide Edit Button
    if ($('#btn-edit-rules')) $('#btn-edit-rules').style.display = 'none'; // Hide Rules Button
    window.isEditingLive = false;

    // Refresh Idle Status (Last Session)
    await fetchLatestSession();
}


async function filterAttendance() {
    const subjectId = document.getElementById('teacher-subject-select').value;
    const sessionId = document.getElementById('teacher-session-select').value;

    if (!subjectId || !sessionId) {
        alert('กรุณาเลือกวิชาและรอบเรียน');
        return;
    }

    const res = await fetch(
        `/api/teacher/attendance?subject_id=${subjectId}&session_id=${sessionId}`,
        { headers: getAuthHeaders() }
    );

    const data = await res.json();
    if (!res.ok) {
        alert(data.error || 'โหลดข้อมูลไม่สำเร็จ');
        return;
    }

    renderAttendanceTable(data.records);
}


/* =====================================================
   Helpers: Date/Time Formatting
===================================================== */
function formatDateTh(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatDateTimeTh(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatTime(timeStr) {
    if (!timeStr) return '';
    // timeStr might be "09:00:00", we want "09:00"
    return timeStr.split(':').slice(0, 2).join(':');
}


/* helper for status color */
function statusClass(status) {
    if (status === 'Present') return 'chip chip-green';
    if (status === 'Late') return 'chip chip-yellow';
    if (status === 'Absent') return 'chip danger';
    return 'chip';
}

function renderAttendanceTable(rows) {
    if (!rows.length) {
        document.getElementById('attendance-table').innerHTML =
            '<div class="muted">ไม่มีข้อมูล</div>';
        return;
    }

    let html = `
    <table>
        <thead>
            <tr>
                <th>รหัส</th>
                <th>ชื่อ</th>
                <th>วันที่</th>
                <th>เวลา</th>
                <th>สถานะ</th>
                <th>เวลาเช็กชื่อ</th>
            </tr>
        </thead>
        <tbody>`;

    rows.forEach(r => {
        html += `
        <tr>
            <td>${r.student_code}</td>
            <td>${r.full_name}</td>
            <td>${formatDateTh(r.date)}</td>
            <td>${formatTime(r.start_time)} - ${r.end_time ? formatTime(r.end_time) : ''}</td>
            <td><span class="${statusClass(r.status)}">${r.status}</span></td>
            <td>${r.time_stamp ? formatDateTimeTh(r.time_stamp) : '-'}</td>
        </tr>`;
    });

    html += '</tbody></table>';

    document.getElementById('attendance-table').innerHTML = html;
}

// ===================== Co-Teacher Management =====================
async function openManageCoTeachers() {
    const urlParams = new URLSearchParams(window.location.search);
    const subjectId = urlParams.get('subject_id');
    if (!subjectId) return alert('No subject selected');

    // Fetch current teachers for this subject
    const res = await fetch(`${API_BASE}/teacher/subjects/${subjectId}/co-teachers`, { headers: getAuthHeaders() });
    if (!res.ok) return alert('Failed to load co-teachers');
    const data = await res.json();

    // Fetch available teachers to add
    const availRes = await fetch(`${API_BASE}/teacher/available-co-teachers`, { headers: getAuthHeaders() });
    const availData = await availRes.json();

    let currentHtml = '<ul style="list-style: none; padding: 0; margin-bottom: 20px;">';
    data.teachers.forEach(t => {
        currentHtml += `
            <li style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee;">
                <div>
                    <strong>${t.full_name}</strong>
                    <div style="font-size: 12px; color: #666;">Role: ${t.role} | Email: ${t.email || '-'}</div>
                </div>
                ${t.role !== 'primary' ? `<button class="btn danger" style="padding: 4px 8px; font-size: 12px;" onclick="removeCoTeacher(${subjectId}, ${t.teacher_id})">Remove</button>` : ''}
            </li>
        `;
    });
    currentHtml += '</ul>';

    let availHtml = '<select id="add-coteacher-select" style="width: 100%; margin-bottom: 12px;">';
    availHtml += '<option value="">-- Select Teacher to Add --</option>';
    
    // Filter out teachers already in the list
    const existingIds = data.teachers.map(t => t.teacher_id);
    const toAdd = availData.teachers.filter(t => !existingIds.includes(t.teacher_id));
    
    if (toAdd.length === 0) {
        availHtml = '<p class="muted">No other teachers available to add.</p>';
    } else {
        toAdd.forEach(t => {
            availHtml += `<option value="${t.teacher_id}">${t.full_name}</option>`;
        });
        availHtml += '</select>';
    }

    showModal(`
        <h3>Manage Co-Teachers</h3>
        <p class="muted" style="margin-bottom: 16px;">Grant other teachers access to manage this course.</p>
        
        <h4>Current Access</h4>
        ${currentHtml}
        
        <h4>Add Co-Teacher</h4>
        ${availHtml}
        
        <div class="row actions" style="margin-top: 20px;">
            ${toAdd.length > 0 ? `<button class="btn" style="background-color: #f97316; border: none;" onclick="addCoTeacher(${subjectId})">Add</button>` : ''}
            <button class="btn secondary" onclick="closeModal()">Close</button>
        </div>
    `);
}

async function addCoTeacher(subjectId) {
    const sel = document.getElementById('add-coteacher-select');
    if (!sel || !sel.value) return alert('Please select a teacher.');

    const res = await fetch(`${API_BASE}/teacher/subjects/${subjectId}/co-teachers`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ teacher_id: sel.value })
    });

    if (res.ok) {
        openManageCoTeachers(); // reload modal
    } else {
        alert('Failed to add co-teacher');
    }
}

async function removeCoTeacher(subjectId, teacherId) {
    if (!confirm('Are you sure you want to remove this teacher?')) return;

    const res = await fetch(`${API_BASE}/teacher/subjects/${subjectId}/co-teachers/${teacherId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
    });

    if (res.ok) {
        openManageCoTeachers(); // reload modal
    } else {
        alert('Failed to remove co-teacher');
    }
}
