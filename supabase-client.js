/**
 * supabase-client.js
 * Supabase Database & Auth engine for College Event Management System.
 *
 * Credentials are injected at build time by netlify.toml (sed replacement).
 * The placeholders below must match exactly what netlify.toml sed-replaces.
 * During local dev, fallback to localStorage or prompt if unreplaced.
 */

// ─── Env vars injected at build time by Netlify ───────────────────────────────
const _RAW_URL = '__SUPABASE_URL__';
const _RAW_KEY = '__SUPABASE_ANON_KEY__';
const _RAW_APP = '__APP_URL__';

const SUPABASE_URL = (!_RAW_URL.startsWith('__') ? _RAW_URL : (localStorage.getItem('cem_supabase_url') || ''));
const SUPABASE_ANON_KEY = (!_RAW_KEY.startsWith('__') ? _RAW_KEY : (localStorage.getItem('cem_supabase_key') || ''));
const APP_URL = (!_RAW_APP.startsWith('__') ? _RAW_APP : (window.location?.origin || 'http://localhost:8888'));

// ─── Supabase client init ─────────────────────────────────────────────────────
let _supabase = null;
if (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY) {
  try {
    _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      }
    });
  } catch (err) {
    console.error('Supabase initialization error:', err);
  }
}

function isSupabaseConfigured() {
  return !!_supabase && !!SUPABASE_URL && !SUPABASE_URL.startsWith('__');
}

function checkSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
}

// ─── LRU Cache (capacity 50) for GET /events/:id ─────────────────────────────
class EventLRUCache {
  constructor(capacity = 50) {
    this.capacity = capacity;
    this.cache = new Map();
  }
  get(key) {
    if (!this.cache.has(key)) return null;
    const v = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, v);
    return v;
  }
  put(key, val) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, val);
  }
  invalidate(key = null) {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }
}
const eventLRUCache = new EventLRUCache(50);

// ─── In-memory Sets & Seat Counters ──────────────────────────────────────────
// Duplicate registration checks cache (eventId string)
const registeredSet = new Set();

// In-memory seat counter cache
const seatCounterMap = new Map(); // eventId -> { registered, capacity, seats_left }

function updateSeatCounter(eventId, registered, capacity) {
  const cap = Number(capacity) || 100;
  const reg = Number(registered) || 0;
  seatCounterMap.set(String(eventId), {
    registered: reg,
    capacity: cap,
    seats_left: Math.max(0, cap - reg)
  });
}

function getSeatCounter(eventId) {
  return seatCounterMap.get(String(eventId)) || null;
}

// ─── Debounce helper (300 ms) ────────────────────────────────────────────────
function debounce(fn, ms = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ─── HTML escape for XSS prevention ──────────────────────────────────────────
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── AUTHENTICATION (Supabase Auth) ──────────────────────────────────────────

async function authSignUp({ email, password, fullName, rollNumber }) {
  checkSupabase();
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail.endsWith('@stpetershyd.com')) {
    throw new Error('Only @stpetershyd.com email addresses are permitted.');
  }

  const { data, error } = await _supabase.auth.signUp({
    email: trimmedEmail,
    password,
    options: {
      data: {
        full_name: fullName.trim(),
        roll_number: rollNumber.trim().toUpperCase()
      }
    }
  });
  if (error) throw error;
  return data;
}

async function authSignIn({ email, password }) {
  checkSupabase();
  const trimmedEmail = email.trim().toLowerCase();
  const { data, error } = await _supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password
  });
  if (error) throw error;
  return data;
}

async function authSignInWithGoogle() {
  checkSupabase();
  const { error } = await _supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: APP_URL
    }
  });
  if (error) throw error;
}

async function authSignOut() {
  if (_supabase) {
    await _supabase.auth.signOut();
  }
  registeredSet.clear();
  eventLRUCache.invalidate();
  // Clear any legacy localStorage keys
  localStorage.removeItem('cem_currentStudent');
  localStorage.removeItem('cem_currentAdmin');
}

async function authSendPasswordReset(email) {
  checkSupabase();
  const trimmedEmail = email.trim().toLowerCase();
  const { error } = await _supabase.auth.resetPasswordForEmail(trimmedEmail, {
    redirectTo: APP_URL
  });
  if (error) throw error;
}

async function authUpdatePassword(newPassword) {
  checkSupabase();
  const { error } = await _supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

async function authGetSession() {
  if (!_supabase) return null;
  const { data } = await _supabase.auth.getSession();
  return data.session;
}

async function authGetUser() {
  if (!_supabase) return null;
  const { data } = await _supabase.auth.getUser();
  return data.user;
}

// Load profile row for current user
async function getMyProfile() {
  const user = await authGetUser();
  if (!user) return null;
  const { data, error } = await _supabase
    .from('profiles')
    .select('id, full_name, roll_number, role')
    .eq('id', user.id)
    .maybeSingle();
  if (error) console.warn('getMyProfile error:', error.message);
  return data;
}

// Update own profile (name + roll only; role is blocked by DB trigger)
async function updateMyProfile({ fullName, rollNumber }) {
  const user = await authGetUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await _supabase
    .from('profiles')
    .update({
      full_name: fullName.trim(),
      roll_number: rollNumber.trim().toUpperCase()
    })
    .eq('id', user.id);
  if (error) throw error;
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────

// Student view: uses events_with_counts() RPC (no direct registration read)
async function apiFetchEventsWithCounts() {
  checkSupabase();
  const { data, error } = await _supabase.rpc('events_with_counts');
  if (error) throw error;
  const events = data || [];
  events.forEach(ev => {
    eventLRUCache.put(ev.id, ev);
    updateSeatCounter(ev.id, ev.registered, ev.capacity);
    if (ev.my_entry_code) {
      registeredSet.add(String(ev.id));
    }
  });
  return events;
}

// Admin view: direct events table read
async function apiFetchEventsAdmin(search = '') {
  checkSupabase();
  let q = _supabase
    .from('events')
    .select('id, title, date, time, venue, description, capacity, category, status, created_at')
    .order('date', { ascending: true });
  if (search) {
    q = q.ilike('title', '%' + search + '%');
  }
  const { data, error } = await q;
  if (error) throw error;
  const events = data || [];
  events.forEach(ev => {
    eventLRUCache.put(ev.id, ev);
  });
  return events;
}

async function apiFetchEventById(id) {
  const cached = eventLRUCache.get(id);
  if (cached) return cached;
  checkSupabase();
  const { data, error } = await _supabase
    .from('events')
    .select('id, title, date, time, venue, description, capacity, category, status, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (data) eventLRUCache.put(id, data);
  return data;
}

async function apiCreateEvent({ title, date, time, venue, description, capacity }) {
  checkSupabase();
  eventLRUCache.invalidate();
  const cap = parseInt(capacity, 10) || 100;
  const { data, error } = await _supabase
    .from('events')
    .insert([{
      title: title.trim(),
      date,
      time: time || null,
      venue: venue.trim(),
      description: description.trim(),
      capacity: cap
    }])
    .select('id')
    .single();
  if (error) throw error;
  updateSeatCounter(data.id, 0, cap);
  return data;
}

async function apiUpdateEvent(id, fields) {
  checkSupabase();
  eventLRUCache.invalidate(id);
  const cap = parseInt(fields.capacity, 10) || 100;
  const { error } = await _supabase
    .from('events')
    .update({
      title: fields.title.trim(),
      date: fields.date,
      time: fields.time || null,
      venue: fields.venue.trim(),
      description: fields.description.trim(),
      capacity: cap
    })
    .eq('id', id);
  if (error) throw error;
  const existing = getSeatCounter(id);
  if (existing) {
    updateSeatCounter(id, existing.registered, cap);
  }
}

async function apiDeleteEvent(id) {
  checkSupabase();
  eventLRUCache.invalidate(id);
  seatCounterMap.delete(String(id));
  const { error } = await _supabase.from('events').delete().eq('id', id);
  if (error) throw error;
}

// ─── REGISTRATIONS ────────────────────────────────────────────────────────────

// Student registers via RPC — server enforces capacity & uniqueness with row locking
async function apiRegisterForEvent(eventId) {
  checkSupabase();
  const { data, error } = await _supabase.rpc('register_for_event', { p_event_id: eventId });
  if (error) {
    const msg = error.message || '';
    if (msg.includes('ALREADY_REGISTERED')) throw new Error('ALREADY_REGISTERED');
    if (msg.includes('EVENT_FULL')) throw new Error('EVENT_FULL');
    throw error;
  }
  // data is the 8-character unique entry code
  registeredSet.add(String(eventId));
  eventLRUCache.invalidate(eventId);

  const currentSeat = getSeatCounter(eventId);
  if (currentSeat) {
    updateSeatCounter(eventId, currentSeat.registered + 1, currentSeat.capacity);
  }
  return data;
}

// Student: fetch own registrations
async function apiGetMyRegistrations() {
  checkSupabase();
  const { data, error } = await _supabase
    .from('registrations')
    .select('id, event_id, entry_code, entered, entered_at, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Admin: verify entry code
async function apiVerifyEntry(code) {
  checkSupabase();
  const { data, error } = await _supabase.rpc('verify_entry', { p_code: code.trim().toUpperCase() });
  if (error) throw error;
  return (data && data.length > 0) ? data[0] : null;
}

// Admin: mark entered (atomic, returns { ok, error } from DB)
async function apiMarkEntered(code) {
  checkSupabase();
  const { data, error } = await _supabase.rpc('mark_entered', { p_code: code.trim().toUpperCase() });
  if (error) throw error;
  eventLRUCache.invalidate();
  return data; // { ok: true } or { ok: false, error: 'ALREADY_ENTERED'|'INVALID_CODE' }
}

// Admin: get all registrations for an event (for CSV export)
async function apiGetEventRegistrations(eventId) {
  checkSupabase();
  const { data, error } = await _supabase.rpc('get_event_registrations', { p_event_id: eventId });
  if (error) throw error;
  return data || [];
}

// Admin: all registrations across all events (for dashboard stats)
async function apiGetAllRegistrationsAdmin() {
  checkSupabase();
  const { data, error } = await _supabase
    .from('registrations')
    .select('id, event_id, user_id, entry_code, entered, entered_at, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Admin: all profiles (for registrations audit log)
async function apiGetAllProfilesAdmin() {
  checkSupabase();
  const { data, error } = await _supabase
    .from('profiles')
    .select('id, full_name, roll_number');
  if (error) throw error;
  return data || [];
}

// ─── REALTIME ─────────────────────────────────────────────────────────────────
let _realtimeChannel = null;

function setupRealtime({ onEventsChange, onRegsChange }) {
  if (!_supabase) return;
  if (_realtimeChannel) {
    _supabase.removeChannel(_realtimeChannel);
  }
  _realtimeChannel = _supabase
    .channel('cem_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => {
      eventLRUCache.invalidate();
      if (typeof onEventsChange === 'function') onEventsChange();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, () => {
      if (typeof onRegsChange === 'function') onRegsChange();
    })
    .subscribe();
}

function teardownRealtime() {
  if (_supabase && _realtimeChannel) {
    _supabase.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }
}

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────
function csvSafeCell(val) {
  const s = String(val ?? '');
  // Prefix injection-risky cells starting with = + - @ with an apostrophe
  const escaped = (s.startsWith('=') || s.startsWith('+') || s.startsWith('-') || s.startsWith('@'))
    ? "'" + s
    : s;
  // Escape internal quotes and wrap in quotes
  return '"' + escaped.replace(/"/g, '""') + '"';
}

async function exportEventCsv(eventId, eventTitle) {
  const rows = await apiGetEventRegistrations(eventId);
  const header = ['Name', 'Roll Number', 'Email', 'Registered At', 'Entered', 'Entered At', 'Entry Code'];
  const lines = [header.map(csvSafeCell).join(',')];
  rows.forEach(r => {
    lines.push([
      r.full_name,
      r.roll_number || '',
      r.email,
      r.created_at ? new Date(r.created_at).toLocaleString() : '',
      r.entered ? 'Yes' : 'No',
      r.entered_at ? new Date(r.entered_at).toLocaleString() : '',
      r.entry_code
    ].map(csvSafeCell).join(','));
  });
  // UTF-8 BOM for Excel compatibility
  const bom = '\uFEFF';
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (eventTitle || 'event').replace(/[^a-z0-9]/gi, '_') + '_registrations.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
