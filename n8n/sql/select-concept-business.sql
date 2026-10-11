-- CH-08: the business a /concept is for. $1 is what followed /concept: an
-- id (the reply alert gives one), or part of a name. Businesses we have
-- actually written to come first when a name matches several.

SELECT
  b.id, b.name, b.category_primary, b.niche, b.city, b.country_code, b.address,
  b.phone_e164, b.email, b.social_profiles
FROM businesses b
WHERE b.id = CASE WHEN $1::text ~ '^[0-9]+$' THEN $1::text::bigint END
   OR ($1::text !~ '^[0-9]+$' AND length($1::text) >= 3 AND b.name ILIKE '%' || $1::text || '%')
ORDER BY EXISTS (SELECT 1 FROM outreach o WHERE o.business_id = b.id AND o.sent_at IS NOT NULL) DESC,
         b.id
LIMIT 1;
