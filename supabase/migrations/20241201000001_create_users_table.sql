-- Create user role enum
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'analyst', 'viewer');

-- Create users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  role user_role NOT NULL DEFAULT 'viewer',
  department VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to users table
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
CREATE POLICY "Users can view their own profile" ON users
  FOR SELECT
  USING (auth.uid()::text = id);

CREATE POLICY "Admins can view all users" ON users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()::text
      AND role = 'admin'
      AND is_active = true
    )
  );

CREATE POLICY "Managers can view users in their department" ON users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()::text
      AND u.role IN ('admin', 'manager')
      AND u.is_active = true
      AND (u.role = 'admin' OR u.department = users.department)
    )
  );

CREATE POLICY "Admins can insert users" ON users
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()::text
      AND role = 'admin'
      AND is_active = true
    )
  );

CREATE POLICY "Admins can update users" ON users
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()::text
      AND role = 'admin'
      AND is_active = true
    )
  );

CREATE POLICY "Users can update their own profile (limited)" ON users
  FOR UPDATE
  USING (auth.uid()::text = id)
  WITH CHECK (
    auth.uid()::text = id
    AND OLD.role = NEW.role  -- Cannot change own role
    AND OLD.is_active = NEW.is_active  -- Cannot change own active status
  );

-- Create basic admin user (placeholder - replace with actual admin)
INSERT INTO users (email, first_name, last_name, role, department, is_active)
VALUES (
  'admin@flowseer.com',
  'System',
  'Administrator',
  'admin',
  'IT',
  true
) ON CONFLICT (email) DO NOTHING;

-- Add helpful comments
COMMENT ON TABLE users IS 'User accounts with role-based access control';
COMMENT ON COLUMN users.role IS 'User role: admin (full access), manager (department scope), analyst (read/write RFQs), viewer (read-only)';
COMMENT ON COLUMN users.is_active IS 'Whether user account is active and can log in';
COMMENT ON COLUMN users.last_login_at IS 'Timestamp of last successful login for security monitoring';