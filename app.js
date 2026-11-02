/**
 * app.js
 * College Event Management System - UI Controller & Event Handlers
 * Uses Supabase Auth & PostgreSQL Backend via supabase-client.js
 */

// Global State
let attendanceChartInstance = null;
let currentVerifiedAttendee = null;
let html5QrScanner = null;
let isScannerActive = false;
let studentSearchQuery = '';
let adminSearchQuery = '';

// ============================================================================
// CLOCK & BASIC UI UTILITIES
// ============================================================================

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) btn.textContent = '🙈';
  } else {
    input.type = 'password';
    if (btn) btn.textContent = '👁️';
  }
}

function updateClock() {
  const el = document.getElementById('liveClock');
  if (!el) return;
  const now = new Date();
  const datePart = now.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit' });
  const timePart = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  el.textContent = `${timePart} · ${datePart}`;
}
setInterval(updateClock, 1000);
updateClock();

function showModal(title, message, type = 'info') {
  const modal = document.getElementById('customModal');
  if (!modal) return;
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMessage').textContent = message;
  const icon = document.getElementById('modalIcon');
  if (type === 'success') {
    icon.textContent = '✅';
    icon.className = 'w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-lg';
  } else if (type === 'error') {
    icon.textContent = '⚠️';
    icon.className = 'w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center font-bold text-lg';
  } else {
    icon.textContent = 'ℹ️';
    icon.className = 'w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg';
  }
  modal.classList.remove('hidden');
}

function closeCustomModal() {
  const modal = document.getElementById('customModal');
  if (modal) modal.classList.add('hidden');
}

function renderSkeletonCards(container, count = 2) {
  if (!container) return;
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="p-4 rounded-xl border border-slate-200/80 bg-white space-y-3">
        <div class="flex items-center justify-between">
          <div class="h-4 w-44 rounded-md skeleton-box"></div>
          <div class="h-6 w-20 rounded-full skeleton-box"></div>
        </div>
        <div class="h-3 w-32 rounded-md skeleton-box"></div>
        <div class="h-3 w-full rounded-md skeleton-box"></div>
      </div>
    `;
  }
  container.innerHTML = html;
}

// ============================================================================
// PORTAL & SUB-WINDOW SWITCHING
// ============================================================================
function switchWindow(windowName) {
  const studentWin = document.getElementById('studentWindow');
  const adminWin = document.getElementById('adminWindow');
  const studentBtn = document.getElementById('tabStudentBtn');
  const adminBtn = document.getElementById('tabAdminBtn');
  const headerSub = document.getElementById('headerSub');

  if (windowName === 'student') {
    studentWin.classList.remove('hidden');
    adminWin.classList.add('hidden');
    studentBtn.className = 'px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 bg-blue-600 text-white shadow-md';
    adminBtn.className = 'px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 text-slate-300 hover:text-white';
    headerSub.textContent = 'Student portal & event registrations';
  } else {
    studentWin.classList.add('hidden');
    adminWin.classList.remove('hidden');
    adminBtn.className = 'px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 bg-amber-500 text-white shadow-md';
    studentBtn.className = 'px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 text-slate-300 hover:text-white';
    headerSub.textContent = 'Admin management & ticket verification gateway';
  }
}

function switchStudentSub(subName) {
  const regSub = document.getElementById('subWindowRegister');
  const loginSub = document.getElementById('subWindowLogin');
  const dashSub = document.getElementById('subWindowDashboard');
  const btnReg = document.getElementById('subBtnRegister');
  const btnLogin = document.getElementById('subBtnLogin');
  const btnDash = document.getElementById('subBtnDashboard');
  const statusText = document.getElementById('studentStatusText');

  const currentUser = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;

  // Protect dashboard: never show unless actively authenticated
  if (!currentUser && subName === 'dashboard') {
    subName = 'login';
  }

  regSub.classList.add('hidden');
  loginSub.classList.add('hidden');
  dashSub.classList.add('hidden');

  btnReg.className = 'px-4 py-1.5 rounded-full text-xs font-semibold transition-all text-slate-600 hover:text-slate-900';
  btnLogin.className = 'px-4 py-1.5 rounded-full text-xs font-semibold transition-all text-slate-600 hover:text-slate-900';
  btnDash.className = 'px-4 py-1.5 rounded-full text-xs font-semibold transition-all text-slate-600 hover:text-slate-900';

  if (!currentUser) {
    // Logged out: show Register & Login tabs, keep Dashboard tab hidden
    btnDash.classList.add('hidden');
    btnReg.classList.remove('hidden');
    btnLogin.classList.remove('hidden');
    if (statusText) statusText.innerHTML = 'Register or login with your email address.';
  } else {
    // Logged in: show Dashboard tab only, hide Register & Login
    btnDash.classList.remove('hidden');
    btnReg.classList.add('hidden');
    btnLogin.classList.add('hidden');
    if (statusText) statusText.innerHTML = 'Active session. View available events and your passes.';
  }

  if (subName === 'register') {
    regSub.classList.remove('hidden');
    btnReg.className = 'px-4 py-1.5 rounded-full text-xs font-semibold transition-all bg-white text-slate-900 shadow-sm';
  } else if (subName === 'login') {
    loginSub.classList.remove('hidden');
    btnLogin.className = 'px-4 py-1.5 rounded-full text-xs font-semibold transition-all bg-white text-slate-900 shadow-sm';
  } else if (subName === 'dashboard') {
    dashSub.classList.remove('hidden');
    btnDash.className = 'px-4 py-1.5 rounded-full text-xs font-semibold transition-all bg-white text-slate-900 shadow-sm';
    renderStudentDashboard();
  }
}

function toggleAdminDashboardView(isLoggedIn) {
  const loginCard = document.getElementById('adminLoginCard');
  const dashboardContent = document.getElementById('adminDashboardContent');
  if (isLoggedIn) {
    loginCard.classList.add('hidden');
    dashboardContent.classList.remove('hidden');
    renderAdminDashboard();
  } else {
    loginCard.classList.remove('hidden');
    dashboardContent.classList.add('hidden');
    clearAdminLogin();
  }
}

// ============================================================================
// STUDENT AUTHENTICATION FLOWS
// ============================================================================
async function handleStudentRegister() {
  const name = document.getElementById('regName').value.trim();
  const roll = document.getElementById('regRoll').value.trim().toUpperCase();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const pass = document.getElementById('regPass').value;
  const regMsg = document.getElementById('regMsg');

  regMsg.textContent = '';

  if (!name || !roll || !email || pass.length < 6) {
    regMsg.textContent = 'Please fill all fields. Password must be at least 6 characters.';
    regMsg.className = 'mt-3 text-xs font-medium text-rose-600';
    return;
  }

  regMsg.textContent = 'Creating account...';
  regMsg.className = 'mt-3 text-xs font-medium text-blue-600';

  try {
    const data = await authSignUp({ email, password: pass, fullName: name, rollNumber: roll });
    if (data.session) {
      regMsg.textContent = 'Account created successfully! Logging you in...';
      regMsg.className = 'mt-3 text-xs font-medium text-emerald-600';
      setTimeout(() => switchStudentSub('dashboard'), 800);
    } else {
      regMsg.textContent = 'Account created! Please check your email inbox to confirm your email before signing in.';
      regMsg.className = 'mt-3 text-xs font-medium text-emerald-600';
      showModal('Confirmation Email Sent', 'A verification email has been sent to ' + email + '. Please click the confirmation link in your email to activate your account.', 'info');
      clearStudentRegister();
      setTimeout(() => switchStudentSub('login'), 2000);
    }
  } catch (err) {
    console.error('Sign up error:', err);
    let msg = err.message || 'Registration failed.';
    if (msg.includes('user_already_exists') || msg.includes('already registered')) {
      msg = 'An account with this email already exists. Please login instead.';
    }
    regMsg.textContent = msg;
    regMsg.className = 'mt-3 text-xs font-medium text-rose-600';
  }
}

function clearStudentRegister() {
  document.getElementById('regName').value = '';
  document.getElementById('regRoll').value = '';
  document.getElementById('regEmail').value = '';
  document.getElementById('regPass').value = '';
  document.getElementById('regMsg').textContent = '';
}

async function handleStudentLogin() {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const pass = document.getElementById('loginPass').value;
  const loginMsg = document.getElementById('loginMsg');

  loginMsg.textContent = '';

  if (!email || !pass) {
    loginMsg.textContent = 'Please enter both email and password.';
    loginMsg.className = 'text-xs font-medium text-rose-600';
    return;
  }

  loginMsg.textContent = 'Authenticating...';
  loginMsg.className = 'text-xs font-medium text-blue-600';

  try {
    await authSignIn({ email, password: pass });
    loginMsg.textContent = 'Login successful!';
    loginMsg.className = 'text-xs font-medium text-emerald-600';
    clearStudentLogin();

    // Check profile completion (if user came from OAuth without roll number)
    const profile = await getMyProfile();
    if (!profile || !profile.roll_number) {
      openCompleteProfileModal();
    } else {
      switchStudentSub('dashboard');
    }
  } catch (err) {
    console.error('Login error:', err);
    let msg = err.message || 'Login failed.';
    if (msg.includes('Invalid login credentials')) {
      msg = 'Invalid email or password.';
    } else if (msg.includes('Email not confirmed')) {
      msg = 'Email not confirmed. Please check your inbox for the confirmation link.';
    }
    loginMsg.textContent = msg;
    loginMsg.className = 'text-xs font-medium text-rose-600';
  }
}

function clearStudentLogin() {
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginMsg').textContent = '';
}

async function handleGoogleSignIn() {
  try {
    await authSignInWithGoogle();
  } catch (err) {
    console.error('Google Sign-In Error:', err);
    showModal('Google Sign-In Failed', err.message || 'Could not initiate Google sign in.', 'error');
  }
}

async function handleStudentLogout() {
  await authSignOut();
  switchStudentSub('login');
}

// Profile Completion Modal (for Google OAuth users without roll number)
function openCompleteProfileModal() {
  const modal = document.getElementById('completeProfileModal');
  if (modal) modal.classList.remove('hidden');
}

function closeCompleteProfileModal() {
  const modal = document.getElementById('completeProfileModal');
  if (modal) modal.classList.add('hidden');
}

async function handleSaveCompleteProfile() {
  const fullName = document.getElementById('cpFullName').value.trim();
  const rollNumber = document.getElementById('cpRollNumber').value.trim().toUpperCase();
  const msgEl = document.getElementById('cpMsg');

  if (!fullName || !rollNumber) {
    msgEl.textContent = 'Please fill out both your full name and roll number.';
    msgEl.className = 'text-xs font-medium text-rose-600';
    return;
  }

  msgEl.textContent = 'Saving profile...';
  msgEl.className = 'text-xs font-medium text-blue-600';

  try {
    await updateMyProfile({ fullName, rollNumber });
    msgEl.textContent = 'Profile saved!';
    msgEl.className = 'text-xs font-medium text-emerald-600';
    setTimeout(() => {
      closeCompleteProfileModal();
      switchStudentSub('dashboard');
    }, 600);
  } catch (err) {
    console.error('Profile update error:', err);
    msgEl.textContent = err.message || 'Could not update profile.';
    msgEl.className = 'text-xs font-medium text-rose-600';
  }
}

// Forgot Password Flow (Supabase resetPasswordForEmail)
function toggleForgotPasswordModal(show) {
  const modal = document.getElementById('forgotPasswordModal');
  if (!modal) return;
  if (show) {
    modal.classList.remove('hidden');
    document.getElementById('fpEmail').value = '';
    document.getElementById('fpMsg').textContent = '';
  } else {
    modal.classList.add('hidden');
  }
}

async function handleForgotPasswordSubmit() {
  const email = document.getElementById('fpEmail').value.trim().toLowerCase();
  const msgEl = document.getElementById('fpMsg');

  if (!email) {
    msgEl.textContent = 'Please enter your email address.';
    msgEl.className = 'text-xs font-medium text-rose-600';
    return;
  }

  msgEl.textContent = 'Sending password reset email...';
  msgEl.className = 'text-xs font-medium text-blue-600';

  try {
    await authSendPasswordReset(email);
    msgEl.textContent = 'Password reset link sent! Check your inbox.';
    msgEl.className = 'text-xs font-medium text-emerald-600';
    setTimeout(() => toggleForgotPasswordModal(false), 2000);
  } catch (err) {
    console.error('Password reset error:', err);
    msgEl.textContent = err.message || 'Failed to send reset link.';
    msgEl.className = 'text-xs font-medium text-rose-600';
  }
}

// Reset Password Modal (when arriving from Supabase reset link)
function openResetPasswordModal() {
  const modal = document.getElementById('resetPasswordModal');
  if (modal) {
    modal.classList.remove('hidden');
    document.getElementById('npNewPass').value = '';
    document.getElementById('npConfirmPass').value = '';
    document.getElementById('npMsg').textContent = '';
  }
}

function closeResetPasswordModal() {
  const modal = document.getElementById('resetPasswordModal');
  if (modal) modal.classList.add('hidden');
}

async function handleUpdatePasswordSubmit() {
  const p1 = document.getElementById('npNewPass').value;
  const p2 = document.getElementById('npConfirmPass').value;
  const msgEl = document.getElementById('npMsg');

  if (!p1 || p1.length < 6) {
    msgEl.textContent = 'Password must be at least 6 characters.';
    msgEl.className = 'text-xs font-medium text-rose-600';
    return;
  }
  if (p1 !== p2) {
    msgEl.textContent = 'Passwords do not match.';
    msgEl.className = 'text-xs font-medium text-rose-600';
    return;
  }

  msgEl.textContent = 'Updating password...';
  msgEl.className = 'text-xs font-medium text-blue-600';

  try {
    await authUpdatePassword(p1);
    msgEl.textContent = 'Password updated successfully!';
    msgEl.className = 'text-xs font-medium text-emerald-600';
    showModal('Password Changed', 'Your password has been successfully reset. You can now use your new password.', 'success');
    setTimeout(() => {
      closeResetPasswordModal();
      switchStudentSub('login');
    }, 1500);
  } catch (err) {
    console.error('Update password error:', err);
    msgEl.textContent = err.message || 'Could not update password.';
    msgEl.className = 'text-xs font-medium text-rose-600';
  }
}

// ============================================================================
// ADMIN AUTHENTICATION
// ============================================================================
async function handleAdminLogin() {
  const email = document.getElementById('adminEmail').value.trim().toLowerCase();
  const pass = document.getElementById('adminPass').value;
  const loginMsg = document.getElementById('adminLoginMsg');
  const loginBtn = document.querySelector('button[onclick="handleAdminLogin()"]');

  loginMsg.textContent = '';

  if (!email || !pass) {
    loginMsg.textContent = 'Please enter admin credentials.';
    loginMsg.className = 'text-xs font-medium text-rose-600';
    return;
  }

  loginMsg.textContent = 'Verifying administrative clearance...';
  loginMsg.className = 'text-xs font-medium text-amber-600';
  if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = 'Verifying...'; }

  try {
    try {
      await authSignIn({ email, password: pass });
    } catch (signInErr) {
      console.warn('Initial admin sign in error:', signInErr);
      if (email === 'seeramgiridhar22@gmail.com') {
        try {
          loginMsg.textContent = 'Provisioning master admin...';
          await authSignUp({ email, password: pass, fullName: 'Giridhar (Admin)', rollNumber: 'ADMIN' });
        } catch (signUpErr) {
          console.warn('Admin sign up fallback error:', signUpErr);
          if (signUpErr.message && (signUpErr.message.includes('already') || signUpErr.message.includes('user_already_exists'))) {
            throw new Error('Incorrect password. If you registered via Google, click "Continue with Google" below.');
          }
          throw signUpErr;
        }
      } else {
        throw signInErr;
      }
    }

    const user = firebase.auth().currentUser;
    const isMaster = (user && user.email && user.email.toLowerCase() === 'seeramgiridhar22@gmail.com');
    const profile = await getMyProfile();

    if (!isMaster && (!profile || profile.role !== 'admin')) {
      await authSignOut();
      loginMsg.textContent = 'This account does not have administrator privileges.';
      loginMsg.className = 'text-xs font-medium text-rose-600';
      return;
    }

    loginMsg.textContent = 'Admin access granted!';
    loginMsg.className = 'text-xs font-medium text-emerald-600';
    setTimeout(() => toggleAdminDashboardView(true), 400);
  } catch (err) {
    console.error('Admin login error:', err);
    let msg = err.message || 'Authentication failed.';
    if (msg.includes('auth/invalid-credential') || msg.includes('Invalid login credentials')) {
      msg = 'Invalid credentials. If this email was created with Google, click "Continue with Google" below.';
    }
    loginMsg.textContent = msg;
    loginMsg.className = 'text-xs font-medium text-rose-600';
  } finally {
    if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Login as Admin'; }
  }
}

async function handleAdminGoogleSignIn() {
  const loginMsg = document.getElementById('adminLoginMsg');
  loginMsg.textContent = 'Authenticating with Google...';
  loginMsg.className = 'text-xs font-medium text-amber-600';
  try {
    const result = await authSignInWithGoogle();
    const user = (result && result.user) ? result.user : firebase.auth().currentUser;
    if (!user) throw new Error('No user returned from Google sign in.');

    const isMaster = (user.email && user.email.toLowerCase() === 'seeramgiridhar22@gmail.com');
    const profile = await getMyProfile();

    if (!isMaster && (!profile || profile.role !== 'admin')) {
      await authSignOut();
      loginMsg.textContent = 'Google account ' + user.email + ' is not an admin.';
      loginMsg.className = 'text-xs font-medium text-rose-600';
      return;
    }

    loginMsg.textContent = 'Admin access granted!';
    loginMsg.className = 'text-xs font-medium text-emerald-600';
    setTimeout(() => toggleAdminDashboardView(true), 400);
  } catch (err) {
    console.error('Admin Google sign-in error:', err);
    loginMsg.textContent = err.message || 'Google sign-in failed.';
    loginMsg.className = 'text-xs font-medium text-rose-600';
  }
}

function clearAdminLogin() {
  document.getElementById('adminEmail').value = '';
  document.getElementById('adminPass').value = '';
  document.getElementById('adminLoginMsg').textContent = '';
}

async function handleAdminLogout() {
  await authSignOut();
  toggleAdminDashboardView(false);
}

// ============================================================================
// STUDENT DASHBOARD: EVENTS & REGISTRATIONS
// ============================================================================
async function renderStudentDashboard() {
  const user = await authGetUser();
  const profile = await getMyProfile();

  if (profile) {
    document.getElementById('studentWelcomeBanner').textContent = `Welcome, ${profile.full_name || 'Student'} ${profile.roll_number ? '(' + profile.roll_number + ')' : ''}`;
  }
  if (user) {
    document.getElementById('studentEmailBanner').textContent = user.email;
  }

  await Promise.all([
    renderStudentEvents(),
    renderStudentMyRegistrations()
  ]);
}

const debouncedStudentSearch = debounce((val) => {
  studentSearchQuery = (val || '').toLowerCase().trim();
  renderStudentEvents();
}, 300);

async function renderStudentEvents() {
  const container = document.getElementById('studentEventsList');
  const countBadge = document.getElementById('eventCountBadge');
  renderSkeletonCards(container, 2);

  try {
    const events = await apiFetchEventsWithCounts();
    let filtered = events;
    if (studentSearchQuery) {
      filtered = events.filter(e =>
        e.title.toLowerCase().includes(studentSearchQuery) ||
        (e.venue || '').toLowerCase().includes(studentSearchQuery) ||
        (e.description || '').toLowerCase().includes(studentSearchQuery)
      );
    }

    countBadge.textContent = `${filtered.length} Events`;
    container.innerHTML = '';

    if (filtered.length === 0) {
      container.innerHTML = '<div class="text-center py-10 text-slate-400 text-xs">No matching events found.</div>';
      return;
    }

    filtered.forEach(ev => {
      const isRegistered = !!ev.my_entry_code;
      const isFull = !!ev.is_full;
      const seatsLeft = ev.seats_left !== undefined ? ev.seats_left : Math.max(0, ev.capacity - (ev.registered || 0));

      const card = document.createElement('div');
      card.className = 'p-4 rounded-xl border border-slate-200 bg-white hover:border-blue-300 transition-all shadow-sm flex flex-col justify-between gap-3';

      card.innerHTML = `
        <div>
          <div class="flex items-start justify-between gap-2">
            <h4 class="text-sm font-bold text-slate-900">${escapeHtml(ev.title)}</h4>
            ${isRegistered
              ? '<span class="text-[11px] font-semibold bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full shrink-0">Registered</span>'
              : (isFull
                ? '<span class="text-[11px] font-semibold bg-rose-100 text-rose-700 px-2.5 py-0.5 rounded-full shrink-0">Event Full</span>'
                : `<span class="text-[11px] font-semibold bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full shrink-0">${seatsLeft} seats left</span>`)
            }
          </div>
          <p class="text-xs text-slate-500 mt-1 line-clamp-2">${escapeHtml(ev.description || 'No description provided.')}</p>
          <div class="flex items-center gap-3 mt-3 text-[11px] text-slate-500 flex-wrap">
            <span>📅 ${escapeHtml(ev.date || 'TBD')}</span>
            <span>⏰ ${escapeHtml(ev.time || 'TBD')}</span>
            <span>📍 ${escapeHtml(ev.venue || 'Campus')}</span>
            <span>👥 Capacity: ${escapeHtml(ev.capacity)}</span>
          </div>
        </div>
        <div class="pt-2 border-t border-slate-100 flex items-center justify-between">
          <div class="text-xs font-medium text-slate-600">
            ${isRegistered
              ? `<span class="text-emerald-700 font-mono font-bold">Pass: ${escapeHtml(ev.my_entry_code)}</span>`
              : (isFull ? '<span class="text-rose-600">No seats remaining</span>' : '<span class="text-slate-500">Free Registration</span>')}
          </div>
          <div>
            ${isRegistered
              ? '<button disabled class="px-3 py-1.5 bg-slate-100 text-slate-400 font-semibold rounded-lg text-xs cursor-not-allowed">Registered</button>'
              : (isFull
                ? '<button disabled class="px-3 py-1.5 bg-slate-100 text-slate-400 font-semibold rounded-lg text-xs cursor-not-allowed">Full</button>'
                : `<button onclick="handleStudentRegisterForEvent('${ev.id}', this)" class="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-xs transition-all shadow-sm">Register</button>`)
            }
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Fetch events error:', err);
    container.innerHTML = `<div class="p-4 text-xs text-rose-600 bg-rose-50 rounded-xl">Failed to load events: ${escapeHtml(err.message)}</div>`;
  }
}

async function handleStudentRegisterForEvent(eventId, btn = null) {
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Registering...';
    btn.classList.add('opacity-75', 'cursor-not-allowed');
  }
  try {
    const entryCode = await apiRegisterForEvent(eventId);
    showModal('Registration Confirmed! 🎉', `You have successfully registered for the event. Your unique gate entry code is: ${entryCode}. You can find your pass and QR code in "My Registrations".`, 'success');
    await Promise.all([
      renderStudentEvents(),
      renderStudentMyRegistrations()
    ]);
  } catch (err) {
    console.error('Registration error:', err);
    let msg = err.message || 'Registration failed.';
    if (msg.includes('ALREADY_REGISTERED')) {
      msg = 'You are already registered for this event.';
    } else if (msg.includes('EVENT_FULL')) {
      msg = 'Sorry! This event has just reached maximum capacity.';
    }
    showModal('Registration Notice', msg, 'error');
    renderStudentEvents();
  }
}

async function renderStudentMyRegistrations() {
  const container = document.getElementById('studentMyRegsList');
  const countBadge = document.getElementById('regCountBadge');
  renderSkeletonCards(container, 1);

  try {
    const regs = await apiGetMyRegistrations();
    countBadge.textContent = `${regs.length} Passes`;
    container.innerHTML = '';

    if (regs.length === 0) {
      container.innerHTML = '<div class="text-center py-10 text-slate-400 text-xs">You have not registered for any events yet.</div>';
      return;
    }

    for (const r of regs) {
      const event = await apiFetchEventById(r.event_id) || { title: 'College Event', date: '', venue: '' };
      const card = document.createElement('div');
      card.className = 'p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4';

      const isEntered = !!r.entered;
      const qrId = `qr_${r.entry_code}`;

      card.innerHTML = `
        <div class="flex-grow space-y-1">
          <div class="flex items-center gap-2">
            <h4 class="text-sm font-bold text-slate-900">${escapeHtml(event.title)}</h4>
            ${isEntered
              ? '<span class="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Entered</span>'
              : '<span class="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Pending</span>'
            }
          </div>
          <div class="text-xs text-slate-500">
            <span>📅 ${escapeHtml(event.date || 'TBD')}</span> • <span>📍 ${escapeHtml(event.venue || 'Campus')}</span>
          </div>
          <div class="text-xs font-mono font-bold text-blue-600 mt-1">
            ENTRY CODE: <span class="bg-blue-50 px-2 py-1 rounded border border-blue-200 text-blue-700 text-xs">${escapeHtml(r.entry_code)}</span>
          </div>
        </div>
        <div class="flex flex-col items-center justify-center p-2 bg-slate-50 rounded-xl border border-slate-200 shrink-0">
          <div id="${qrId}" class="w-[84px] h-[84px] flex items-center justify-center bg-white p-1 rounded-lg"></div>
          <span class="text-[9px] text-slate-400 font-mono mt-1">Gate Pass QR</span>
        </div>
      `;
      container.appendChild(card);

      // Render QR code encoding ONLY the entry code (no personal info)
      setTimeout(() => {
        const qrEl = document.getElementById(qrId);
        if (qrEl && window.QRCode) {
          qrEl.innerHTML = '';
          new QRCode(qrEl, {
            text: r.entry_code,
            width: 76,
            height: 76,
            correctLevel: QRCode.CorrectLevel.M
          });
        }
      }, 50);
    }
  } catch (err) {
    console.error('Fetch registrations error:', err);
    container.innerHTML = `<div class="p-4 text-xs text-rose-600 bg-rose-50 rounded-xl">Failed to load passes: ${escapeHtml(err.message)}</div>`;
  }
}

// ============================================================================
// ADMIN DASHBOARD & CONTROLS
// ============================================================================
async function renderAdminDashboard() {
  await Promise.all([
    renderAdminEventsList(),
    renderAdminStats(),
    renderAdminEventSummaryTable(),
    renderAdminAllRegistrationsList()
  ]);
}

const debouncedAdminSearch = debounce((val) => {
  adminSearchQuery = (val || '').toLowerCase().trim();
  renderAdminEventsList();
}, 300);

async function renderAdminEventsList() {
  const container = document.getElementById('adminEventsList');
  renderSkeletonCards(container, 2);

  try {
    const events = await apiFetchEventsAdmin(adminSearchQuery);
    container.innerHTML = '';

    if (events.length === 0) {
      container.innerHTML = '<div class="text-center py-10 text-slate-400 text-xs">No events found.</div>';
      return;
    }

    events.forEach(ev => {
      const card = document.createElement('div');
      card.className = 'p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all flex flex-col justify-between gap-2.5';
      card.innerHTML = `
        <div>
          <div class="flex items-start justify-between gap-2">
            <h4 class="text-xs font-bold text-slate-900">${escapeHtml(ev.title)}</h4>
            <span class="text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full shrink-0">Cap: ${escapeHtml(ev.capacity)}</span>
          </div>
          <div class="text-[11px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
            <span>📅 ${escapeHtml(ev.date)}</span>
            <span>📍 ${escapeHtml(ev.venue || 'N/A')}</span>
          </div>
        </div>
        <div class="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
          <button onclick="exportEventCsv('${ev.id}', '${escapeHtml(ev.title)}')" class="text-[11px] text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1">
            📥 Export CSV
          </button>
          <div class="flex items-center gap-1.5">
            <button onclick="openEditEventModal('${ev.id}')" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-medium transition-all">
              Edit
            </button>
            <button onclick="handleDeleteEvent('${ev.id}')" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-[11px] font-medium transition-all">
              Delete
            </button>
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Fetch admin events error:', err);
    container.innerHTML = `<div class="p-3 text-xs text-rose-600">Error loading events: ${escapeHtml(err.message)}</div>`;
  }
}

async function handleCreateEvent() {
  const submitBtn = document.querySelector('button[onclick="handleCreateEvent()"]');
  const title = document.getElementById('evTitle').value.trim();
  const date = document.getElementById('evDate').value;
  const time = document.getElementById('evTime').value;
  const venue = document.getElementById('evVenue').value.trim();
  const desc = document.getElementById('evDesc').value.trim();
  const cap = parseInt(document.getElementById('evCapacity')?.value, 10) || 100;
  const msgEl = document.getElementById('eventMsg');

  if (!title || !date || !venue) {
    msgEl.textContent = 'Please provide event title, date, and venue.';
    msgEl.className = 'mt-2 text-xs font-medium text-rose-600';
    return;
  }

  msgEl.textContent = 'Publishing event...';
  msgEl.className = 'mt-2 text-xs font-medium text-blue-600';

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Publishing...';
  }
  try {
    await apiCreateEvent({ title, date, time, venue, description: desc, capacity: cap });
    msgEl.textContent = 'Event published successfully!';
    msgEl.className = 'mt-2 text-xs font-medium text-emerald-600';
    clearEventForm();
    await renderAdminDashboard();
  } catch (err) {
    console.error('Create event error:', err);
    msgEl.textContent = err.message || 'Failed to create event.';
    msgEl.className = 'mt-2 text-xs font-medium text-rose-600';
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Publish Event';
    }
  }
}

function clearEventForm() {
  document.getElementById('evTitle').value = '';
  document.getElementById('evDate').value = '';
  document.getElementById('evTime').value = '';
  document.getElementById('evVenue').value = '';
  document.getElementById('evDesc').value = '';
  if (document.getElementById('evCapacity')) {
    document.getElementById('evCapacity').value = '100';
  }
  document.getElementById('eventMsg').textContent = '';
}

// Edit Event Modal
async function openEditEventModal(id) {
  const event = await apiFetchEventById(id);
  if (!event) return;
  document.getElementById('editEvId').value = event.id;
  document.getElementById('editEvTitle').value = event.title;
  document.getElementById('editEvDate').value = event.date;
  document.getElementById('editEvTime').value = event.time || '';
  document.getElementById('editEvVenue').value = event.venue || '';
  document.getElementById('editEvCapacity').value = event.capacity;
  document.getElementById('editEvDesc').value = event.description || '';
  document.getElementById('editEvMsg').textContent = '';
  document.getElementById('editEventModal').classList.remove('hidden');
}

function closeEditEventModal() {
  document.getElementById('editEventModal').classList.add('hidden');
}

async function handleSaveEditEvent() {
  const id = document.getElementById('editEvId').value;
  const title = document.getElementById('editEvTitle').value.trim();
  const date = document.getElementById('editEvDate').value;
  const time = document.getElementById('editEvTime').value;
  const venue = document.getElementById('editEvVenue').value.trim();
  const capacity = parseInt(document.getElementById('editEvCapacity').value, 10);
  const desc = document.getElementById('editEvDesc').value.trim();
  const msgEl = document.getElementById('editEvMsg');

  if (!title || !date || !venue || capacity < 1) {
    msgEl.textContent = 'Please fill all required fields properly.';
    msgEl.className = 'text-xs font-medium text-rose-600';
    return;
  }

  msgEl.textContent = 'Updating event...';
  msgEl.className = 'text-xs font-medium text-blue-600';

  try {
    await apiUpdateEvent(id, { title, date, time, venue, description: desc, capacity });
    msgEl.textContent = 'Saved!';
    msgEl.className = 'text-xs font-medium text-emerald-600';
    setTimeout(() => {
      closeEditEventModal();
      renderAdminDashboard();
    }, 600);
  } catch (err) {
    console.error('Update event error:', err);
    msgEl.textContent = err.message || 'Failed to update event.';
    msgEl.className = 'text-xs font-medium text-rose-600';
  }
}

async function handleDeleteEvent(id) {
  const confirmed = confirm('Are you sure you want to delete this event? All student registrations will be permanently deleted.');
  if (!confirmed) return;

  try {
    await apiDeleteEvent(id);
    await renderAdminDashboard();
  } catch (err) {
    console.error('Delete event error:', err);
    showModal('Delete Failed', err.message || 'Could not delete event.', 'error');
  }
}

// ============================================================================
// GATE ENTRY CODE VERIFICATION & CAMERA SCANNER
// ============================================================================
async function handleVerifyEntryCode(codeOverride = null) {
  const inputEl = document.getElementById('entryCodeInput');
  const code = (codeOverride || inputEl.value).trim().toUpperCase();
  const resultContainer = document.getElementById('entryVerificationResult');
  const msgEl = document.getElementById('entryMsg');

  if (!code) {
    msgEl.textContent = 'Please enter or scan an entry code.';
    msgEl.className = 'text-xs font-medium text-rose-600';
    return;
  }

  msgEl.textContent = 'Verifying with database...';
  msgEl.className = 'text-xs font-medium text-amber-600';

  try {
    const attendee = await apiVerifyEntry(code);
    if (!attendee) {
      currentVerifiedAttendee = null;
      msgEl.textContent = 'INVALID_CODE: No registration found matching this code.';
      msgEl.className = 'text-xs font-medium text-rose-600';
      resultContainer.innerHTML = `
        <div class="p-4 rounded-xl border border-rose-200 bg-rose-50 text-center space-y-1">
          <div class="text-rose-700 font-bold text-xs uppercase">❌ Verification Failed</div>
          <div class="text-rose-600 text-xs">Invalid or unrecognized entry code: <b class="font-mono">${escapeHtml(code)}</b></div>
        </div>
      `;
      return;
    }

    currentVerifiedAttendee = attendee;
    const isEntered = !!attendee.entered;
    msgEl.textContent = isEntered ? 'Attendee already admitted.' : 'Valid entry pass detected!';
    msgEl.className = isEntered ? 'text-xs font-medium text-amber-600' : 'text-xs font-medium text-emerald-600';

    resultContainer.innerHTML = `
      <div class="p-4 rounded-xl border ${isEntered ? 'border-amber-300 bg-amber-50/50' : 'border-emerald-300 bg-emerald-50/50'} space-y-3">
        <div class="flex items-start justify-between">
          <div>
            <h4 class="text-sm font-bold text-slate-900">${escapeHtml(attendee.full_name || 'Student')}</h4>
            <div class="text-xs font-mono text-slate-600 font-semibold">${escapeHtml(attendee.roll_number || 'No Roll')} • ${escapeHtml(attendee.email)}</div>
          </div>
          ${isEntered
            ? '<span class="px-2.5 py-1 bg-amber-200 text-amber-900 text-[11px] font-bold rounded-full">ALREADY ENTERED</span>'
            : '<span class="px-2.5 py-1 bg-emerald-200 text-emerald-900 text-[11px] font-bold rounded-full">VERIFIED PASS</span>'
          }
        </div>
        <div class="text-xs text-slate-600 space-y-0.5 pt-2 border-t border-slate-200/60">
          <div><b>Event:</b> ${escapeHtml(attendee.event_title)}</div>
          <div><b>Venue:</b> ${escapeHtml(attendee.event_venue || 'Main Hall')} · <b>Date:</b> ${escapeHtml(attendee.event_date)}</div>
          ${isEntered ? `<div class="text-amber-800 font-semibold pt-1">⚠️ Admitted at: ${new Date(attendee.entered_at).toLocaleTimeString()}</div>` : ''}
        </div>
        ${!isEntered ? `
          <div class="pt-2">
            <button onclick="handleMarkAttendeeEntered('${escapeHtml(attendee.entry_code)}')" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md">
              ✓ Mark ENTERED (Grant Gate Access)
            </button>
          </div>
        ` : ''}
      </div>
    `;
  } catch (err) {
    console.error('Verify entry error:', err);
    msgEl.textContent = err.message || 'Verification failed.';
    msgEl.className = 'text-xs font-medium text-rose-600';
  }
}

async function handleMarkAttendeeEntered(code) {
  const msgEl = document.getElementById('entryMsg');
  msgEl.textContent = 'Processing gate admission...';
  msgEl.className = 'text-xs font-medium text-blue-600';

  try {
    const res = await apiMarkEntered(code);
    if (!res.ok) {
      if (res.error === 'ALREADY_ENTERED') {
        showModal('Second Scan Blocked', 'ALREADY_ENTERED: This ticket has already been used for gate entry. Multiple admissions with the same pass are strictly prevented.', 'error');
      } else {
        showModal('Gate Error', res.error || 'Could not validate admission.', 'error');
      }
      handleVerifyEntryCode(code);
      return;
    }

    showModal('Access Granted ✅', `Attendee successfully marked as ENTERED for this event!`, 'success');
    handleVerifyEntryCode(code);
    await renderAdminStats();
    await renderAdminEventSummaryTable();
    await renderAdminAllRegistrationsList();
  } catch (err) {
    console.error('Mark entered error:', err);
    showModal('System Error', err.message || 'Could not record admission.', 'error');
  }
}

function clearEntryVerification() {
  document.getElementById('entryCodeInput').value = '';
  document.getElementById('entryMsg').textContent = 'Ready for verification';
  document.getElementById('entryMsg').className = 'font-medium text-slate-500';
  document.getElementById('entryVerificationResult').innerHTML = `
    <div class="text-center py-6 text-slate-400 text-xs border-2 border-dashed border-slate-200 rounded-xl">
      Enter a student entry code above and click verify to check participant status and grant hall access.
    </div>
  `;
}

// Camera Scanner with html5-qrcode
function toggleCameraScanner() {
  const container = document.getElementById('qrScannerContainer');
  const btn = document.getElementById('btnToggleScanner');

  if (isScannerActive) {
    stopCameraScanner();
  } else {
    container.classList.remove('hidden');
    btn.textContent = '⏹️ Stop Camera';
    btn.className = 'px-3 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5';
    isScannerActive = true;

    if (!window.Html5Qrcode) {
      showModal('Scanner Library Missing', 'HTML5 QR Code library is loading. Please try again.', 'error');
      stopCameraScanner();
      return;
    }

    html5QrScanner = new Html5Qrcode('qrReader');
    html5QrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      (decodedText) => {
        stopCameraScanner();
        document.getElementById('entryCodeInput').value = decodedText.trim().toUpperCase();
        handleVerifyEntryCode(decodedText.trim().toUpperCase());
      },
      (error) => {
        // Scanning frame without QR; no action needed
      }
    ).catch(err => {
      console.error('Camera start error:', err);
      showModal('Camera Access Denied', 'Camera permission was denied or camera is unavailable. Please check your browser camera settings or type the entry code manually.', 'error');
      stopCameraScanner();
    });
  }
}

function stopCameraScanner() {
  const container = document.getElementById('qrScannerContainer');
  const btn = document.getElementById('btnToggleScanner');
  if (html5QrScanner && isScannerActive) {
    html5QrScanner.stop().then(() => {
      html5QrScanner.clear();
      html5QrScanner = null;
    }).catch(e => console.warn(e));
  }
  isScannerActive = false;
  if (container) container.classList.add('hidden');
  if (btn) {
    btn.textContent = '📷 Scan QR';
    btn.className = 'px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5';
  }
}

// ============================================================================
// ADMIN ANALYTICS, PIE CHART, PER-EVENT TABLE & AUDIT LOG
// ============================================================================
async function renderAdminStats() {
  const pillsContainer = document.getElementById('adminStatsPills');
  try {
    const [events, regs] = await Promise.all([
      apiFetchEventsAdmin(),
      apiGetAllRegistrationsAdmin()
    ]);

    const totalEvents = events.length;
    const totalRegs = regs.length;
    const totalEntered = regs.filter(r => r.entered).length;
    const pendingEntered = totalRegs - totalEntered;

    pillsContainer.innerHTML = `
      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80 text-center">
        <div class="text-[10px] text-slate-500 uppercase font-bold">Total Regs</div>
        <div class="text-base font-bold text-slate-900">${totalRegs}</div>
      </div>
      <div class="p-3 bg-emerald-50 rounded-xl border border-emerald-200/80 text-center">
        <div class="text-[10px] text-emerald-600 uppercase font-bold">Entered</div>
        <div class="text-base font-bold text-emerald-700">${totalEntered}</div>
      </div>
      <div class="p-3 bg-amber-50 rounded-xl border border-amber-200/80 text-center">
        <div class="text-[10px] text-amber-600 uppercase font-bold">Pending</div>
        <div class="text-base font-bold text-amber-700">${pendingEntered}</div>
      </div>
    `;

    const canvas = document.getElementById('attendancePieChart');
    if (!canvas || !window.Chart) return;
    const ctx = canvas.getContext('2d');
    if (attendanceChartInstance) {
      attendanceChartInstance.destroy();
    }

    attendanceChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Entered Hall', 'Pending Entry'],
        datasets: [{
          data: [totalEntered, pendingEntered],
          backgroundColor: ['#10b981', '#f59e0b'],
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, font: { size: 11, family: 'Inter' } }
          }
        }
      }
    });
  } catch (err) {
    console.error('Render admin stats error:', err);
  }
}

async function renderAdminEventSummaryTable() {
  const tbody = document.getElementById('adminEventSummaryTableBody');
  try {
    const [events, regs] = await Promise.all([
      apiFetchEventsAdmin(),
      apiGetAllRegistrationsAdmin()
    ]);

    tbody.innerHTML = '';
    if (events.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center py-6 text-slate-400">No events created yet</td></tr>';
      return;
    }

    events.forEach(ev => {
      const evRegs = regs.filter(r => r.event_id === ev.id);
      const regCount = evRegs.length;
      const enteredCount = evRegs.filter(r => r.entered).length;

      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50/80';
      tr.innerHTML = `
        <td class="p-2.5 font-medium text-slate-900">${escapeHtml(ev.title)}</td>
        <td class="p-2.5 text-center font-semibold text-blue-600">${regCount}</td>
        <td class="p-2.5 text-center font-semibold text-emerald-600">${enteredCount}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Render summary table error:', err);
  }
}

async function renderAdminAllRegistrationsList() {
  const listEl = document.getElementById('adminAllRegsList');
  const badgeEl = document.getElementById('adminTotalRegsBadge');

  try {
    const [regs, profiles, events] = await Promise.all([
      apiGetAllRegistrationsAdmin(),
      apiGetAllProfilesAdmin(),
      apiFetchEventsAdmin()
    ]);

    badgeEl.textContent = `${regs.length} Records`;
    listEl.innerHTML = '';

    if (regs.length === 0) {
      listEl.innerHTML = '<div class="text-center py-8 text-slate-400 text-xs">No registrations recorded in system yet.</div>';
      return;
    }

    regs.forEach(r => {
      const stu = profiles.find(p => p.id === r.user_id) || { full_name: 'Student', roll_number: 'N/A' };
      const ev = events.find(e => e.id === r.event_id) || { title: 'College Event' };
      const isEntered = !!r.entered;

      const card = document.createElement('div');
      card.className = 'p-3.5 rounded-xl border border-slate-200/80 bg-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3';
      card.innerHTML = `
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-slate-900">${escapeHtml(stu.full_name)}</span>
            <span class="text-[11px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">${escapeHtml(stu.roll_number || 'N/A')}</span>
            ${isEntered
              ? '<span class="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Entered</span>'
              : '<span class="text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Pending</span>'}
          </div>
          <p class="text-[11px] text-slate-500 mt-0.5">Event: <b class="text-slate-700">${escapeHtml(ev.title)}</b> · Reg: ${new Date(r.created_at).toLocaleDateString()}</p>
        </div>
        <div class="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <div class="text-right">
            <div class="text-[10px] uppercase font-bold text-slate-400">Entry Code</div>
            <div class="text-xs font-mono font-bold text-blue-600">${escapeHtml(r.entry_code)}</div>
          </div>
        </div>
      `;
      listEl.appendChild(card);
    });
  } catch (err) {
    console.error('Render all registrations error:', err);
  }
}



// ============================================================================
// SYSTEM BOOTSTRAP & AUTH STATE LISTENER (Firebase)
// ============================================================================
(function initSystem() {
  // Firebase onAuthStateChanged fires on every page load and login/logout
  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      // User is signed in — read their role from Firestore
      let profile = null;
      try { profile = await getMyProfile(); } catch (e) { console.warn(e); }

      const role = profile?.role || 'student';

      if (role === 'admin') {
        // Show admin dashboard if currently on admin tab
        const adminWin = document.getElementById('adminWindow');
        if (adminWin && !adminWin.classList.contains('hidden')) {
          toggleAdminDashboardView(true);
        }
        // Show Dashboard tab
        document.getElementById('subBtnDashboard').classList.remove('hidden');
      } else {
        // Student: ensure admin view is locked
        toggleAdminDashboardView(false);
        document.getElementById('subBtnDashboard').classList.remove('hidden');
        switchStudentSub('dashboard');
      }

      // Start real-time listeners (onSnapshot) for events & registrations
      setupRealtime({
        onEventsChange: () => {
          if (!document.getElementById('studentWindow').classList.contains('hidden')) {
            renderStudentEvents();
          } else {
            renderAdminDashboard();
          }
        },
        onRegsChange: () => {
          if (!document.getElementById('studentWindow').classList.contains('hidden')) {
            renderStudentEvents();
            renderStudentMyRegistrations();
          } else {
            renderAdminStats();
            renderAdminEventSummaryTable();
            renderAdminAllRegistrationsList();
          }
        }
      });

    } else {
      // Signed out
      teardownRealtime();
      document.getElementById('subBtnDashboard').classList.add('hidden');
      toggleAdminDashboardView(false);
      switchWindow('student');
      switchStudentSub('login');
    }
  });
})();
