-- CH-04: persist the natural-person detection onto the business row.
--
-- Computed fresh every time by detect-natural-person.js (it is cheap and
-- deterministic), but written back here so the reasoning is visible on the
-- business itself without re-running the detector, and so a person looking at
-- the businesses table directly can see why a lead is held.

UPDATE businesses SET
  is_natural_person     = $2::boolean,
  natural_person_reason = NULLIF($3, '')
WHERE id = $1::bigint;
