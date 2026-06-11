-- FlowSeer W251 BOP | FSW251-SCHEMA-AUTH-AUDIT-001 | created_at: 2024-01-15T10:00:00Z

BEGIN;

-- Create authorization audit log table
CREATE TABLE IF NOT EXISTS "authorization_audit_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" text NOT NULL,
    "role" text NOT NULL,
    "http_method" text NOT NULL,
    "resource" text NOT NULL,
    "action" text NOT NULL,
    "ip_address" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- Add CHECK constraints for enum-like domains
ALTER TABLE "authorization_audit_log" 
ADD CONSTRAINT "chk_authorization_audit_log_action" 
CHECK ("action" IN ('ALLOW', 'DENY'));

ALTER TABLE "authorization_audit_log" 
ADD CONSTRAINT "chk_authorization_audit_log_http_method" 
CHECK ("http_method" IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'));

-- Create trigger function to prevent mutations (append-only enforcement)
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'authorization_audit_log is append-only: UPDATE and DELETE are forbidden';
END;
$$;

-- Create trigger to prevent UPDATE and DELETE operations
CREATE TRIGGER trg_prevent_audit_log_mutation
    BEFORE UPDATE OR DELETE ON "authorization_audit_log"
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_mutation();

-- Create RULE to prevent UPDATE operations (defense-in-depth)
CREATE OR REPLACE RULE no_update_authorization_audit_log
AS ON UPDATE TO "authorization_audit_log"
DO INSTEAD NOTHING;

-- Create RULE to prevent DELETE operations (defense-in-depth)
CREATE OR REPLACE RULE no_delete_authorization_audit_log
AS ON DELETE TO "authorization_audit_log"
DO INSTEAD NOTHING;

COMMIT;