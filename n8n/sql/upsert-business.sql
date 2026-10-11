-- CH-01: store a discovered business, idempotently.
--
-- Re-running a search must be free and must not create duplicates. The
-- UNIQUE index on google_place_id is the structural guarantee; this statement
-- is how the workflow cooperates with it.
--
-- What an existing row KEEPS on re-discovery:
--
--   * first_seen_at   - when we actually first saw them
--   * website_status  - CH-02's verdict. CH-01 must never reset a verified
--                       business back to PENDING, or every daily run would
--                       re-verify the whole database and re-spend on it.
--     This is the same shape of bug as the job-hunt repo's
--     "Flow 02 mapped Status: 'queued' and reset rows already marked sent",
--     which emailed six companies two or three times.
--
-- What it updates: the volatile facts. Ratings and review counts move, phone
-- numbers change, businesses close.
--
-- google_place_id is not the only unique index on this table - ux_biz_phone
-- exists too, because the same real business can appear under two different
-- Maps listings (a franchise's shared reception line, an agent's cell number
-- reused on their own listing and their agency's). ON CONFLICT can only
-- declare ONE target, so a place_id this table has never seen, carrying a
-- phone number some OTHER row already owns, used to fail this whole
-- statement with a bare UniqueViolation - not handled by ON CONFLICT at all,
-- because that clause only watches google_place_id. Found running this for
-- real: 150 Oslo real-estate listings, one agent's cell already on file
-- under a different place_id, and the insert died there instead of
-- continuing past it.
--
-- The fix is the same idea in both branches: SELECT ... WHERE NOT EXISTS
-- refuses to attempt a write that WOULD collide on phone under a different
-- place_id, on the INSERT side; DO UPDATE ... WHERE repeats the same check
-- so a re-scrape that changes an existing row's phone to one already claimed
-- elsewhere is skipped rather than erroring. Either way this business is
-- already represented in the table - by itself, or by the row that holds its
-- phone number - so silently leaving it as it was is correct, not a data
-- loss.

INSERT INTO businesses (
  google_place_id, search_target_id, niche,
  name, name_norm, category_primary, categories,
  address, street, city, state, country, country_code, postal_code,
  lat, lon, geohash7,
  phone_raw, phone_e164, email, listing_url, social_profiles,
  rating, review_count, price_level,
  permanently_closed, temporarily_closed,
  raw, source
)
SELECT
  $1, $2, $3,
  $4, $5, $6, $7,
  $8, $9, $10, $11, $12, $13, $14,
  $15, $16, $17,
  $18, $19, $20, $21, $22,
  $23, $24, $25,
  $26, $27,
  $28, $29
WHERE NOT EXISTS (
  SELECT 1 FROM businesses
  WHERE phone_e164 = NULLIF($19, '') AND google_place_id <> $1
)
ON CONFLICT (google_place_id) DO UPDATE SET
  last_seen_at       = now(),
  name               = EXCLUDED.name,
  name_norm          = EXCLUDED.name_norm,
  category_primary   = EXCLUDED.category_primary,
  categories         = EXCLUDED.categories,
  address            = EXCLUDED.address,
  city               = EXCLUDED.city,
  phone_raw          = EXCLUDED.phone_raw,
  phone_e164         = EXCLUDED.phone_e164,
  email              = COALESCE(NULLIF(EXCLUDED.email, ''), businesses.email),
  listing_url        = EXCLUDED.listing_url,
  social_profiles    = EXCLUDED.social_profiles,
  rating             = EXCLUDED.rating,
  review_count       = EXCLUDED.review_count,
  permanently_closed = EXCLUDED.permanently_closed,
  temporarily_closed = EXCLUDED.temporarily_closed,
  raw                = EXCLUDED.raw
WHERE NOT EXISTS (
  SELECT 1 FROM businesses b2
  WHERE b2.phone_e164 = NULLIF(EXCLUDED.phone_e164, '') AND b2.google_place_id <> EXCLUDED.google_place_id
)
RETURNING id, google_place_id, website_status, (xmax = 0) AS inserted;
-- xmax = 0 distinguishes an INSERT from an UPDATE, which is how the run
-- summary can honestly say "12 new, 38 already known" instead of "50 found"
-- every single day. A row skipped by either WHERE NOT EXISTS returns no row
-- at all - the caller counts that as neither, not as a failure.
