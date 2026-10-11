// CH-01, node: "BRAKE: can we afford this run?"
// Mode: Run Once for All Items
//
// Decides whether to spend money, and builds the Apify input if so.
//
// This node exists in this position - before the first live request, not
// after the first surprise bill - because of a specific lesson from the
// LinkedIn project's post-mortem:
//
//     "The budget goes in before the first live request, not after the
//      fourth bug. Brakes are not a later refinement."
//
// That project's hard cap was written on the night of the incident it would
// have prevented. Apify's free plan is $5 a month with no rollover and it
// BLOCKS runs at zero rather than warning first, so the failure mode here is
// a pipeline that silently stops producing leads on the 14th of the month
// and looks, from the outside, exactly like a pipeline that found nothing.

const rows = $input.all().map((i) => i.json);
const CFG = $('Config').first().json;

// No due target is the normal state most days: cooldown_hours is doing its
// job. That is the system idling correctly, not a fault, and it must not look
// like one in the report.
if (!rows.length) {
  return [{
    json: {
      go: false,
      reason: 'no target is due - every enabled market is still inside its cooldown window. ' +
              'This is the schedule working, not a failure.',
      quiet: true,
    },
  }];
}

const t = rows[0];

// --- the spend check -------------------------------------------------------
//
// TWO limits, and the run needs room under BOTH.
//
//   1. What Apify says is actually left this month. This is the truth, asked
//      live, and it is the one that matters. Our own place counter can only
//      ever under-estimate: Apify bills for the actor start and for each
//      filter applied per place as well as for the place itself, so a budget
//      expressed in places drifts below the real spend and would eventually
//      let a run start with nothing left to pay for it.
//
//   2. Our own monthly place cap in app_state. Kept as a deliberate ceiling
//      you can lower below the plan's - useful when the credit is shared with
//      something else, and it still works if the limits endpoint is down.
//
// Both fail CLOSED. A brake whose input is missing refuses.

// --- limit 1: live credit -------------------------------------------------
let creditRemainingUsd = null;
try {
  const lim = $('How much credit is left?').first().json.data;
  const usedUsd = Number(lim.current.monthlyUsageUsd);
  const maxUsd = Number(lim.limits.maxMonthlyUsageUsd);
  if (Number.isFinite(usedUsd) && Number.isFinite(maxUsd)) {
    creditRemainingUsd = maxUsd - usedUsd;
  }
} catch (e) {
  // Leaving it null is what makes the next block refuse. An unreachable
  // limits endpoint is not permission to spend.
}

if (creditRemainingUsd === null) {
  return [{
    json: {
      go: false,
      reason: 'could not read the Apify credit limit, so there is no way to know what a run ' +
              'would cost against what is left. Refusing rather than guessing. Check the ' +
              '"Apify token" credential and the How much credit is left? node.',
      quiet: false,
    },
  }];
}

// A reserve, because the per-place rate is not the whole bill. The actor start
// is $0.007 and each filter applied costs $0.001 per place, so a run that
// exactly exhausts the remaining dollars stops part-way through - which costs
// the same money and returns a partial, geographically biased slice of a city.
const perPlace = Number(CFG.apify_cost_per_place || 0.005);
const reserve = Number(CFG.apify_reserve_usd || 0.30);
const affordableByCredit = Math.floor(Math.max(0, creditRemainingUsd - reserve) / perPlace);

// --- limit 2: our own ceiling ---------------------------------------------
// The counter resets itself on month rollover in the same statement that
// increments it, so a stale month here means the counter has simply not been
// touched yet this month and reads as zero.
const sameMonth = t.spend_month === t.current_month;
const used = sameMonth ? Number(t.spend_places_scraped || 0) : 0;
const cap = Number(t.spend_monthly_cap || 0);

// A missing or zero cap does NOT mean "unlimited".
//
// An earlier version read `cap > 0 ? cap - used : Infinity`, so deleting the
// app_state row - or fat-fingering the JSON in it - switched the brake off
// entirely. That is precisely the shape of the mistake the sibling project
// made: "a bounce counter with nothing that sets it would have been a brake
// wired to nothing."
if (!Number.isFinite(cap) || cap <= 0) {
  return [{
    json: {
      go: false,
      reason: 'no Apify place cap is configured (app_state.apify_spend.monthly_place_cap ' +
              'is missing or zero). Refusing rather than spending without a ceiling. ' +
              'Set a number - a large one if you really want no cap of our own.',
      quiet: false,
    },
  }];
}

const affordableByCap = cap - used;
const remaining = Math.min(affordableByCredit, affordableByCap);
const binding = affordableByCredit <= affordableByCap ? 'Apify credit' : 'our own monthly cap';

if (remaining <= 0) {
  return [{
    json: {
      go: false,
      reason: `out of budget (${binding} is the limit). ` +
              `$${creditRemainingUsd.toFixed(2)} credit left, which buys about ` +
              `${affordableByCredit} places; our own cap allows ${affordableByCap} more ` +
              `(${used}/${cap} used in ${t.current_month}). No run started.`,
      // Routine once the month's budget is used - CH-07's digest is enough;
      // a Telegram message every 30 minutes was not.
      quiet: true,
    },
  }];
}

// Never ask for more than the budget can pay for. Asking for 150 with 40 left
// does not fail politely - it spends the 40 and stops mid-scrape, which costs
// the same and returns a partial, biased slice of the city.
const want = Math.min(Number(t.max_results || 100), remaining);

if (want < 10) {
  return [{
    json: {
      go: false,
      reason: `only ${remaining} places left in this month's cap - too few for a meaningful ` +
              `run, so nothing was started rather than half-scraping ${t.city || t.country}.`,
      // Routine once the month's budget is used - CH-07's digest is enough;
      // a Telegram message every 30 minutes was not.
      quiet: true,
    },
  }];
}

// --- build the Apify input -------------------------------------------------
//
// website: 'withoutWebsite' is the single most important line in this repo.
// It is the reason discovery is cheap: the actor returns only businesses whose
// Maps listing carries no website, so we pay for prospects rather than for a
// whole city we then throw 73% of away.
//
// It is emphatically NOT the answer on its own - a listing with no website
// field is a candidate, and CH-02 exists to find out whether it is true.
const input = {
  searchStringsArray: [t.niche_query],
  maxCrawledPlacesPerSearch: want,
  language: 'en',
  website: 'withoutWebsite',
  skipClosedPlaces: true,
  scrapeContacts: false,
};

// Location. A custom polygon wins over the free-text fields when one is set,
// because a city name is ambiguous in a way a polygon is not.
if (t.custom_geolocation) {
  input.customGeolocation = t.custom_geolocation;
} else {
  if (t.city) input.city = t.city;
  if (t.state) input.state = t.state;
  if (t.postal_code) input.postalCode = t.postal_code;

  // countryCode is an ENUM of lowercase ISO-2 codes, not a country name. An
  // earlier version passed "Norway" here, which is not in the enum - the run
  // would have searched with no country at all, and "beauty salon" unscoped is
  // a global search that would have spent the month's credit on results from
  // anywhere. Refusing is the only safe response to a missing code.
  if (!t.country_code) {
    return [{
      json: {
        go: false,
        reason: `target ${t.id} (${t.niche} / ${t.country}) has no country_code and no ` +
                `custom_geolocation. The scraper needs a lowercase ISO-2 code; without one ` +
                `the search would not be restricted to any country at all. No run started.`,
        quiet: false,
      },
    }];
  }
  input.countryCode = String(t.country_code).toLowerCase();
}

if (Array.isArray(t.category_filter) && t.category_filter.length) {
  input.categoryFilterWords = t.category_filter;
}

// placeMinimumStars is an enum of WORDS - 'four', 'fourAndHalf' - not a
// number. String(4.5) is not in the enum, so passing the rating straight
// through silently dropped the filter.
if (t.min_rating) {
  const STARS = {
    '2': 'two', '2.5': 'twoAndHalf',
    '3': 'three', '3.5': 'threeAndHalf',
    '4': 'four', '4.5': 'fourAndHalf',
  };
  const word = STARS[String(Number(t.min_rating))];
  // An unmappable value is left out rather than guessed at. Dropping a filter
  // costs a few extra places; sending an invalid enum fails the whole run.
  if (word) input.placeMinimumStars = word;
}

return [{
  json: {
    go: true,
    target_id: t.id,
    niche: t.niche,
    niche_query: t.niche_query,
    city: t.city,
    country: t.country,
    asked_for: want,
    budget_remaining: remaining,
    budget_binding: binding,
    credit_remaining_usd: Number(creditRemainingUsd.toFixed(2)),
    apify_input: input,
    // Carried through for the normaliser, which needs the target's fields and
    // should not have to query for them again.
    ...t,
  },
}];
