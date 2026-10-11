// CH-03, node: "Drop the empty-batch sentinel"
// Mode: Run Once for All Items
//
// score-lead.js emits a single sentinel item, `{_nothing_to_score: true}`,
// when it received nothing to score - the same "idling correctly is not a
// failure" shape used throughout this project. Feeding that sentinel
// straight into the Postgres insert node would try to INSERT a row with
// business_id = undefined and fail the whole execution on what is actually
// the quiet, normal case.
//
// Filtering it out here, rather than branching on it with an IF node, keeps
// the chain linear: with zero items reaching it, "Store the score" simply
// does not run, and the summary node downstream already knows how to report
// nothing to do without needing this workflow to branch.

const items = $input.all().filter((i) => !i.json._nothing_to_score);
return items;
