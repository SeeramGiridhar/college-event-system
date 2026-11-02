-- =============================================================
-- College Event Management System — Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New Query → Run
-- =============================================================

-- ─────────────────────────────────────────────
-- 0. EXTENSIONS
-- ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────
-- 1. TABLES
-- ─────────────────────────────────────────────

-- 1a. profiles (linked 1-to-1 with auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL DEFAULT '',
  roll_number TEXT UNIQUE,
  role        TEXT NOT NULL DEFAULT 'student'
                CHECK (role IN ('student', 'admin'))
);

-- 1b. events
CREATE TABLE IF NOT EXISTS public.events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  date        DATE NOT NULL,
  time        TIME,
  venue       TEXT,
  description TEXT,
  capacity    INTEGER NOT NULL DEFAULT 100 CHECK (capacity > 0),
  category    TEXT NOT NULL DEFAULT 'general',
  status      TEXT NOT NULL DEFAULT 'upcoming',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1c. registrations
CREATE TABLE IF NOT EXISTS public.registrations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_code  TEXT NOT NULL UNIQUE,
  entered     BOOLEAN NOT NULL DEFAULT FALSE,
  entered_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, user_id)
);

-- ─────────────────────────────────────────────
-- 2. INDEXES (Optimized for fast queries & RLS)
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_events_date             ON public.events(date);
CREATE INDEX IF NOT EXISTS idx_events_status_category  ON public.events(status, category);
CREATE INDEX IF NOT EXISTS idx_events_capacity         ON public.events(capacity);
CREATE INDEX IF NOT EXISTS idx_registrations_event_id  ON public.registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_user_id   ON public.registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_registrations_code      ON public.registrations(entry_code);

-- ─────────────────────────────────────────────
-- 3. SECURITY DEFINER HELPER (avoids RLS recursion)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' FROM public.profiles WHERE id = auth.uid()),
    FALSE
  );
$$;

-- ─────────────────────────────────────────────
-- 4. TRIGGER: auto-create profile on signup
--    Role is ALWAYS 'student' — never trusted from metadata.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, roll_number, role)
  VALUES (
    NEW.id,
    COALESCE(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(UPPER(TRIM(COALESCE(NEW.raw_user_meta_data->>'roll_number', ''))), ''),
    'student'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────
-- 5. TRIGGER: restrict to @stpetershyd.com domain
--    Applies to ALL signup methods incl. Google OAuth.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_college_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NULL OR NEW.email NOT ILIKE '%@stpetershyd.com' THEN
    RAISE EXCEPTION 'Only @stpetershyd.com email addresses are permitted.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_college_email_on_insert ON auth.users;
CREATE TRIGGER enforce_college_email_on_insert
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_college_email();

-- ─────────────────────────────────────────────
-- 6. TRIGGER: prevent role escalation via profile UPDATE
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.role := OLD.role;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_update_no_role ON public.profiles;
CREATE TRIGGER on_profile_update_no_role
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_change();

-- ─────────────────────────────────────────────
-- 7. ROW LEVEL SECURITY (RLS)
-- ─────────────────────────────────────────────
ALTER TABLE public.profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;

-- profiles
DROP POLICY IF EXISTS "profiles_select_own"   ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own"   ON public.profiles;

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "profiles_select_admin"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- events
DROP POLICY IF EXISTS "events_select_auth" ON public.events;
DROP POLICY IF EXISTS "events_write_admin" ON public.events;

CREATE POLICY "events_select_auth"
  ON public.events FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "events_write_admin"
  ON public.events FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- registrations (students: read own only; admins: read all; no direct writes)
DROP POLICY IF EXISTS "regs_select_own"   ON public.registrations;
DROP POLICY IF EXISTS "regs_select_admin" ON public.registrations;

CREATE POLICY "regs_select_own"
  ON public.registrations FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "regs_select_admin"
  ON public.registrations FOR SELECT
  USING (public.is_admin());

-- ─────────────────────────────────────────────
-- 8. ENTRY CODE GENERATOR (8 chars, uppercase, no 0/O/1/I)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_entry_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code     TEXT := '';
  attempt  INTEGER := 0;
  exists   BOOLEAN;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..8 LOOP
      code := code || SUBSTR(alphabet, (FLOOR(RANDOM() * LENGTH(alphabet)) + 1)::INTEGER, 1);
    END LOOP;

    SELECT TRUE INTO exists
    FROM public.registrations
    WHERE entry_code = code;

    EXIT WHEN NOT FOUND OR attempt > 100;
    attempt := attempt + 1;
  END LOOP;
  RETURN code;
END;
$$;

-- ─────────────────────────────────────────────
-- 9. RPC: register_for_event
--    Locks the event row FOR UPDATE, prevents overselling
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_capacity   INTEGER;
  v_registered BIGINT;
  v_code       TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT capacity INTO v_capacity
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.registrations
    WHERE event_id = p_event_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'ALREADY_REGISTERED';
  END IF;

  SELECT COUNT(*) INTO v_registered
  FROM public.registrations
  WHERE event_id = p_event_id;

  IF v_registered >= v_capacity THEN
    RAISE EXCEPTION 'EVENT_FULL';
  END IF;

  v_code := public.generate_entry_code();

  INSERT INTO public.registrations (event_id, user_id, entry_code)
  VALUES (p_event_id, v_user_id, v_code);

  RETURN v_code;
END;
$$;

-- ─────────────────────────────────────────────
-- 10. RPC: events_with_counts
--     Aggregates seat counts without letting students read other registrations
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.events_with_counts()
RETURNS TABLE (
  id            UUID,
  title         TEXT,
  date          DATE,
  time          TIME,
  venue         TEXT,
  description   TEXT,
  capacity      INTEGER,
  category      TEXT,
  status        TEXT,
  registered    BIGINT,
  seats_left    INTEGER,
  is_full       BOOLEAN,
  my_entry_code TEXT,
  created_at    TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    e.title,
    e.date,
    e.time,
    e.venue,
    e.description,
    e.capacity,
    e.category,
    e.status,
    COUNT(r.id)                                         AS registered,
    GREATEST(0, e.capacity - COUNT(r.id)::INTEGER)      AS seats_left,
    COUNT(r.id) >= e.capacity                           AS is_full,
    (SELECT entry_code FROM public.registrations
       WHERE event_id = e.id AND user_id = auth.uid()
       LIMIT 1)                                        AS my_entry_code,
    e.created_at
  FROM public.events e
  LEFT JOIN public.registrations r ON r.event_id = e.id
  WHERE auth.uid() IS NOT NULL
  GROUP BY e.id
  ORDER BY e.date ASC;
$$;

-- ─────────────────────────────────────────────
-- 11. RPC: verify_entry (admin only)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_entry(p_code TEXT)
RETURNS TABLE (
  registration_id UUID,
  entry_code      TEXT,
  entered         BOOLEAN,
  entered_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ,
  event_id        UUID,
  event_title     TEXT,
  event_date      DATE,
  event_venue     TEXT,
  user_id         UUID,
  full_name       TEXT,
  roll_number     TEXT,
  email           TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.entry_code,
    r.entered,
    r.entered_at,
    r.created_at,
    e.id,
    e.title,
    e.date,
    e.venue,
    p.id,
    p.full_name,
    p.roll_number,
    u.email
  FROM public.registrations r
  JOIN public.events   e ON e.id = r.event_id
  JOIN public.profiles p ON p.id = r.user_id
  JOIN auth.users      u ON u.id = r.user_id
  WHERE r.entry_code = UPPER(TRIM(p_code));
END;
$$;

-- ─────────────────────────────────────────────
-- 12. RPC: mark_entered (admin only, atomic)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_entered(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entered BOOLEAN;
  v_id      UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  SELECT id, entered INTO v_id, v_entered
  FROM public.registrations
  WHERE entry_code = UPPER(TRIM(p_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  END IF;

  IF v_entered THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_ENTERED');
  END IF;

  UPDATE public.registrations
  SET entered = TRUE, entered_at = NOW()
  WHERE id = v_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─────────────────────────────────────────────
-- 13. RPC: get_event_registrations (admin only, for CSV export)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_event_registrations(p_event_id UUID)
RETURNS TABLE (
  full_name   TEXT,
  roll_number TEXT,
  email       TEXT,
  created_at  TIMESTAMPTZ,
  entered     BOOLEAN,
  entered_at  TIMESTAMPTZ,
  entry_code  TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;

  RETURN QUERY
  SELECT
    p.full_name,
    p.roll_number,
    u.email,
    r.created_at,
    r.entered,
    r.entered_at,
    r.entry_code
  FROM public.registrations r
  JOIN public.profiles p ON p.id = r.user_id
  JOIN auth.users      u ON u.id = r.user_id
  WHERE r.event_id = p_event_id
  ORDER BY r.created_at ASC;
END;
$$;

-- =============================================================
-- PROMOTE AN ADMIN (run manually in SQL Editor):
--
-- UPDATE public.profiles
-- SET role = 'admin'
-- WHERE id = (SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL@stpetershyd.com');
--
-- =============================================================
