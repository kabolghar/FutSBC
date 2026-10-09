# Paletools compatibility review — 9 October 2026

Reviewed the official v27.1.5 script and the installed Gallery in Arc. The public `window.paletools` object did not expose a callable price-provider API. The integrations below use narrowly checked card-view data and EA's existing client services. No vendor code, cookies or credentials are copied.

| Capability | Evidence and use in FutSBC |
| --- | --- |
| External prices on card views | Observed `__externalPrice.getValue()` beside exact `data.definitionId`, rating and rarity. v0.21.59 reuses numeric displayed estimates for missing Team and swap prices before asking another provider or EA. |
| Find lowest market price | Official implementation narrows the Buy Now ceiling below each lowest result. v0.21.59 applies this search strategy to Team quotes and SBC/Gallery purchases, using EA services directly. It does not invoke Paletools' private action handlers. |
| Saved search filters | Official searches set `disableOverrides=true`. All FutSBC market requests now use that flag so Paletools' saved rating, rarity or chemistry-style overrides do not silently change explicit searches. EA restrictions and responses remain authoritative. |
| Gallery set and collection | Already integrated in v0.21.58: reads the open set, positive collection records and requested exact-card metadata; checks set, grade and account identity. Does not submit grading. |
| Player locks | Official source renders lock state and recognizes `hideLocked` in its club-search wrapper. Promising additional protection for automatic SBC selection, but not implemented as a complete lock bridge: evolved-instance overrides and list completeness need separate validation. |
| Duplicates and unassigned cards | Potentially useful for SBC inventory. Existing collection and purchase recovery must remain separate: an unassigned item is not proof that a specific purchase succeeded. No new inventory mutation implemented in this release. |
| Transaction history | Could support realized profit and turnover analysis. The source stores purchase/sale records privately; no stable public export API was found. No direct database import implemented. |
| Card metadata and club analysis | Potentially useful for positions, roles and ownership previews. EA's exact card identity, chemistry validation and fresh club checks remain authoritative. |

## Estimate safeguards

Prices already displayed are estimates, **not live EA offers**. The official script's external provider is FUT.GG; the displayed controls do not provide a verified provider update timestamp. FutSBC therefore labels their source as **Paletools display**, stores an observation time and keeps the provider time unknown. They never enter daily market history as a fresh provider sample.

Only requested exact card versions with matching rating/rarity are accepted; owned cards remain zero additional purchase cost. Observations are kept in memory for at most ten minutes, capped at 528 cards and scoped to the EA client/persona/SKU. Hidden, nonnumeric and extinct prices are ignored. Paletools is optional, and unavailable controls fall back to the existing estimate/live-price paths. Cards never displayed or observed cannot be priced through this bridge.

## Live listing safeguards

Each lookup examines up to six serial searches within a 25-second deadline. Full result pages trigger a lower Buy Now ceiling, with valid EA price increments. A short page, no cheaper results or the 150-coin floor ends narrowing. This identifies the lowest eligible listing checked; changing markets, request limits and incomplete coverage prevent a global cheapest-price guarantee.

Buying still checks ownership first, exact version, current balance, approved card/session limits, auction expiry and buy eligibility. Estimates do not authorize a purchase. Any EA rejection stops the lookup before buying; uncertain purchases retain the existing recovery flow and are never retried automatically.

## Validation

Automated coverage checks displayed-price identity, unavailable controls, cache expiry/account changes, no market requests for displayed estimates, no invented update time, multi-step narrowing, wrong versions, expired auctions, balance changes, request rejection and existing buying/collection flows. Live Arc checks on the installed v0.21.59 extension confirmed numeric estimates on 100 loaded Paletools Gallery card views without purchasing cards. Purchase and send-to-club validation use simulated EA responses.

Sources: [official feature list](https://pale.tools/), [official installation page](https://pale.tools/fifa/paletools.html), [official current userscript](https://pale.tools/fifa/dist/latest/paletools.user.js).
