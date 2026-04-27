const API_BASE = '/api';

const $ = sel => document.querySelector(sel);

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
        window.location.href = '/auth';
        throw new Error('Unauthorized');
    }
    return res;
}

let loggedUser = null;
try {
    const raw = localStorage.getItem('fa_user');
    if (raw) loggedUser = JSON.parse(raw);
} catch { }

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
            location.href = '/auth';
        };
    }
})();

async function loadMyProfile() {
    const res = await fetch(`${API_BASE}/me`, {
        headers: getAuthHeaders()
    });
    verifyAuth(res);

    const data = await res.json();
    if (!res.ok) {
        alert(data.error || 'Failed to load user info');
        return;
    }

    const nameStr = data.user.full_name || data.user.username || 'Teacher';
    const emailStr = data.user.email || '-';

    const greeting = document.getElementById('greeting-title');
    if (greeting) greeting.innerText = `Hi, ${nameStr}!`;

    const profileInitials = document.getElementById('profile-initials');
    if (profileInitials) {
        profileInitials.innerText = nameStr.substring(0, 2).toUpperCase();
    }

    const profileName = document.getElementById('profile-name');
    if (profileName) {
        profileName.innerText = nameStr;
    }

    const profileEmail = document.getElementById('profile-email');
    if (profileEmail) {
        profileEmail.innerText = `Email: ${emailStr}`;
    }
}

async function loadTeacherSubjects() {
    const res = await fetch(`${API_BASE}/teacher/subjects?t=${Date.now()}`, {
        headers: getAuthHeaders()
    });
    verifyAuth(res);

    const data = await res.json();
    if (!res.ok) {
        console.error('API Error:', data.error);
        return;
    }

    const container = document.getElementById('teacher-my-courses-container');
    if (!container) return;

    if (!data.subjects || data.subjects.length === 0) {
        container.innerHTML = '<div class="muted">You have not created any courses yet. Click the button above to create one.</div>';
        return;
    }

    let cardsHtml = '';
    data.subjects.forEach(s => {
        cardsHtml += `
            <div class="card" style="padding: 0; position: relative; cursor:pointer; flex: 1 1 200px; text-align:center; overflow: hidden; transition: transform 0.2s;" onclick="focusOnSubject(${s.subject_id})" onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'">
                <button onclick="event.stopPropagation(); deleteSubject(${s.subject_id}, '${s.subject_name}')" style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.05); border:none; border-radius: 8px; padding: 6px 8px; cursor: pointer; transition: all 0.2s; z-index: 10;" title="Delete Subject" onmouseover="this.style.background='rgba(239, 68, 68, 0.1)'; this.style.color='#dc2626'" onmouseout="this.style.background='rgba(0,0,0,0.05)'; this.style.color='inherit'">🗑️</button>
                <div style="padding: 24px 16px;">
                    <div style="font-size: 32px; margin-bottom: 12px;">🏫</div>
                    <div style="font-weight: 600; color: var(--text); font-size: 16px;">${s.subject_name}</div>
                    ${s.academic_year ? `<div style="font-size: 13px; color: var(--muted); margin-top: 4px;">ปีการศึกษา: ${s.academic_year}</div>` : ''}
                    <div class="muted" style="font-size: 13px; margin-top: 8px;">Click to manage course</div>
                </div>
            </div>
        `;
    });

    container.innerHTML = cardsHtml;
}

function focusOnSubject(subjectId) {
    window.location.href = `/teacher/${subjectId}`;
}

/* Modal Helpers */
function showModal(html) {
    $('#modal').innerHTML = html;
    $('#modal-backdrop').style.display = 'flex';
}

function closeModal() {
    $('#modal-backdrop').style.display = 'none';
    $('#modal').innerHTML = '';
}

function openAddSubject() {
    showModal(`
    <h3>Create Subject</h3>
    <div class="form-row" style="flex-direction: column;">
        <input id="sub-name" placeholder="ชื่อวิชา / Subject Name" style="width: 100%;">
        <input id="sub-year" placeholder="ปีการศึกษา / Academic Year (e.g. 2567/1)" style="margin-bottom: 8px; width: 100%;">
    </div>
    <div class="row actions" style="margin-top: 16px;">
      <button class="btn success" onclick="saveSubject()">Save</button>
      <button class="btn secondary" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

async function deleteSubject(subjectId, subjectName) {
    if (!confirm(`WARNING: Are you sure you want to completely delete the subject "${subjectName}"? This action cannot be undone.`)) {
        return;
    }

    try {
        const res = await fetch(`/api/teacher/subjects/${subjectId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        const data = await res.json();

        if (res.ok && data.ok) {
            alert('Subject successfully deleted.');
            loadTeacherSubjects();
        } else {
            alert(data.error || 'Failed to delete the subject.');
        }
    } catch (e) {
        console.error(e);
        alert('Server error while deleting.');
    }
}

async function saveSubject() {
    const res = await fetch(`${API_BASE}/teacher/subjects`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ 
            subject_name: $('#sub-name').value,
            academic_year: $('#sub-year').value
        })
    });

    if (res.ok) {
        await loadTeacherSubjects();
        closeModal();
    } else {
        const data = await res.json();
        alert(data.error || 'Failed to create subject');
    }
}

async function init() {
    try {
        await loadMyProfile();
        await loadTeacherSubjects();
    } catch (e) {
        console.error('Init failed', e);
    }
}

init();
