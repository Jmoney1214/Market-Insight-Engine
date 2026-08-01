-- Additive, idempotent repair for databases created before journal idempotency.
-- The application schema already models this nullable column and unique index.
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_event_id_uq
  ON public.journal_entries (event_id);
