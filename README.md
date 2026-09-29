# FutSBC — FC 27 console companion

A Chromium browser extension for the EA FC 27 Web App, for PlayStation and Xbox clubs. It adds an in-page menu for SBC building, team planning, market research, and optional auction trading.

## Install

1. Download **FutSBC-FC27.zip** from [Releases](https://github.com/kabolghar/FutSBC/releases/latest).
2. Extract the ZIP into a permanent folder. Do not delete or move that folder after installing.
3. Open `chrome://extensions/` in Chrome, or your Chromium browser's extension manager.
4. Enable **Developer mode**, click **Load unpacked**, and select the extracted folder containing `manifest.json`.
5. Open or refresh the [EA FC Web App](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/), sign in to your own account, and click the **F** launcher at the bottom right.

Alternatively, download this repository using **Code → Download ZIP**, extract it, and load its **extension** subfolder. The release ZIP contains only the installable extension.

To update, replace the files in the installed folder, click **Reload** in the extension manager, and refresh the EA Web App. Current version: **0.21.17**. Requires Chromium 116 or newer; Arc was used for live checks. This is not a Chrome Web Store installation.

## Use

- **SBC:** Open an SBC in EA and click **Find + build squad**. FutSBC compares readable FUTBIN completed squads, matches exact EA cards, uses matching club cards, and adds concepts for missing players. Swap checks test cheaper candidates against EA's SBC requirements.
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
