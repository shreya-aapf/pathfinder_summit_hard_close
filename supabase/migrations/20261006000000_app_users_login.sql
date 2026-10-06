-- Username/password login for the Pathfinder Summit portal.
-- Passwords are bcrypt-hashed inside Postgres. The table has RLS enabled with no policies
-- and no grants, so the anon key cannot read or write it; the app can only call the two
-- SECURITY DEFINER functions below, which never return a hash.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS app_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_key ON app_users (lower(username));

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_users FROM anon, authenticated;

CREATE OR REPLACE FUNCTION register_app_user(p_username TEXT, p_password TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF p_username IS NULL OR p_username !~ '^[A-Za-z0-9_.-]{3,32}$' THEN
        RETURN 'invalid_username';
    END IF;
    IF p_password IS NULL OR length(p_password) < 8 OR octet_length(p_password) > 72 THEN
        RETURN 'invalid_password';
    END IF;
    BEGIN
        INSERT INTO app_users (username, password_hash)
        VALUES (p_username, crypt(p_password, gen_salt('bf', 10)));
    EXCEPTION WHEN unique_violation THEN
        RETURN 'username_taken';
    END;
    RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION verify_app_user(p_username TEXT, p_password TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    u app_users%ROWTYPE;
BEGIN
    SELECT * INTO u FROM app_users WHERE lower(username) = lower(coalesce(p_username, ''));
    IF NOT FOUND THEN
        PERFORM crypt(coalesce(p_password, ''), gen_salt('bf', 10));
        RETURN 'invalid';
    END IF;
    IF u.locked_until IS NOT NULL AND u.locked_until > NOW() THEN
        RETURN 'locked';
    END IF;
    IF u.password_hash = crypt(coalesce(p_password, ''), u.password_hash) THEN
        UPDATE app_users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = u.id;
        RETURN 'ok';
    END IF;
    IF u.failed_attempts + 1 >= 5 THEN
        UPDATE app_users SET failed_attempts = 0, locked_until = NOW() + INTERVAL '5 minutes' WHERE id = u.id;
    ELSE
        UPDATE app_users SET failed_attempts = u.failed_attempts + 1 WHERE id = u.id;
    END IF;
    RETURN 'invalid';
END;
$$;

REVOKE ALL ON FUNCTION register_app_user(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION verify_app_user(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_app_user(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION verify_app_user(TEXT, TEXT) TO anon;
