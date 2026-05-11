const API_BASE = '/api';

const $ = id => document.getElementById(id);

const state = {
    registerRole: 'student',
};

function goToDashboardByRole(user) {
    if (!user || !user.role) {
        window.location.href = '/';
        return;
    }

    if (user.role === 'teacher') {
        window.location.href = '/teacher-home';
    } else if (user.role === 'student') {
        window.location.href = '/student-home';
    } else if (user.role === 'admin') {
        window.location.href = '/admin';
    } else {
        window.location.href = '/';
    }
}

function switchTab(tab) {
    const isLogin = tab === 'login';
    $('tab-login').classList.toggle('active', isLogin);
    $('tab-register').classList.toggle('active', !isLogin);
    $('login-form').hidden = !isLogin;
    $('register-form').hidden = isLogin;
    clearAllMessages();

    const firstInput = isLogin ? $('login-identifier') : $('reg-name');
    firstInput?.focus();
}

function setButtonLoading(button, loadingText, isLoading) {
    if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
    button.disabled = isLoading;
    button.textContent = isLoading ? loadingText : button.dataset.defaultText;
}

function setFieldError(id, message) {
    const el = $(id);
    if (!el) return;
    el.textContent = message || '';
}

function setStatus(id, message, type = 'error') {
    const el = $(id);
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('success', type === 'success');
}

function clearAllMessages() {
    document.querySelectorAll('.field-error, .hint').forEach(el => {
        el.textContent = '';
        el.classList.remove('success');
    });
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function updateRegisterRole(role) {
    state.registerRole = role;
    const isStudent = role === 'student';

    document.querySelectorAll('[data-register-role]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.registerRole === role);
    });

    $('student-fields').hidden = !isStudent;
    $('teacher-fields').hidden = isStudent;
    $('reg-email-label').textContent = isStudent ? 'อีเมล (ไม่บังคับ)' : 'อีเมล';
    $('reg-email').placeholder = isStudent ? 'student@school.ac.th' : 'teacher@school.ac.th';
    clearAllMessages();
}

function validateLogin() {
    clearAllMessages();
    const identifier = $('login-identifier').value.trim();
    const password = $('login-password').value;
    let ok = true;

    if (!identifier) {
        setFieldError('login-identifier-error', 'กรุณากรอก Username');
        ok = false;
    }

    if (!password) {
        setFieldError('login-password-error', 'กรุณากรอกรหัสผ่าน');
        ok = false;
    }

    return ok;
}

function validateRegister() {
    clearAllMessages();
    const name = $('reg-name').value.trim();
    const username = $('reg-username').value.trim();
    const studentCode = $('reg-studentid').value.trim();
    const email = $('reg-email').value.trim();
    const passcode = $('reg-passcode').value.trim();
    const password = $('reg-password').value;
    const confirmPassword = $('reg-confirm-password').value;
    let ok = true;

    if (!name) {
        setFieldError('reg-name-error', 'กรุณากรอกชื่อ-สกุล');
        ok = false;
    }

    if (!username) {
        setFieldError('reg-username-error', 'กรุณากรอก Username');
        ok = false;
    } else if (username.length < 3) {
        setFieldError('reg-username-error', 'Username ต้องมีอย่างน้อย 3 ตัวอักษร');
        ok = false;
    }

    if (state.registerRole === 'student' && !studentCode) {
        setFieldError('reg-studentid-error', 'กรุณากรอกรหัสนักเรียน');
        ok = false;
    }

    if (state.registerRole === 'teacher' && !email) {
        setFieldError('reg-email-error', 'กรุณากรอกอีเมล');
        ok = false;
    } else if (email && !isValidEmail(email)) {
        setFieldError('reg-email-error', 'รูปแบบอีเมลไม่ถูกต้อง');
        ok = false;
    }

    if (state.registerRole === 'teacher' && !passcode) {
        setFieldError('reg-passcode-error', 'กรุณากรอกรหัสยืนยันสำหรับครู');
        ok = false;
    }

    if (!password) {
        setFieldError('reg-password-error', 'กรุณากรอกรหัสผ่าน');
        ok = false;
    } else if (password.length < 8) {
        setFieldError('reg-password-error', 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
        ok = false;
    }

    if (!confirmPassword) {
        setFieldError('reg-confirm-error', 'กรุณายืนยันรหัสผ่าน');
        ok = false;
    } else if (password !== confirmPassword) {
        setFieldError('reg-confirm-error', 'รหัสผ่านไม่ตรงกัน');
        ok = false;
    }

    return ok;
}

function showRegisterServerError(message) {
    if (!message) {
        setStatus('reg-msg', 'สมัครสมาชิกไม่สำเร็จ');
        return;
    }

    if (message.includes('รหัสนักเรียน')) {
        setFieldError('reg-studentid-error', message);
    } else if (message.includes('Username')) {
        setFieldError('reg-username-error', message);
    } else if (message.includes('อีเมล')) {
        setFieldError('reg-email-error', message);
    } else if (message.includes('ครู')) {
        setFieldError('reg-passcode-error', message);
    } else if (message.includes('รหัสผ่าน')) {
        setFieldError('reg-password-error', message);
    } else {
        setStatus('reg-msg', message);
    }
}

async function submitLogin(event) {
    event.preventDefault();
    if (!validateLogin()) return;

    const button = $('btn-login');
    setButtonLoading(button, 'กำลังเข้าสู่ระบบ...', true);

    try {
        const res = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                usernameOrEmail: $('login-identifier').value.trim(),
                password: $('login-password').value
            })
        });
        const data = await res.json();
        if (!res.ok) {
            setStatus('login-msg', data.error || 'เข้าสู่ระบบไม่สำเร็จ');
            return;
        }
        localStorage.setItem('fa_token', data.token);
        localStorage.setItem('fa_user', JSON.stringify(data.user));
        setStatus('login-msg', 'เข้าสู่ระบบสำเร็จ กำลังพาไปหน้าหลัก...', 'success');
        goToDashboardByRole(data.user);
    } catch (err) {
        console.error(err);
        setStatus('login-msg', 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ');
    } finally {
        setButtonLoading(button, 'กำลังเข้าสู่ระบบ...', false);
    }
}

async function submitRegister(event) {
    event.preventDefault();
    if (!validateRegister()) return;

    const button = $('btn-register');
    setButtonLoading(button, 'กำลังสมัครสมาชิก...', true);

    try {
        const res = await fetch(`${API_BASE}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: $('reg-name').value.trim(),
                username: $('reg-username').value.trim(),
                email: $('reg-email').value.trim() || null,
                password: $('reg-password').value,
                role: state.registerRole,
                student_code: state.registerRole === 'student' ? $('reg-studentid').value.trim() : null,
                teacher_passcode: state.registerRole === 'teacher' ? $('reg-passcode').value.trim() : null
            })
        });
        const data = await res.json();
        if (!res.ok) {
            showRegisterServerError(data.error);
            return;
        }
        localStorage.setItem('fa_token', data.token);
        localStorage.setItem('fa_user', JSON.stringify(data.user));
        setStatus('reg-msg', 'สมัครสมาชิกสำเร็จ กำลังพาไปหน้าหลัก...', 'success');
        goToDashboardByRole(data.user);
    } catch (err) {
        console.error(err);
        setStatus('reg-msg', 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ');
    } finally {
        setButtonLoading(button, 'กำลังสมัครสมาชิก...', false);
    }
}

$('tab-login').addEventListener('click', () => switchTab('login'));
$('tab-register').addEventListener('click', () => switchTab('register'));
$('link-to-login').addEventListener('click', () => switchTab('login'));
$('link-to-register').addEventListener('click', () => switchTab('register'));

document.querySelectorAll('[data-register-role]').forEach(btn => {
    btn.addEventListener('click', () => updateRegisterRole(btn.dataset.registerRole));
});

document.querySelectorAll('.toggle-password').forEach(button => {
    button.addEventListener('click', () => {
        const input = $(button.dataset.target);
        const nextType = input.type === 'password' ? 'text' : 'password';
        input.type = nextType;
        button.textContent = nextType === 'password' ? 'แสดง' : 'ซ่อน';
        input.focus();
    });
});

$('login-form').addEventListener('submit', submitLogin);
$('register-form').addEventListener('submit', submitRegister);

updateRegisterRole('student');
