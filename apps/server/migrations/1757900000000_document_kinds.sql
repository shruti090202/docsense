-- Up Migration

ALTER TABLE documents
  ADD COLUMN kind text NOT NULL DEFAULT 'general' CHECK (kind IN ('loan', 'contract', 'general')),
  ADD COLUMN contract_facts jsonb,
  ADD COLUMN outline jsonb;

-- Down Migration

ALTER TABLE documents DROP COLUMN outline, DROP COLUMN contract_facts, DROP COLUMN kind;
