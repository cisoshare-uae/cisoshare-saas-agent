-- Least-privilege app roles for later hardening
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_read') THEN
    CREATE ROLE app_read LOGIN PASSWORD 'app_read_pw';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_write') THEN
    CREATE ROLE app_write LOGIN PASSWORD 'app_write_pw';
  END IF;
END$$;

GRANT USAGE ON SCHEMA public TO app_read, app_write;
GRANT SELECT ON contacts TO app_read;
GRANT SELECT, INSERT, UPDATE, DELETE ON contacts TO app_write;
