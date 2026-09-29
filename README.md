# FutSBC — FC 27 console companion

A Chromium browser extension for the EA FC 27 Web App, for PlayStation and Xbox clubs. It adds an in-page menu for SBC building, team planning, market research, and optional auction trading.

## Install

1. Download **FutSBC-FC27.zip** from [Releases](https://github.com/kabolghar/FutSBC/releases/latest).
2. Extract the ZIP into a permanent folder. Do not delete or move that folder after installing.
3. Open `chrome://extensions/` in Chrome, or your Chromium browser's extension manager.
4. Enable **Developer mode**, click **Load unpacked**, and select the extracted folder containing `manifest.json`.
5. Open or refresh the [EA FC Web App](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/), sign in to your own account, and click the **F** launcher at the bottom right.

Alternatively, download this repository using **Code → Download ZIP**, extract it, and load its **extension** subfolder. The release ZIP contains only the installable extension.

To update, replace the files in the installed folder, click **Reload** in the extension manager, and refresh the EA Web App. Current version: **0.21.30**. Requires Chromium 116 or newer; Arc was used for live checks. This is not a Chrome Web Store installation.

## Use

- **SBC:** Open an SBC in EA and click **Build this SBC**. FutSBC compares readable FUTBIN completed squads, matches exact EA cards, uses matching club cards, and adds concepts for missing players. Swap checks test cheaper candidates against EA's SBC requirements.
- **Buy missing cards:** Click **Check prices**, review the total, and choose **Buy** to approve that ceiling. The extension stops on an uncertain purchase. Final SBC submission always stays with you.
- **Team:** Select positions, choose a total budget, and build a proposed XI. A complete recommendation requires at least 30 chemistry, two chemistry per new player, and no chemistry loss for retained players. The search is bounded to checked candidates; source rank is not proof of the best possible team. This feature does not buy cards. **Add concept players to squad** inserts the reviewed suggestions as concepts and saves the squad after a fresh chemistry check; unchanged positions stay in place.
- **Team swaps:** Use **Swap** beside a selected position in a completed plan. Alternatives show the full team cost and chemistry, hold your other suggestions fixed, and are rechecked when selected. Swaps update the recommendation only. Refresh after ten minutes or if your actual squad changes.
- **Team coverage:** Sparse FUTBIN results use additional FUT.GG candidates automatically. The planner prioritizes covering all selected positions, reserves budget for remaining slots, and preserves affordable chemistry-link combinations. Provider outages and incompatible retained players can still prevent a complete result; the search is not an exhaustive proof that no team exists.
- **Team progress:** The panel shows its current stage and card count. **Stop team check** stops after the current request. Recent quotes can be reused for five minutes for the same squad and budget in the same running worker. A first full check can take several minutes.
- **Market:** Review sampled prices and conditional trade ideas. Optional Gemini notes interpret the collected evidence; they do not guarantee future prices or profits.
- **Trader:** Optional automated bidding/listing. It is off until started. Read the displayed checks and limits before using it. Live auction transactions have not been verified in the release audit.

## Accounts, API keys, and privacy

No API keys, EA credentials, cookies, account exports, or browser profiles are included in this repository or release. Each person signs into their own EA account.

The core extension does not need an AI API key. For optional Gemini notes, enter your own Google AI Studio key in the **Market** tab. That key is stored in your extension's local browser storage and sent to Google's Gemini API when notes are requested; it is not stored in the project files. Do not commit keys, storage exports, or browser profiles. Provider availability and free-tier limits can change.

Parse's third-party FUTBIN API was evaluated but is **not integrated**. No Parse key is required.

The manifest grants host access to the EA Web App, FUTBIN, FUT.GG, and Google's Gemini API. SBC state uses session storage; market/trader settings and optional Gemini configuration use local extension storage. Optional AI requests contain sampled market evidence, not EA login credentials.

## Limits

FUTBIN verification, unavailable rankings, EA errors, and provider quotas can prevent completion. The extension does not bypass browser verification. Prices are sampled listings or source estimates, not reserved purchases or guarantees of the cheapest possible squad. Recommendations and profits are not guaranteed.

EA prohibits Transfer Market bots and auto-buyers. Cooldowns do not guarantee protection from account action. See [EA's FC rules](https://help.ea.com/en/articles/ea-sports-fc/fc-rules/). This project is independent of EA, FUTBIN, FUT.GG, and Google.

## Development

```sh
npm ci
npm test
npm run preview
```

The preview is visual only at `http://127.0.0.1:4173`; load `extension/` to test the integration. Automated tests include mocked EA responses and do not prove that every live operation works.

Validation: automated coverage includes estimate-only team planning, targeted fallback price checks, partial upgrades, budget limits, retained-player chemistry, and cancellation. Earlier live checks verified SBC concept building and price quotes; the v0.21.8 team changes have not yet been verified on your brother’s account.

Bundled font licenses are in `extension/fonts/`. Local research, screenshots, development dependencies, and private settings are excluded from the public repository.

### Web App not detected

Update to v0.21.7 or later, allow FutSBC access to EA in the browser’s extension settings, then refresh the EA tab. Regional EA URLs and addresses without a trailing slash are supported. If it still fails, include the full EA tab URL when reporting the issue.

### Faster team recommendations (v0.21.8)

Team recommendations use FUTBIN estimates when available. For FUT.GG rankings without prices, only provisional lineup cards receive live checks (up to 24 targeted cards); unpriced plans are never displayed as affordable. Selected players can stay when a partial upgrade preserves chemistry within budget. New cards still need at least two chemistry, retained players cannot lose chemistry, and complete teams retain the 30-point minimum or their higher starting chemistry. Recommendations do not buy or change your squad.

### Team result clarity (v0.21.9)

If the full chemistry target is unreachable in the checked shortlist, an optional partial step may be shown separately. It must improve total chemistry, preserve retained players’ chemistry, satisfy the same price checks and budget, and give new cards at least two chemistry. It is explicitly not a completed meta XI. Position summaries now use the actual completed price results instead of stale pre-pricing data.

### Price search correction (v0.21.10)

The planner checks known prices before exploring optimistic unknown-price candidates. Reaching a price-check batch limit means incomplete coverage, not insufficient budget. Continue team search reuses recent quotes for the same squad and budget. Unknown prices are never included in a displayed affordable lineup.

### Shared team budget (v0.21.11)

Among teams passing chemistry checks, the planner prioritizes covering more selected positions before extra chemistry and source rank. Affordable intermediate combinations are kept so an expensive early pick cannot crowd out later positions. Known-price partial plans no longer end the search prematurely. Partial results explicitly list unchanged selected positions.

### Additional console price source (v0.21.12)

Team planning now falls back from FUTBIN estimates to fodder.gg’s public console-price endpoint, fetched in batches of ten exact EA card IDs, before live EA searches. The site must still identify itself as FC 27. Updates older than six hours, missing prices, extinct cards and invalid values are excluded. A ten-minute cache avoids repeat requests; recent source estimates can survive an outage until their six-hour age limit. Each alternative estimate displays its source and age. These estimates do not authorize or guarantee a purchase price.

Live research validated 30 of 30 sampled FUT.GG-ranked striker IDs against the fodder.gg response using the extension parser. This is a public website endpoint, not a contracted API; availability can change. FUT.GG’s CDN and FUTWIZ returned verification pages during this check and were not bypassed.

### Meta ranking and swap discovery (v0.21.16)

Team planning reads FUT.GG position rankings alongside FUTBIN candidates, retaining FUTBIN prices for exact matching normal cards. After coverage and chemistry checks, verified position rankings take priority; fallback FUTBIN scores are kept separate. Overall rating no longer adds a performance bonus. Gender is not a scoring input. These are third-party meta signals, not a guarantee of gameplay performance.

Swap fetches candidates for the selected position, checks exact EA cards, obtains batched console estimates and uses limited live price checks for missing data. Other recommendations stay fixed. Alternatives must meet the squad chemistry floor and preserve retained players’ chemistry, but need not equal the draft’s maximum chemistry. Every option shows its resulting total chemistry and cost. Price/source errors are distinguished from an actual lack of eligible alternatives.

### EA authentication errors (v0.21.17)

An EA 401 stops card checking immediately and identifies whether concept lookup or club ownership failed. Reload the EA Web App, sign in if prompted, reopen your active squad, and retry. This is an authentication rejection, not evidence of missing GK cards. FutSBC does not retry unauthorized requests or change the squad after this error. A visible squad can be cached and does not establish that a new EA request is authenticated. If the error persists after signing in again, the reported lookup stage helps diagnose it; the extension cannot renew EA credentials itself.

### Broader swap search (v0.21.18)

Swap searches FUTBIN candidates even when FUT.GG already returns a full ranking. The FUTBIN shortlist uses the budget remaining after other planned purchases and reserves affordable cards. Both sources are merged without dropping the broader list; exact EA checks run in batches. Meta eligibility and chemistry protections remain in place. Failed planning now reports the rejection categories (price, duplicate player, exact card/position, or chemistry) rather than attributing every failure to chemistry. Search coverage is finite and unavailable sources are reported.

### Deeper ranked swaps without FUTBIN (v0.21.19)

Swap expands the official FUT.GG ranking through its Load more control, up to 120 verified ranked cards. Initial team searches remain bounded to 30. The expanded cache cannot be satisfied by an earlier 30-card page. Deeper cards retain their actual rank, exact FC 27 identity, price checks, and EA chemistry validation; no ranks or prices are invented. Pagination clicks are bounded and a stalled rendered batch is not clicked repeatedly.

### Owned cards when adding Team suggestions (v0.21.20)

Add concept players rechecks the club before applying the lineup. Exact owned cards are inserted as real items, including cards acquired since planning; only missing cards use concepts. Ownership changes update the displayed plan cost. If a previously owned card disappears or the club lookup fails, applying stops before editing the squad. Chemistry is checked using the actual items being added.

### Choose swap chemistry tradeoffs (v0.21.21)

Manual swap alternatives may reduce squad chemistry or individual player chemistry, including below two points. Each option shows its price difference and total squad chemistry difference relative to the current planned team, plus the candidate’s individual chemistry. Exact identity, position eligibility, unique players, and total budget still apply. Selecting a swap records the chemistry tradeoff for the add-to-squad step, which checks the accepted total again. Initial automatic team planning retains its existing chemistry protections.

### Background swap suggestions (v0.21.22)

After a Team recommendation completes, the panel prefetches alternatives for recommended selected positions sequentially. Opening Swap reuses ready results or shows the existing fetching message for the same in-flight request; queued positions opened by the user take priority. A selected swap starts a new cache because price and chemistry comparisons have changed. Changing the team discards stale responses. Mutations cancel queued work and wait for the current read; authentication/rate-limit failures stop the queue. Cached results expire with the plan and the add/swap operations still revalidate in EA. Prefetch continues while the existing panel is collapsed, but is not a persistent job across browser/extension reloads.

### Add players takes priority over background reads (v0.21.23)

Add concept players now actively cancels the in-progress swap search as well as clearing queued searches. The worker stops between requests, and the EA read stops after its current response instead of checking the remaining batches. The existing plan is retained and applied once the read releases its lock. An already-sent EA request may still need to finish or time out; cancellation does not start a concurrent squad mutation.


### Evidence-based trading research (v0.21.24)

The Market brief reads dated FUTBIN and FUT.GG news, console prices, recent daily price snapshots, and FUTBIN community votes/usage. News and player signals are cached for 30 minutes. Old-edition, undated, future-dated and older-than-seven-day news cannot authorize a new recommendation. Blocked sources are reported, not bypassed.

A low price alone is watch-only. New automatic hunts require three recent daily samples, positive community usage, current editorial coverage, and stable player/sample-market trends. Price-only fallback picks have been removed, including previously saved shortlists. The research entry ceiling carries through initial bids and rebids; existing auction reconciliation still runs when research is unavailable. Readable headlines are context, not verified SBC requirements. A player-named SBC may replace that card, and rumours never authorize a new trade.

Risk labels are conservative heuristics, not calibrated loss probabilities. Eligible short flips are medium risk; missing/volatile evidence is high risk. No low-risk label is inferred from asking prices or game usage, since neither proves sale liquidity. A first installation may stay watch-only while daily history accumulates. No promise of profit, reliable prediction, or automatic event-demand matching is made.

Research references: [FIFAUTeam weekly rewards](https://db.fifauteam.com/fc-27-trading-methods/weekly-rewards/), [Marquee Matchups investing](https://db.fifauteam.com/fc-27-trading-methods/marquee-matchups-investing/), [market crashes](https://db.fifauteam.com/fc-27-trading-methods/market-crashes/), [FUTBIN market methodology](https://www.futbin.com/market/), and [FUT.GG news](https://www.fut.gg/news/). These inform the rules; they are not hard-coded current buy tips. The public FUT.GG page was tested on September 29: 12 dated articles parsed, none fresh enough for the seven-day gate. It correctly supplied no current buy catalyst.


### Build around your chosen concepts (v0.21.25)

Use EA's player picker to place the exact card you want in its intended position (for example Messi at CAM). In FutSBC Team, leave that position unchecked and select the other positions to replace or fill. Unselected concepts are mandatory build-around cards: exact version and eligible position are checked, their purchase cost is included in the total, and an available exact club card is used at zero purchase cost. The complete XI is evaluated together for chemistry. A concept is never assumed to be owned merely because it is already in the XI. To change your chosen player, select that position for replacement and build again.

The Team view checks for squad changes every five seconds while idle and on entry/focus; building also refreshes the squad first. Newly added concepts are removed from old replacement selections. Sync waits for active operations; entering Team can cancel background swap prefetch. Changes clear stale plans. The plan labels these choices BUILD AROUND and prevents swap prefetch from replacing them. No cards are purchased by this feature.


### Choose players inside FutSBC (v0.21.26)

In Team, click **Choose** next to a position, search a name, and select the exact card artwork/rating. The picker uses the signed-in EA client’s player-name database and concept search (public client build 11389 inspected), filters by eligible positions, and does not edit the squad. The chosen card appears as CHOSEN; choose the remaining positions to replace and build. Use Change or × to change/remove a choice. Checking its replacement checkbox also removes that fixed choice.

Menu choices override the card currently in that slot and use the same exact-card, ownership, whole-team budget and chemistry checks as EA-added build-around concepts. The background worker accepts only card/slot pairs returned by the picker for the unchanged squad; UI-supplied prices are ignored. Squad changes clear pending choices. These menu choices are drafts in the current panel and are not purchases or immediate EA changes. Existing Add concept players applies the reviewed plan. Search is bounded to 20 player identities/300 returned versions and indicates when the name should be narrowed.

### Future team budget (v0.21.27)

In Team → Total budget, choose **Future team budget** and enter the coins you want to plan for, even above your current balance. Recommendations, swaps and adding the plan as concepts use that budget. The results show the additional coins needed for the actual proposed lineup. Owned cards still count as zero purchase cost. Trading and buying continue to use your real coin balance.

### Build-around chemistry trade-offs (v0.21.28)

When you keep an EA concept or choose a player in FutSBC, Team still prefers complete lineups meeting the chemistry target. If none checked meets every chemistry constraint, it can show a complete, priced alternative around those fixed cards. The result explicitly labels the chemistry trade-off and shows the previous and proposed totals, plus chosen cards below two chemistry. The budget, exact card versions, legal positions and duplicate-player rules remain enforced. The result is the best among the checked candidates, not an exhaustive search or a guarantee of 33 chemistry. Adding concepts rechecks the displayed chemistry before applying.

### Link-aware build-around search (v0.21.29)

Fixed EA concepts and menu picks now carry their EA league, nation and club IDs into Team planning. Separate FUTBIN searches collect linked players within the planning budget (up to two pages per link filter, nine distinct filters). Strong linked candidates get reserved shortlist space alongside general candidates; linked recruitment requires at least 80 overall and either FUTBIN rating 80+ or a checked FUT.GG ranking. A shared nation alone is never quality evidence. General candidates keep the existing meta eligibility rules.

Build-around runs expand the existing FUT.GG position fallback to 120 entries, evaluate exact EA identities in batches, and preserve verified links when reducing to 48 choices per position. FUT.GG cheap-list provenance no longer automatically outranks FUTBIN quality evidence. The combined quality score is a heuristic, not a measured gameplay score.

The bounded team search preserves branches containing links to chosen cards. Among complete candidates it first favors getting chosen players to at least two chemistry, then total chemistry, then player quality. Strict chemistry targets still take precedence over the explicitly labelled trade-off fallback. Prices, legal positions and unique players remain enforced. Source failures are labelled; unavailable pages are not bypassed. This is not an exhaustive player search or a guarantee that a chosen card reaches three chemistry.

### Clubhouse interface (v0.21.30)

A deep-green and warm-orange interface with a club crest, icon navigation and readable player rows. My XI folds setup away after a successful build; chemistry and price stay visible, while detailed evidence opens on demand. Layouts adapt to narrow screens, and the add-to-squad action stays in the page flow so it cannot cover player cards.
