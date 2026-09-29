# Business logic review — v0.21.35

Scope: SBC discovery/comparison, exact card matching, XI candidate selection and pricing, chemistry planning, club ownership, squad application, checkout, trading evidence, and operation coordination. This is a code and automated-regression review, not proof that every live EA/FUTBIN response works on every account.

## Corrected defects

| Finding | Correction | Regression coverage |
| --- | --- | --- |
| EA-to-FUTBIN lookup redirects were rejected as the wrong page; a completed page without a self-link also failed discovery | Allow only FC 27 discovery redirects on FUTBIN, then match the exact EA challenge ID | `tab-reader`, `lookup` |
| A comparison returned as soon as some table prices existed | Wait for missing console prices; a permanently incomplete table still fails explicitly | `tab-reader` |
| Five incomplete DOM reads could reject a slowly hydrating squad | Extend the partial-squad grace period while retaining a bounded timeout | `tab-reader` |
| Static squad HTML with missing identity, price or challenge-link fields could abort the entire comparison | Try ordinary rendered-page reading; a positively mismatched challenge remains rejected | `futbin-batch` |
| A fully priced XI subset ended planning before unknown-price alternatives competed, benefiting free club cards | Plan against the full candidate pool and price proposed alternatives before accepting the subset | `team-flow` |
| Broadening repeated the original source limits | Expand FUTBIN and FUT.GG candidate limits on the second pass, retaining bounded matching/planning | Existing complete-team flow and planner checks; source availability still limits coverage |
| Invalid or concept-only club records could be treated as free usable cards | Exclude them during ownership evaluation, consistent with the insertion check | `team-upgrades` |
| FUT.GG's cheap-player list was described as a general meta ranking | Label it as a budget ranking; disclose the source and selection factors in card details | Panel/browser checks |

## Business rules rechecked

- **SBC identity:** exact season, console market, challenge ID, distinct player identities, required slot count, positive prices and matching totals. No incomplete lineup is silently inserted. The comparison covers the returned listing pool, not every possible SBC solution.
- **XI selection:** whole-team budget and selected-position coverage precede marginal upgrades. Chemistry is calculated using EA data. Source rank and card rating guide quality; ownership changes acquisition cost, not quality score. Regression coverage checks that an affordable stronger card wins over a weaker free club card at equal chemistry.
- **Prices:** source estimates are labeled. Unknown prices are optimistic only during internal search and cannot be returned as a verified affordable lineup. Targeted checks are bounded; incomplete coverage is not evidence of an inadequate budget.
- **Squad changes:** saved plan identity and squad fingerprint must still match. Owned cards are fetched again before insertion. Manual player anchors, distinct assets, position eligibility and reviewed chemistry are revalidated.
- **Checkout:** current reviewed ceilings control purchases. Changed squads and uncertain purchase outcomes halt the workflow; it does not automatically submit an SBC.
- **Trader/market:** tax-adjusted margins, fresh evidence, exact card versions, uncertain auction outcomes, stop/reset behavior and serialized operations have regression coverage. Source headlines and discounts alone do not justify trades; low risk is conditional, not a promise.
- **Coordination:** cancellation, background recommendation reads, conflicting mutations and sender checks remain covered by the automated suite.

## Remaining limitations

The brother's Chrome failure has not been reproduced on his laptop; the supplied description did not include an SBC ID or exact error. The fixes address demonstrated code failure paths. FUTBIN browser verification and provider outages remain outside the extension's control.

The XI search is bounded, and available source lists are incomplete. Rankings are evidence, not a complete gameplay-performance model. Chemistry can legitimately favor a lower-ranked linking card. A club card may still be selected when it makes the best checked complete team affordable, but ownership earns no quality bonus.

This review did not execute live purchases, bids or SBC submission. Automated EA/provider fixtures and browser layout checks validate the handled contracts; they cannot establish live compatibility or guaranteed profit.


## Follow-up: exact #49 lookup failure (v0.21.36)

The reported lookup was inspected in Arc. FUTBIN returned a not-found page while its homepage and SBC directory loaded. The group page for Challenge 1 published the expected exact EA ID 48 in its Completed Challenges link; the active directory's two pages did not show Challenge 2 at inspection time.

Added bounded directory discovery, same-origin/season and exact-ID filtering, stale-document rejection, explicit blank/not-found detection, one blank-page retry and automatic fallback wiring. Regression coverage exercises pagination, mismatched challenges, browser verification, and full comparison recovery after a failed lookup. This does not establish that FUTBIN currently has a readable solution for EA #49.
