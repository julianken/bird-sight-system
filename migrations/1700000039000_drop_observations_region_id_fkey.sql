-- Up Migration
-- #532 PR-3: drop the FK from observations to regions. The ingest path stopped
-- writing region_id in PR-1 (#534) and the wire shape dropped regionId in PR-2
-- (#535). FKs must be dropped before the underlying columns / parent table.
ALTER TABLE observations DROP CONSTRAINT IF EXISTS observations_region_id_fkey;

-- Down Migration
-- Best-effort restore. If a later migration in the chain has already dropped
-- the region_id column or the regions table, this ADD CONSTRAINT will fail —
-- expected, since the down chain unwinds in strict reverse order.
ALTER TABLE observations
  ADD CONSTRAINT observations_region_id_fkey
  FOREIGN KEY (region_id) REFERENCES regions(id);
