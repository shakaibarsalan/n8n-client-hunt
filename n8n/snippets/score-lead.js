// CH-03, node: "Score the lead"
// Mode: Run Once for All Items
//
// Wired up for the first time here, as its own scheduled workflow reading
// businesses back OUT of Postgres - not, as originally sketched, inline
// inside CH-02's own pipeline. That move cost two fields their natural
// shape: `probe_result` and `psi` existed only as in-memory values on a CH-02
// item mid-run, and neither is a column on `businesses`. Rather than add
// columns purely to carry transient pipeline state, the SELECT that feeds
// this node derives the same two facts from `website_checks` - the append-
// only evidence trail that already exists for exactly this purpose - and
// passes them in under new, flatter names: `probe_was_unreachable` (boolean)
// and `psi_performance` (number or null). See select-pending-scoring.sql.
//
// A transparent, deterministic score. Every point is traceable to a field,
// and components[] is stored alongside the total so that a lead's score can
// be explained later without re-deriving it.
//
//   Lead Score (0-100)
//     = Website Opportunity  (0-40)   is there a gap, and how sure are we
//     + Business Viability   (0-25)   are they actually trading
//     + Contactability       (0-20)   can we reach them at all
//     + Spend Potential      (0-15)   are they likely to pay
//
// THESE WEIGHTS ARE A HYPOTHESIS, NOT A FINDING.
//
// They encode three beliefs: that a verified gap matters most, that review
// count is the only public proxy for "this business has customers and money",
// and that an unreachable lead is worthless however good it looks. None of
// that is measured yet. After ~50 outreach attempts, refit against actual
// reply rate and bump SCORING_VERSION - lead_scores is unique on
// (business_id, scoring_version) precisely so both can coexist and be
// compared.
//
// The reason for versioning rather than overwriting: the score that decided
// an outreach decision must still be readable after the model changes, or the
// calibration has nothing to calibrate against.

const SCORING_VERSION = 'v1-2026-09';

const CFG = $('Config').first().json;
const weights = $('Load scoring weights').all().map((i) => i.json);

const weightFor = (kind, key) => {
  const k = String(key || '').toLowerCase();
  const w = weights.find((x) => x.kind === kind && String(x.key).toLowerCase() === k);
  return w ? Number(w.weight) : 1.0;
};

// --- Website Opportunity (0-40) --------------------------------------------
// Scaled by confidence, so a 0.62-confidence NO_WEBSITE_LIKELY cannot score
// the same as a 0.95-confidence confirmed one. This is what stops a thin-data
// region quietly producing high-scoring leads.
const opportunity = (b) => {
  const c = Number(b.website_confidence || 0);
  switch (b.website_status) {
    case 'NO_WEBSITE_CONFIRMED': return { pts: Math.round(40 * c), why: `confirmed gap (confidence ${c})` };
    case 'NO_WEBSITE_LIKELY':    return { pts: Math.round(30 * c), why: `likely gap (confidence ${c})` };
    case 'WEAK_WEBSITE': {
      // A weak site is often the better sale: they already believe a website
      // matters, so the argument is about quality, not about whether to have
      // one at all. Scored just under a confirmed gap, never above it.
      //
      // psi_performance is null whenever PageSpeed never actually measured
      // the site (CH-02's Stage E is best-effort against a shared free
      // quota) - defaulting to 100 in that case is deliberate: an unmeasured
      // site should not look artificially bad next to one that was measured
      // and genuinely is slow.
      const perf = b.psi_performance == null ? 100 : Number(b.psi_performance);
      const pts = perf < 25 ? 30 : perf < 50 ? 24 : 18;
      return { pts, why: `weak site (mobile performance ${Math.round(perf)})` };
    }
    case 'WEBSITE_UNCERTAIN':    return { pts: 8, why: 'uncertain - needs a human look' };
    default:                     return { pts: 0, why: 'has a working website' };
  }
};

// --- Business Viability (0-25) ---------------------------------------------
const viability = (b) => {
  const reviews = Number(b.review_count || 0);
  const rating = Number(b.rating || 0);
  let pts = 0;
  const bits = [];

  // A baseline for being demonstrably a real, operating business.
  //
  // The first version scored 0 here whenever a business had no reviews, which
  // treated "no reviews" as "might not be trading". It is not: a listing with
  // a phone number, a street address and a category is a business that exists
  // and is open. Reviews say how BUSY it is, not whether it is real.
  //
  // Measured on the first 30: half had no reviews at all, and hand-checking
  // found them to be perfectly ordinary one-person salons. Scoring them as
  // though their existence were in doubt pushed verified no-website leads -
  // exactly what this project is for - below the qualification line.
  if (!b.permanently_closed && b.phone_e164 && b.address) {
    pts += 6;
    bits.push('operating (phone + address)');
  }

  // Log-scaled: a salon with 400 reviews is not eight times the prospect of
  // one with 50. It is a bigger business, which also makes it likelier to
  // already have an agency. The curve saturates around 100 reviews.
  if (reviews > 0) {
    pts += Math.min(12, Math.round((Math.log10(reviews + 1) / 2) * 12));
    bits.push(`${reviews} reviews`);
  } else {
    bits.push('no reviews yet');
  }

  if (rating >= 4.0) { pts += 4; bits.push(`rated ${rating}`); }
  if (rating >= 4.5) { pts += 3; bits.push('highly rated'); }
  // A business with reviews but no rating is odd enough to mention.
  if (rating === 0 && reviews > 0) bits.push('no rating despite reviews');

  return { pts: Math.min(25, pts), why: bits.join(', ') };
};

// --- Contactability (0-20) --------------------------------------------------
// A lead we cannot reach is not a lead, whatever else is true about it.
const contactability = (b) => {
  let pts = 0;
  const bits = [];
  if (b.phone_e164) { pts += 8; bits.push('phone'); }
  if (b.email) { pts += 6; bits.push('email'); }
  if (b.address && b.city) { pts += 3; bits.push('address'); }
  if (b.social_profiles && Object.keys(b.social_profiles).length) { pts += 3; bits.push('social'); }
  return { pts: Math.min(20, pts), why: bits.length ? bits.join(' + ') : 'no contact route at all' };
};

// --- Spend Potential (0-15) -------------------------------------------------
const spend = (b) => {
  const nw = weightFor('niche', b.niche);
  const cw = weightFor('country', b.country);
  const pts = Math.round(15 * nw * cw);
  return { pts: Math.min(15, pts), why: `${b.niche} x ${b.country} (${nw} x ${cw})` };
};

// ---------------------------------------------------------------------------

// "Pick what needs scoring" has alwaysOutputData set - deliberately, so this
// node still runs and can emit the empty-batch sentinel below when there is
// nothing to score, rather than being skipped outright with no output at
// all. But that means a zero-row query result arrives here as ONE blank
// item ({}), not zero items - $input.all() is never actually empty. The
// loop below ran once over that blank object anyway, scored it from all-
// undefined fields, and pushed a real-looking row with business_id:
// undefined into `out` - so the `if (!out.length)` sentinel check below
// never fired, and "Store the score" crashed on a NOT NULL violation
// instead. Found running for real: it failed identically on every 30-
// minute schedule tick once the visible backlog had actually been cleared,
// which no test in this project ever exercised - every test and every
// manual run this session fed real business rows in, never n8n's own
// "nothing to do" shape.
const rows = $input.all().filter((item) => item.json && item.json.id != null);

const out = [];

for (const item of rows) {
  const b = item.json;

  const o = opportunity(b);
  const v = viability(b);
  const c = contactability(b);
  const s = spend(b);
  const total = Math.max(0, Math.min(100, o.pts + v.pts + c.pts + s.pts));

  const minScore = Number(b.min_lead_score || CFG.default_min_lead_score || 60);

  // --- Two holds that config cannot switch off ----------------------------
  //
  // Mirrors needs_human_review() in the job-hunt scoring module: the cases
  // where automation should not be trusted are exactly the cases where a
  // setting must not be able to wave it through.
  //
  // Both of these exist to prevent one specific email - "I noticed you don't
  // have a website" - reaching a business that has one.
  let needsReview = false;
  let reviewReason = null;

  if (Number(b.website_confidence || 0) < 0.6 &&
      String(b.website_status || '').startsWith('NO_WEBSITE')) {
    needsReview = true;
    reviewReason = `confidence ${b.website_confidence} is below 0.6 - the gap is not established`;
  }
  if (b.probe_was_unreachable) {
    needsReview = true;
    reviewReason = 'a website probe could not complete, so absence was never demonstrated';
  }
  if (b.website_status === 'WEBSITE_UNCERTAIN') {
    needsReview = true;
    reviewReason = reviewReason || 'conflicting signals about whether a website exists';
  }
  // Viability + contactability + spend alone can reach 60 (25+20+15) with
  // zero contribution from the opportunity component - a well-reviewed,
  // easily-reached, high-spend business that simply has a working website.
  // That is exactly the email this project must never send, so a lead with
  // no opportunity points at all is never "qualified" regardless of total.
  if (o.pts === 0) {
    needsReview = true;
    reviewReason = reviewReason || `website_status is ${b.website_status} - no gap to pitch, whatever the rest of the score says`;
  }

  out.push({
    json: {
      business_id: b.id,
      scoring_version: SCORING_VERSION,
      total,
      qualified: total >= minScore && !needsReview,
      needs_review: needsReview,
      review_reason: reviewReason,
      components: {
        website_opportunity: { points: o.pts, max: 40, why: o.why },
        business_viability:  { points: v.pts, max: 25, why: v.why },
        contactability:      { points: c.pts, max: 20, why: c.why },
        spend_potential:     { points: s.pts, max: 15, why: s.why },
        threshold: minScore,
      },
    },
  });
}

if (!out.length) {
  // Idling correctly is not a failure, and a report that calls it one gets
  // ignored as fast as one that hides a real fault.
  return [{ json: { _nothing_to_score: true, scoring_version: SCORING_VERSION } }];
}

return out;
