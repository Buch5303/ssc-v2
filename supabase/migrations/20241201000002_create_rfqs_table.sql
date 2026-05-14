-- Create RFQ status enum
CREATE TYPE rfq_status AS ENUM ('draft', 'published', 'in_review', 'awarded', 'cancelled');

-- Create RFQ priority enum
CREATE TYPE rfq_priority AS ENUM ('low', 'medium', 'high', 'urgent');

-- Create RFQs table
CREATE TABLE rfqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_number VARCHAR(50) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status rfq_status NOT NULL DEFAULT 'draft',
  budget_min DECIMAL(15,2),
  budget_max DECIMAL(15,2),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  submission_deadline TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  priority rfq_priority NOT NULL DEFAULT 'medium',
  category VARCHAR(100),
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Apply updated_at trigger to RFQs table
CREATE TRIGGER update_rfqs_updated_at
  BEFORE UPDATE ON rfqs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add constraints
ALTER TABLE rfqs ADD CONSTRAINT rfqs_budget_min_positive CHECK (budget_min IS NULL OR budget_min >= 0);
ALTER TABLE rfqs ADD CONSTRAINT rfqs_budget_max_positive CHECK (budget_max IS NULL OR budget_max >= 0);
ALTER TABLE rfqs ADD CONSTRAINT rfqs_budget_range CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max);
ALTER TABLE rfqs ADD CONSTRAINT rfqs_currency_length CHECK (length(currency) = 3);
ALTER TABLE rfqs ADD CONSTRAINT rfqs_submission_deadline_future CHECK (submission_deadline IS NULL OR submission_deadline > created_at);
ALTER TABLE rfqs ADD CONSTRAINT rfqs_rfq_number_format CHECK (rfq_number ~ '^RFQ-[0-9]{4}-[0-9]{4}$');

-- Create function for generating RFQ numbers
CREATE OR REPLACE FUNCTION generate_rfq_number()
RETURNS TEXT AS $$
DECLARE
  current_year TEXT;
  sequence_num TEXT;
  rfq_num TEXT;
  max_attempts INTEGER := 100;
  attempt INTEGER := 0;
BEGIN
  current_year := EXTRACT(YEAR FROM timezone('utc', now()))::TEXT;
  
  LOOP
    attempt := attempt + 1;
    IF attempt > max_attempts THEN
      RAISE EXCEPTION 'Unable to generate unique RFQ number after % attempts', max_attempts;
    END IF;
    
    -- Generate 4-digit sequence number
    sequence_num := LPAD((RANDOM() * 9999)::INTEGER::TEXT, 4, '0');
    rfq_num := 'RFQ-' || current_year || '-' || sequence_num;
    
    -- Check if number already exists
    IF NOT EXISTS (SELECT 1 FROM rfqs WHERE rfq_number = rfq_num) THEN
      RETURN rfq_num;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-generate RFQ number on insert
CREATE OR REPLACE FUNCTION set_rfq_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.rfq_number IS NULL OR NEW.rfq_number = '' THEN
    NEW.rfq_number := generate_rfq_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger for RFQ number generation
CREATE TRIGGER set_rfqs_rfq_number
  BEFORE INSERT ON rfqs
  FOR EACH ROW
  EXECUTE FUNCTION set_rfq_number();

-- Enable RLS
ALTER TABLE rfqs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for RFQs table
CREATE POLICY "Users can view RFQs based on role" ON rfqs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()::text
      AND u.is_active = true
      AND (
        u.role IN ('admin', 'manager')  -- Admins and managers see all
        OR created_by = auth.uid()::text  -- Users see their own
        OR assigned_to = auth.uid()::text  -- Users see assigned to them
        OR (u.role = 'analyst' AND status IN ('published', 'in_review', 'awarded'))  -- Analysts see non-draft
        OR (u.role = 'viewer' AND status = 'published')  -- Viewers see published only
      )
    )
  );

CREATE POLICY "Users can insert RFQs based on role" ON rfqs
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()::text
      AND role IN ('admin', 'manager', 'analyst')
      AND is_active = true
    )
  );

CREATE POLICY "Users can update RFQs based on role and ownership" ON rfqs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()::text
      AND u.is_active = true
      AND (
        u.role IN ('admin', 'manager')  -- Admins and managers can update all
        OR (created_by = auth.uid()::text AND u.role IN ('analyst'))  -- Analysts can update their own
        OR (assigned_to = auth.uid()::text AND u.role IN ('analyst'))  -- Analysts can update assigned
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()::text
      AND u.is_active = true
      AND (
        u.role IN ('admin', 'manager')
        OR (created_by = auth.uid()::text AND u.role IN ('analyst'))
        OR (assigned_to = auth.uid()::text AND u.role IN ('analyst'))
      )
    )
  );

CREATE POLICY "Only admins can delete RFQs" ON rfqs
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()::text
      AND role = 'admin'
      AND is_active = true
    )
  );

-- Add helpful comments
COMMENT ON TABLE rfqs IS 'Request for Quotation records with full lifecycle tracking';
COMMENT ON COLUMN rfqs.rfq_number IS 'Unique RFQ identifier in format RFQ-YYYY-NNNN';
COMMENT ON COLUMN rfqs.status IS 'RFQ lifecycle status: draft -> published -> in_review -> awarded/cancelled';
COMMENT ON COLUMN rfqs.budget_min IS 'Minimum budget in specified currency, with 2 decimal precision';
COMMENT ON COLUMN rfqs.budget_max IS 'Maximum budget in specified currency, with 2 decimal precision';
COMMENT ON COLUMN rfqs.currency IS 'ISO 4217 currency code (3 characters)';
COMMENT ON COLUMN rfqs.tags IS 'Array of searchable tags for categorization';
COMMENT ON COLUMN rfqs.metadata IS 'Flexible JSON storage for custom fields and integrations';