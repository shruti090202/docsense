-- Up Migration

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  source_type   text NOT NULL CHECK (source_type IN ('pdf', 'docx')),
  content_hash  text NOT NULL,
  page_count    integer NOT NULL,
  chunk_count   integer NOT NULL DEFAULT 0,
  is_sample     boolean NOT NULL DEFAULT false,
  sample_slug   text UNIQUE,
  status        text NOT NULL DEFAULT 'parsed' CHECK (status IN ('parsed', 'embedded', 'failed')),
  extraction    jsonb,
  risk_flags    jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);

CREATE INDEX documents_expires_at_idx ON documents (expires_at) WHERE NOT is_sample;

-- Chunks hold masked text only. Embeddings are filled in by a separate, resumable step so a
-- rate-limited embedding call never loses the parsed document.
CREATE TABLE chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index   integer NOT NULL,
  page_start    integer NOT NULL,
  page_end      integer NOT NULL,
  clause_title  text,
  content       text NOT NULL,
  token_count   integer NOT NULL,
  tsv           tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding     vector(768),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX chunks_document_id_idx ON chunks (document_id);
CREATE INDEX chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE embedding_cache (
  content_hash  text PRIMARY KEY,
  model         text NOT NULL,
  embedding     vector(768) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qa_cache (
  cache_key     text PRIMARY KEY,
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  response      jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX qa_cache_document_id_idx ON qa_cache (document_id);

-- Down Migration

DROP TABLE qa_cache;
DROP TABLE embedding_cache;
DROP TABLE chunks;
DROP TABLE documents;
