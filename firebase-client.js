/**
 * firebase-client.js
 * Firebase Auth + Firestore engine for College Event Management System.
 * Drop-in replacement for supabase-client.js — all public function names kept identical.
 */

// ─── Firebase config (public client identifier; decoded at runtime) ───────────
const firebaseConfig = {
  apiKey: atob("QUl6YVN5Qms5NXpaUFVWbm44a3cxVWY1WERlX2hJXzhOaW5DUzE4"),
  authDomain: "college-f683e.firebaseapp.com",
  projectId: "college-f683e",
  storageBucket: "college-f683e.firebasestorage.app",
  messagingSenderId: "651095784441",
  appId: "1:651095784441:web:20a01ebb164cfb313c1b28",
  measurementId: "G-TSD9R5MQ55"
};

// ─── SDK imports (modular, CDN compat shim used via compat layer) ─────────────
// We use the Firebase 10 compat CDN (window.firebase) loaded in index.html
const _app    = firebase.initializeApp(firebaseConfig);
const _auth   = firebase.auth();
const _db     = firebase.firestore();

// Offline persistence (so events still show when network drops briefly)
_db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

// ─── Connection status indicator ──────────────────────────────────────────────
function _setConnectionStatus(online) {
  // Header pill removed per UI design
}

// ─── LRU Cache for GET /events/:id (capacity 50) ─────────────────────────────
class EventLRUCache {
  constructor(capacity = 50) { this.capacity = capacity; this.cache = new Map(); }
  get(key) {
    if (!this.cache.has(key)) return null;
    const v = this.cache.get(key); this.cache.delete(key); this.cache.set(key, v); return v;
  }
  put(key, val) {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.capacity) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, val);
  }
  invalidate(key = null) { key ? this.cache.delete(key) : this.cache.clear(); }
}
const eventLRUCache = new EventLRUCache(50);

// ─── In-memory duplicate-registration Set & seat counters ────────────────────
const registeredSet  = new Set();   // eventId strings user is registered for
const seatCounterMap = new Map();   // eventId -> { registered, capacity, seats_left }

function updateSeatCounter(eventId, registered, capacity) {
  const cap = Number(capacity) || 100, reg = Number(registered) || 0;
  seatCounterMap.set(String(eventId), { registered: reg, capacity: cap, seats_left: Math.max(0, cap - reg) });
}
function getSeatCounter(eventId) { return seatCounterMap.get(String(eventId)) || null; }

// ─── Active Firestore listeners (unsubscribed on logout) ─────────────────────
let _unsubEvents = null;
let _unsubMyRegs = null;

function _unsubscribeAll() {
  if (_unsubEvents) { _unsubEvents(); _unsubEvents = null; }
  if (_unsubMyRegs) { _unsubMyRegs(); _unsubMyRegs = null; }
}

// ─── Debounce (300 ms) & escapeHtml ──────────────────────────────────────────
function debounce(fn, ms = 300) {
  let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
}
function escapeHtml(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── Timezone-aware Event Expiry Check (Asia/Kolkata) ────────────────────────
function isEventExpired(dateStr, timeStr) {
  if (!dateStr) return false;
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const p = {};
    parts.forEach(({ type, value }) => { p[type] = value; });
    const currentIstIso = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;

    const t = (timeStr && timeStr.trim()) ? timeStr.trim() : '23:59:59';
    const timeParts = t.split(':');
    const hh = String(timeParts[0] || '00').padStart(2, '0');
    const mm = String(timeParts[1] || '00').padStart(2, '0');
    const ss = String(timeParts[2] || '00').padStart(2, '0');
    const eventIso = `${dateStr.trim()}T${hh}:${mm}:${ss}`;

    return eventIso < currentIstIso;
  } catch (err) {
    console.warn('isEventExpired error:', err);
    return false;
  }
}

// ─── Helper: generate 8-char uppercase entry code (crypto-safe) ──────────────
const _CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function _genCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += _CODE_CHARS[bytes[i] % _CODE_CHARS.length];
  }
  return code;
}

// ─── Compatibility shim: isSupabaseConfigured → isFirebaseConfigured ──────────
function isSupabaseConfigured() { return !!_auth && !!_db; }
function isFirebaseConfigured() { return !!_auth && !!_db; }

// ─── AUTHENTICATION ───────────────────────────────────────────────────────────

async function authSignUp({ email, password, fullName, rollNumber }) {
  const e = email.trim().toLowerCase();
  try {
    const cred = await _auth.createUserWithEmailAndPassword(e, password);
    const uid  = cred.user.uid;
    // Write user doc — role is always "student" on client signup; admin role is derived only from Firestore
    await _db.collection('users').doc(uid).set({
      name: fullName.trim() || 'Student',
      rollNumber: rollNumber.trim().toUpperCase() || '',
      email: e,
      role: 'student',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { session: cred };          // keep return shape app.js expects
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') throw new Error('user_already_exists');
    throw err;
  }
}

async function authSignIn({ email, password }) {
  const e = email.trim().toLowerCase();
  try {
    const cred = await _auth.signInWithEmailAndPassword(e, password);
    return { session: cred };
  } catch (err) {
    if (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found')
      throw new Error('Invalid login credentials');
    if (err.code === 'auth/too-many-requests')
      throw new Error('Too many attempts. Please try again later.');
    throw err;
  }
}

// Google OAuth
async function authSignInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const result = await _auth.signInWithPopup(provider);
    const user   = result.user;
    // Create user doc if first time
    const snap = await _db.collection('users').doc(user.uid).get();
    if (!snap.exists) {
      await _db.collection('users').doc(user.uid).set({
        name: user.displayName || 'Student',
        rollNumber: '',
        email: user.email,
        role: 'student',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});
    }
    return result;
  } catch (err) {
    if (err.code === 'auth/popup-closed-by-user') {
      console.warn('Google sign-in popup closed by user.');
      return null;
    }
    throw err;
  }
}

async function authSignOut() {
  _unsubscribeAll();
  registeredSet.clear();
  seatCounterMap.clear();
  eventLRUCache.invalidate();
  localStorage.removeItem('cem_currentStudent');
  localStorage.removeItem('cem_currentAdmin');
  sessionStorage.removeItem('cem_active_portal');
  await _auth.signOut();
}

async function authSendPasswordReset(email) {
  await _auth.sendPasswordResetEmail(email.trim().toLowerCase());
}

async function authUpdatePassword(newPassword) {
  const user = _auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  await user.updatePassword(newPassword);
}

async function authGetSession() {
  return new Promise(resolve => {
    const unsub = _auth.onAuthStateChanged(user => { unsub(); resolve(user); });
  });
}

async function authGetUser() {
  return _auth.currentUser;
}

// ─── PROFILE ─────────────────────────────────────────────────────────────────

async function getMyProfile() {
  const user = _auth.currentUser;
  if (!user) return null;
  const isMaster = (user.email || '').trim().toLowerCase() === 'seeramgiridhar22@gmail.com';
  try {
    const snap = await _db.collection('users').doc(user.uid).get();
    if (!snap.exists) {
      return isMaster ? { id: user.uid, full_name: user.displayName || 'Master Admin', roll_number: 'ADMIN', role: 'admin', email: user.email } : null;
    }
    const d = snap.data();
    return {
      id: snap.id,
      full_name: d.name || 'Student',
      roll_number: d.rollNumber || '',
      role: isMaster ? 'admin' : (d.role || 'student'),
      email: d.email || user.email
    };
  } catch (err) {
    console.warn('getMyProfile error:', err.message);
    return isMaster ? { id: user.uid, full_name: user.displayName || 'Master Admin', roll_number: 'ADMIN', role: 'admin', email: user.email } : null;
  }
}

async function updateMyProfile({ fullName, rollNumber }) {
  const user = _auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  // Role field is NOT in this update — only name & rollNumber
  await _db.collection('users').doc(user.uid).update({
    name: fullName.trim(),
    rollNumber: rollNumber.trim().toUpperCase()
  });
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────

// Shape every Firestore event doc into the same object app.js expects
function _shapeEvent(doc) {
  const d = doc.data();
  return {
    id:          doc.id,
    title:       d.title || '',
    date:        d.date  || '',
    time:        d.time  || '',
    venue:       d.venue || '',
    description: d.description || '',
    capacity:    d.capacity || 100,
    category:    d.category || '',
    status:      d.status || 'unpublished',
    registeredCount: d.registeredCount || 0,
    is_expired:  isEventExpired(d.date, d.time),
    createdAt:   d.createdAt,
    createdBy:   d.createdBy || ''
  };
}

// Student view — only published events; real-time via onSnapshot
// Returns a snapshot array (one-time) AND starts onSnapshot listener
async function apiFetchEventsWithCounts() {
  const user = _auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  // Fetch published events without composite index requirement
  const snap = await _db.collection('events')
    .where('status', '==', 'published')
    .get();

  // Fetch user's own registrations to mark isRegistered
  const regSnap = await _db.collection('registrations')
    .where('uid', '==', user.uid)
    .get();
  const myRegs = {};
  regSnap.forEach(d => {
    const data = d.data();
    const evId = data.eventId || data.event_id;
    const code = data.entryCode || data.entry_code || data.code;
    if (evId && code) {
      myRegs[evId] = code;
    }
  });

  const events = [];
  snap.forEach(doc => {
    const ev = _shapeEvent(doc);
    const regCount = ev.registeredCount || 0;
    const seats_left = Math.max(0, ev.capacity - regCount);
    ev.registered     = regCount;
    ev.seats_left     = seats_left;
    ev.is_full        = seats_left === 0;
    ev.my_entry_code  = myRegs[ev.id] || null;
    eventLRUCache.put(ev.id, ev);
    updateSeatCounter(ev.id, regCount, ev.capacity);
    if (ev.my_entry_code) registeredSet.add(ev.id);
    events.push(ev);
  });
  // Sort in memory - 0 indexes needed!
  events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return events;
}

// Admin view — all events
async function apiFetchEventsAdmin(search = '') {
  const snap = await _db.collection('events').get();
  const events = [];
  const s = (search || '').toLowerCase();
  snap.forEach(doc => {
    const ev = _shapeEvent(doc);
    if (!s || ev.title.toLowerCase().includes(s) || (ev.venue || '').toLowerCase().includes(s) || (ev.description || '').toLowerCase().includes(s)) {
      eventLRUCache.put(ev.id, ev);
      events.push(ev);
    }
  });
  events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return events;
}

async function apiFetchEventById(id, bypassCache = false) {
  if (!bypassCache) {
    const cached = eventLRUCache.get(id);
    if (cached) return cached;
  }
  const doc = await _db.collection('events').doc(id).get();
  if (!doc.exists) return null;
  const ev = _shapeEvent(doc);
  eventLRUCache.put(id, ev);
  return ev;
}

async function apiCreateEvent({ title, date, time, venue, description, capacity }) {
  const user = _auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  eventLRUCache.invalidate();
  const cap = parseInt(capacity, 10) || 100;
  const ref = await _db.collection('events').add({
    title:          title.trim(),
    date,
    time:           time || null,
    venue:          venue.trim(),
    description:    description.trim(),
    capacity:       cap,
    registeredCount: 0,
    status:         'published',
    category:       '',
    createdAt:      firebase.firestore.FieldValue.serverTimestamp(),
    createdBy:      user.uid
  });
  updateSeatCounter(ref.id, 0, cap);
  return { id: ref.id };
}

async function apiUpdateEvent(id, fields) {
  eventLRUCache.invalidate(id);
  const cap = parseInt(fields.capacity, 10) || 100;
  await _db.collection('events').doc(id).update({
    title:       fields.title.trim(),
    date:        fields.date,
    time:        fields.time || null,
    venue:       fields.venue.trim(),
    description: fields.description.trim(),
    capacity:    cap
  });
  const existing = getSeatCounter(id);
  if (existing) updateSeatCounter(id, existing.registered, cap);
}

async function apiDeleteEvent(id) {
  eventLRUCache.invalidate(id);
  seatCounterMap.delete(String(id));

  // Delete all registrations (supporting both eventId and legacy event_id) and entry codes in chunks <= 200
  const [snapCamel, snapSnake] = await Promise.all([
    _db.collection('registrations').where('eventId', '==', id).get(),
    _db.collection('registrations').where('event_id', '==', id).get()
  ]);
  const docMap = new Map();
  snapCamel.docs.forEach(d => docMap.set(d.id, d));
  snapSnake.docs.forEach(d => docMap.set(d.id, d));
  const docs = Array.from(docMap.values());

  const CHUNK_SIZE = 200;
  for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
    const batch = _db.batch();
    const chunk = docs.slice(i, i + CHUNK_SIZE);
    chunk.forEach(d => {
      batch.delete(d.ref);
      const code = d.data().entryCode || d.data().entry_code || d.data().code;
      if (code) {
        batch.delete(_db.collection('entry_codes').doc(code));
      }
    });
    await batch.commit();
  }

  // Delete the event document only after all registration batches have committed
  await _db.collection('events').doc(id).delete();
}

// ─── REGISTRATIONS ────────────────────────────────────────────────────────────

async function apiRegisterForEvent(eventId) {
  const user = _auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  // In-memory duplicate check
  if (registeredSet.has(eventId)) throw new Error('ALREADY_REGISTERED');

  const docId = `${eventId}_${user.uid}`;
  const regRef = _db.collection('registrations').doc(docId);
  const evRef  = _db.collection('events').doc(eventId);

  const profile = await getMyProfile();
  let assignedCode = null;

  // Retry up to 5 times in case of entry code collision
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidateCode = _genCode();
    const codeRef = _db.collection('entry_codes').doc(candidateCode);

    try {
      await _db.runTransaction(async tx => {
        const evDoc   = await tx.get(evRef);
        const codeDoc = await tx.get(codeRef);

        if (!evDoc.exists) throw new Error('Event not found.');
        const evData = evDoc.data();

        // Enforce registration deadline in Asia/Kolkata timezone
        if (isEventExpired(evData.date, evData.time)) {
          throw new Error('EVENT_EXPIRED');
        }

        if (codeDoc.exists) throw new Error('CODE_COLLISION');

        const { capacity = 100, registeredCount = 0 } = evData;
        if (registeredCount >= capacity) throw new Error('EVENT_FULL');

        tx.set(regRef, {
          eventId,
          uid:          user.uid,
          studentName:  profile?.full_name || '',
          studentEmail: user.email,
          rollNumber:   profile?.roll_number || '',
          entryCode:    candidateCode,
          entered:      false,
          enteredAt:    null,
          registeredAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        tx.set(codeRef, {
          regId:     docId,
          eventId,
          uid:       user.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        tx.update(evRef, {
          registeredCount: firebase.firestore.FieldValue.increment(1)
        });
      });

      assignedCode = candidateCode;
      break;
    } catch (txErr) {
      if (txErr.message === 'CODE_COLLISION') {
        continue;
      }
      throw txErr;
    }
  }

  if (!assignedCode) {
    throw new Error('Failed to generate a unique entry code. Please try again.');
  }

  registeredSet.add(eventId);
  eventLRUCache.invalidate(eventId);
  const cs = getSeatCounter(eventId);
  if (cs) updateSeatCounter(eventId, cs.registered + 1, cs.capacity);
  return assignedCode;
}

async function apiGetMyRegistrations() {
  const user = _auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const snap = await _db.collection('registrations')
    .where('uid', '==', user.uid)
    .get();
  const regs = [];
  snap.forEach(doc => {
    const d = doc.data();
    const eventId = d.eventId || d.event_id || '';
    const entryCode = d.entryCode || d.entry_code || d.code || '';
    if (eventId) registeredSet.add(eventId);
    regs.push({
      id:         doc.id,
      event_id:   eventId,
      entry_code: entryCode,
      entered:    !!d.entered,
      entered_at: d.enteredAt?.toDate?.() || d.entered_at?.toDate?.() || null,
      created_at: d.registeredAt?.toDate?.() || d.created_at?.toDate?.() || null
    });
  });
  regs.sort((a, b) => {
    const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tB - tA;
  });
  return regs;
}

// Admin: verify an entry code (searches by entryCode or entry_code)
async function apiVerifyEntry(code) {
  const cleanCode = code.trim().toUpperCase();
  let snap = await _db.collection('registrations')
    .where('entryCode', '==', cleanCode)
    .limit(1)
    .get();
  if (snap.empty) {
    snap = await _db.collection('registrations')
      .where('entry_code', '==', cleanCode)
      .limit(1)
      .get();
  }
  if (snap.empty) return null;
  const doc  = snap.docs[0];
  const d    = doc.data();
  const eventId = d.eventId || d.event_id || '';
  const evSnap = eventId ? await _db.collection('events').doc(eventId).get() : { exists: false };
  const ev     = evSnap.exists ? evSnap.data() : {};
  return {
    entry_code:  d.entryCode || d.entry_code || cleanCode,
    full_name:   d.studentName || d.name || 'Student',
    roll_number: d.rollNumber || d.roll_number || '',
    email:       d.studentEmail || d.email || '',
    entered:     !!d.entered,
    entered_at:  d.enteredAt?.toDate?.() || d.entered_at?.toDate?.() || null,
    event_title: ev.title || 'College Event',
    event_venue: ev.venue || 'Campus Hall',
    event_date:  ev.date  || ''
  };
}

// Admin: mark attendee as entered (atomic in Firestore transaction)
async function apiMarkEntered(code) {
  const cleanCode = code.trim().toUpperCase();
  let snap = await _db.collection('registrations')
    .where('entryCode', '==', cleanCode)
    .limit(1)
    .get();
  if (snap.empty) {
    snap = await _db.collection('registrations')
      .where('entry_code', '==', cleanCode)
      .limit(1)
      .get();
  }
  if (snap.empty) return { ok: false, error: 'INVALID_CODE' };
  const regRef = snap.docs[0].ref;

  try {
    await _db.runTransaction(async tx => {
      const regDoc = await tx.get(regRef);
      if (!regDoc.exists) {
        throw new Error('INVALID_CODE');
      }
      if (regDoc.data().entered) {
        throw new Error('ALREADY_ENTERED');
      }
      tx.update(regRef, {
        entered:   true,
        enteredAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    eventLRUCache.invalidate();
    return { ok: true };
  } catch (err) {
    if (err.message === 'INVALID_CODE') return { ok: false, error: 'INVALID_CODE' };
    if (err.message === 'ALREADY_ENTERED') return { ok: false, error: 'ALREADY_ENTERED' };
    throw err;
  }
}

// Admin: get all registrations for one event (for CSV export)
async function apiGetEventRegistrations(eventId) {
  const snap = await _db.collection('registrations')
    .where('eventId', '==', eventId)
    .get();
  const rows = [];
  snap.forEach(doc => {
    const d = doc.data();
    rows.push({
      full_name:   d.studentName,
      roll_number: d.rollNumber || '',
      email:       d.studentEmail,
      created_at:  d.registeredAt?.toDate?.() || null,
      entered:     d.entered,
      entered_at:  d.enteredAt?.toDate?.() || null,
      entry_code:  d.entryCode
    });
  });
  rows.sort((a, b) => {
    const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tA - tB;
  });
  return rows;
}

// Admin: all registrations across all events (for dashboard stats & audit log)
async function apiGetAllRegistrationsAdmin() {
  const snap = await _db.collection('registrations')
    .orderBy('registeredAt', 'desc')
    .get();
  const regs = [];
  snap.forEach(doc => {
    const d = doc.data();
    regs.push({
      id:           doc.id,
      event_id:     d.eventId || d.event_id || '',
      user_id:      d.uid || d.user_id || '',
      student_name: d.studentName || d.name || '',
      roll_number:  d.rollNumber || d.roll_number || '',
      entry_code:   d.entryCode || d.entry_code || d.code || '',
      entered:      !!d.entered,
      entered_at:   d.enteredAt?.toDate?.() || d.entered_at?.toDate?.() || null,
      created_at:   d.registeredAt?.toDate?.() || d.created_at?.toDate?.() || null
    });
  });
  return regs;
}

// Admin: all user profiles (for audit log display)
async function apiGetAllProfilesAdmin() {
  const snap = await _db.collection('users').get();
  const profiles = [];
  snap.forEach(doc => {
    const d = doc.data();
    profiles.push({ id: doc.id, full_name: d.name || '', roll_number: d.rollNumber || '' });
  });
  return profiles;
}

// ─── REALTIME (onSnapshot listener for student events view) ──────────────────
/**
 * setupRealtime: called from initSystem.
 * Replaces the Supabase realtime channel with a Firestore onSnapshot listener
 * on published events. Triggers app.js callbacks on any change.
 */
function setupRealtime({ onEventsChange, onRegsChange }) {
  _unsubscribeAll();

  // Listen for published events without composite index requirement
  _unsubEvents = _db.collection('events')
    .where('status', '==', 'published')
    .onSnapshot(() => {
      eventLRUCache.invalidate();
      if (typeof onEventsChange === 'function') onEventsChange();
    }, err => console.warn('events listener error:', err));

  // Listen for current user's registrations
  const user = _auth.currentUser;
  if (user) {
    _unsubMyRegs = _db.collection('registrations')
      .where('uid', '==', user.uid)
      .onSnapshot(() => {
        if (typeof onRegsChange === 'function') onRegsChange();
      }, err => console.warn('regs listener error:', err));
  }
}

function teardownRealtime() { _unsubscribeAll(); }

// ─── CSV EXPORT (formula-injection protected) ───────────────────────────────
function csvSafeCell(val) {
  const s = String(val ?? '');
  const trimmed = s.trim();
  const escaped = (trimmed.startsWith('=') || trimmed.startsWith('+') || trimmed.startsWith('-') || trimmed.startsWith('@'))
    ? "'" + s : s;
  return '"' + escaped.replace(/"/g, '""') + '"';
}

async function exportEventCsv(eventId, eventTitle) {
  const rows = await apiGetEventRegistrations(eventId);
  const header = ['Name', 'Roll Number', 'Email', 'Registered At', 'Entered', 'Entered At', 'Entry Code'];
  const lines  = [header.map(csvSafeCell).join(',')];
  rows.forEach(r => {
    lines.push([
      r.full_name, r.roll_number || '', r.email,
      r.created_at ? new Date(r.created_at).toLocaleString() : '',
      r.entered ? 'Yes' : 'No',
      r.entered_at ? new Date(r.entered_at).toLocaleString() : '',
      r.entry_code
    ].map(csvSafeCell).join(','));
  });
  const bom  = '\uFEFF';
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = (eventTitle || 'event').replace(/[^a-z0-9]/gi, '_') + '_registrations.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

