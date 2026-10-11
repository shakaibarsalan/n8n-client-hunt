#!/usr/bin/env python3

"""

Load Overture Maps Places and Foursquare OS Places into the reference tables.



These two datasets are the free half of the website check. Stage B asks them,

for every candidate, "do you hold a website for this business?" - and a yes

means Google Maps was wrong and we have caught a false positive for nothing.



They are loaded ONCE per city, queried thousands of times, and cost nothing

either way. That is the entire argument for them over an API: a verification

step that costs money per call is a verification step somebody eventually

turns down to save budget.



Usage:



    python tools/load_reference_data.py --city Oslo  --country Norway

    python tools/load_reference_data.py --city Dubai --country "United Arab Emirates"

    python tools/load_reference_data.py --city Oslo --country Norway --source overture



Needs:  pip install duckdb psycopg2-binary

Env:    DATABASE_URL=postgres://...



Both datasets are released monthly. Re-running replaces that city's rows.

"""



import argparse

import os

import sys



# Bounding boxes for the POC and near-term markets. A bbox rather than a

# radius because the parquet is partitioned spatially, and a bbox is what lets

# DuckDB read a few megabytes instead of the whole 64-million-row planet.

#

# Generous on purpose: a business on the edge of the metro area is still a

# prospect, and over-reading costs seconds while under-reading silently

# removes businesses from the cross-check - which does not look like an error,

# it looks like Stage B finding nothing.

CITIES = {

    "oslo":       dict(country="Norway",               bbox=(10.49, 59.79, 10.95, 60.02)),

    "stockholm":  dict(country="Sweden",               bbox=(17.75, 59.20, 18.25, 59.45)),

    "copenhagen": dict(country="Denmark",              bbox=(12.40, 55.58, 12.70, 55.75)),

    "dubai":      dict(country="United Arab Emirates", bbox=(54.90, 24.80, 55.60, 25.40)),

    "abu dhabi":  dict(country="United Arab Emirates", bbox=(54.20, 24.25, 54.80, 24.60)),

    "barcelona":  dict(country="Spain",                bbox=(2.05, 41.32, 2.28, 41.48)),

    "madrid":     dict(country="Spain",                bbox=(-3.85, 40.32, -3.55, 40.55)),

    "lisbon":     dict(country="Portugal",             bbox=(-9.25, 38.68, -9.08, 38.80)),

    "milan":      dict(country="Italy",                bbox=(9.04, 45.38, 9.28, 45.54)),

    "toronto":    dict(country="Canada",               bbox=(-79.64, 43.58, -79.12, 43.86)),

    "vancouver":  dict(country="Canada",               bbox=(-123.27, 49.19, -123.02, 49.32)),

}



OVERTURE_RELEASE = os.environ.get("OVERTURE_RELEASE", "2026-08-19.0")

OVERTURE_PATH = (

    f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=places/type=place/*"

)

FSQ_PATH = os.environ.get(

    "FSQ_PATH",

    "s3://us-west-2.opendata.source.coop/fused/fsq-os-places/2025-01-10/places/*.parquet",

)





# --- normalisation --------------------------------------------------------

#

# MUST match n8n/snippets/normalise-business.js exactly. If these two drift,

# Stage B stops matching and the failure is silent: every business looks like

# "not present in the open datasets", confidence drops, and the pipeline

# quietly downgrades every lead from CONFIRMED to LIKELY without erroring.

#

# tests/dedup.test.js pins the JavaScript side. The SQL below is the mirror.

# Normalisation is done HERE, in Python, not in DuckDB SQL.

#

# The first version wrote it twice - once in JavaScript for the n8n node and

# once as a nest of regexp_replace() for DuckDB. Two copies of this logic is

# the worst possible seam in the project, because when they drift nothing

# errors: every business simply looks like "not present in the open datasets",

# Stage B stops catching anything, and confidence quietly caps below CONFIRMED

# across the board. One implementation, tested against the JavaScript one by

# tests/normalisation-parity.test.js, is worth the extra pass over the rows.



LEGAL = {

    "as", "asa", "ans", "da", "nuf", "ab", "hb", "kb", "aps", "is", "ks",

    "sl", "slu", "sa", "sau", "lda", "unipessoal", "srl", "srls", "spa",

    "snc", "sas",

    "llc", "lc", "fze", "fzco", "fzllc", "dmcc", "est", "establishment",

    "inc", "ltd", "limited", "corp", "corporation", "co", "company", "ulc", "plc",

    "the", "and", "group", "holdings", "international",

}



# Letters that do not decompose under NFD and so must be mapped by hand.

FOLD = {

    "ø": "o", "Ø": "o",      # o-slash

    "æ": "ae", "Æ": "ae",    # ae ligature

    "å": "a", "Å": "a",      # a-ring

    "ß": "ss",                     # sharp s

    "đ": "d", "ł": "l",      # d-stroke, l-stroke

    "œ": "oe", "Œ": "oe",    # oe ligature - matters for Quebec

    "þ": "th", "ð": "d",     # thorn, eth

}





def name_norm(raw):

    """Mirror of normaliseName() in n8n/snippets/normalise-business.js."""

    import unicodedata



    if not raw:

        return ""

    t = str(raw)

    for a, b in FOLD.items():

        t = t.replace(a, b)

    t = unicodedata.normalize("NFD", t)

    t = "".join(c for c in t if not unicodedata.combining(c))

    t = t.lower()

    # Dots and slashes are CLOSED UP so that "S.L." stays one token.

    t = t.replace(".", "").replace("/", "")

    t = t.replace("&", " and ")

    t = "".join(c if (c.isascii() and (c.isalnum())) else " " for c in t)

    words = [w for w in t.split()

             if w not in LEGAL and (len(w) > 1 or any(ch.isdigit() for ch in w))]

    return " ".join(words).strip()





# Geohash precision 7, mirroring the JS. DuckDB has no geohash builtin, so it

# is computed in Python after the extract rather than in SQL.

B32 = "0123456789bcdefghjkmnpqrstuvwxyz"





def geohash(lat, lon, precision=7):

    if lat is None or lon is None:

        return ""

    if lat == 0 and lon == 0:

        return ""

    lat_min, lat_max, lon_min, lon_max = -90.0, 90.0, -180.0, 180.0

    out, bits, ch, even = [], 0, 0, True

    while len(out) < precision:

        if even:

            mid = (lon_min + lon_max) / 2

            if lon > mid:

                ch = (ch << 1) + 1

                lon_min = mid

            else:

                ch <<= 1

                lon_max = mid

        else:

            mid = (lat_min + lat_max) / 2

            if lat > mid:

                ch = (ch << 1) + 1

                lat_min = mid

            else:

                ch <<= 1

                lat_max = mid

        even = not even

        bits += 1

        if bits == 5:

            out.append(B32[ch])

            bits, ch = 0, 0

    return "".join(out)





def clean(v):

    """Strip NUL bytes out of anything heading for Postgres.



    Postgres text cannot contain 0x00 and psycopg2 refuses to send it. Overture

    is an aggregation of several upstream providers and a handful of records

    carry stray NULs inside names and addresses - about one in a hundred

    thousand, which means a city loads fine until the day it does not.



    Dubai hit this at 98,815 rows, after the whole extract had already been

    downloaded and held in memory. Sanitising at the boundary is cheaper than

    discovering it per city.

    """

    if v is None:

        return None

    if isinstance(v, str):

        return v.replace(chr(0), "")   # chr(0), not an escape: a literal NUL in
                                       # this source file is itself unloadable
    if isinstance(v, (list, tuple)):

        return [clean(x) for x in v]

    return v





def e164(raw, country):

    dial = {

        "norway": "47", "sweden": "46", "denmark": "45", "finland": "358",

        "united arab emirates": "971", "qatar": "974", "saudi arabia": "966",

        "spain": "34", "portugal": "351", "italy": "39", "greece": "30",

        "canada": "1", "united states": "1",

    }

    if not raw:

        return None

    s = str(raw).strip()

    has_plus = s.startswith("+")

    s = "".join(c for c in s if c.isdigit())

    if not s:

        return None

    if has_plus:

        return "+" + s

    if s.startswith("00"):

        return "+" + s[2:]

    cc = dial.get(str(country or "").lower())

    if not cc:

        return None

    if s.startswith(cc) and len(s) > len(cc) + 5:

        return "+" + s

    if s.startswith("0") and cc != "39":

        s = s[1:]

    return "+" + cc + s





def main():

    ap = argparse.ArgumentParser(description=__doc__,

                                 formatter_class=argparse.RawDescriptionHelpFormatter)

    ap.add_argument("--city", required=True)

    ap.add_argument("--country")

    ap.add_argument("--source", choices=["overture", "fsq", "both"], default="both")

    ap.add_argument("--dry-run", action="store_true",

                    help="extract and report counts without writing to Postgres")

    args = ap.parse_args()



    key = args.city.strip().lower()

    if key not in CITIES:

        print(f"No bounding box for {args.city!r}.", file=sys.stderr)

        print(f"Known: {', '.join(sorted(CITIES))}", file=sys.stderr)

        print("Add one to CITIES in this file - a bbox is four numbers from "

              "bboxfinder.com and takes a minute.", file=sys.stderr)

        return 2



    city = CITIES[key]

    country = args.country or city["country"]

    west, south, east, north = city["bbox"]



    try:

        import duckdb

    except ImportError:

        print("pip install duckdb psycopg2-binary", file=sys.stderr)

        return 2



    con = duckdb.connect()

    con.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;")

    con.execute("SET s3_region='us-west-2'; SET enable_progress_bar=true;")



    rows = {"overture": [], "fsq": []}



    if args.source in ("overture", "both"):

        print(f"Reading Overture {OVERTURE_RELEASE} for {args.city}...")

        q = f"""

        SELECT

          id AS gers_id,

          names.primary AS name,

          list_transform(phones, x -> x) AS phones,

          websites,

          socials,

          emails,
          categories.primary AS cat_primary,
          categories.alternate AS cat_alts,
          addresses[1].freeform AS street,
          addresses[1].postcode AS postcode,

          -- The spatial extension reads the parquet's geometry column as a

          -- GEOMETRY already; wrapping it in ST_GeomFromWKB (which wants a

          -- BLOB) fails the bind rather than the query, so it looks like a

          -- missing function rather than a double conversion.

          ST_Y(geometry) AS lat,

          ST_X(geometry) AS lon,

          confidence,

          operating_status,

          addresses[1].country AS country,

          addresses[1].locality AS city

        FROM read_parquet('{OVERTURE_PATH}', hive_partitioning=1)

        WHERE bbox.xmin BETWEEN {west} AND {east}

          AND bbox.ymin BETWEEN {south} AND {north}

          AND names.primary IS NOT NULL

        """

        for r in con.execute(q).fetchall():

            (gid, name, phones, websites, socials, emails, cat_p, cat_a, street, postcode,

             lat, lon, conf, status, ctry, ct) = r

            rows["overture"].append(clean((

                gid, name, name_norm(name),

                e164(phones[0] if phones else None, country),

                list(websites or []), list(socials or []), list(emails or []),

                lat, lon, geohash(lat, lon), conf, status,

                ctry or country, ct or args.city,
                ([cat_p] if cat_p else []) + list(cat_a or []),
                ", ".join(x for x in (street, postcode) if x) or None,
                args.city,

            )))

        print(f"  {len(rows['overture'])} Overture places")



    if args.source in ("fsq", "both"):

        print(f"Reading Foursquare OS Places for {args.city}...")

        q = f"""

        SELECT

          fsq_place_id, name,

          tel, website, email, facebook_id, instagram, twitter,

          latitude, longitude, country, locality, date_closed

        FROM read_parquet('{FSQ_PATH}')

        WHERE longitude BETWEEN {west} AND {east}

          AND latitude  BETWEEN {south} AND {north}

          AND name IS NOT NULL

        """

        for r in con.execute(q).fetchall():

            (pid, name, tel, site, email, fb, ig, tw,

             lat, lon, ctry, loc, closed) = r

            rows["fsq"].append(clean((

                pid, name, name_norm(name), e164(tel, country), site, email,

                str(fb) if fb else None, ig, tw,

                lat, lon, geohash(lat, lon),

                ctry or country, loc or args.city,

                str(closed) if closed else None,

            )))

        print(f"  {len(rows['fsq'])} Foursquare places")



    # The number that tells you whether this load was worth anything.

    ovt_sites = sum(1 for r in rows["overture"] if r[4])

    fsq_sites = sum(1 for r in rows["fsq"] if r[4])

    total = len(rows["overture"]) + len(rows["fsq"])

    print()

    print(f"  websites held: {ovt_sites} of {len(rows['overture'])} Overture, "

          f"{fsq_sites} of {len(rows['fsq'])} Foursquare")

    if total and (ovt_sites + fsq_sites) == 0:

        print("  WARNING: not one website in either dataset for this city.")

        print("  Stage B can only ever say 'not present' here, so confidence")

        print("  will cap below CONFIRMED. That is correct behaviour, but it")

        print("  means this city needs the search stage to be worth running.")



    if args.dry_run:

        print("\n--dry-run: nothing written")

        return 0



    dsn = os.environ.get("DATABASE_URL")

    if not dsn:

        print("DATABASE_URL is not set", file=sys.stderr)

        return 2



    import psycopg2

    from psycopg2.extras import execute_batch



    pg = psycopg2.connect(dsn)

    cur = pg.cursor()



    if rows["overture"]:

        # Replace this city's rows rather than appending: the dataset is

        # re-released monthly, and appending would leave last month's closed

        # businesses in place to be matched against forever.

        # Scoped by load_city, not city. A Dubai load writes rows whose own
        # locality is Arabic, or reads "Sharjah"; keying the delete on that
        # left roughly 85% of the previous load behind.
        cur.execute("DELETE FROM ref_overture_places WHERE lower(load_city) = lower(%s)", (args.city,))

        execute_batch(cur, """

            INSERT INTO ref_overture_places

              (gers_id, name, name_norm, phone_e164, websites, socials, emails,

               lat, lon, geohash7, confidence, operating_status, country, city,
               categories, address, load_city)

            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)

            ON CONFLICT (gers_id) DO UPDATE SET

              websites = EXCLUDED.websites, socials = EXCLUDED.socials,

              name_norm = EXCLUDED.name_norm, phone_e164 = EXCLUDED.phone_e164,

              geohash7 = EXCLUDED.geohash7, load_city = EXCLUDED.load_city,
              categories = EXCLUDED.categories, address = EXCLUDED.address,
              loaded_at = now()

        """, rows["overture"], page_size=500)



    if rows["fsq"]:

        cur.execute("DELETE FROM ref_fsq_places WHERE lower(load_city) = lower(%s)", (args.city,))

        execute_batch(cur, """

            INSERT INTO ref_fsq_places

              (fsq_place_id, name, name_norm, tel_e164, website, email,

               facebook_id, instagram, twitter, lat, lon, geohash7,

               country, locality, date_closed)

            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)

            ON CONFLICT (fsq_place_id) DO UPDATE SET

              website = EXCLUDED.website, name_norm = EXCLUDED.name_norm,

              tel_e164 = EXCLUDED.tel_e164, geohash7 = EXCLUDED.geohash7,

              loaded_at = now()

        """, rows["fsq"], page_size=500)



    pg.commit()

    print(f"\nLoaded {total} reference places for {args.city}.")

    return 0





if __name__ == "__main__":

    sys.exit(main())

