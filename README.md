# FutSBC — FC 27 console companion

A Chromium browser extension for the EA FC 27 Web App, for PlayStation and Xbox clubs. It adds an in-page menu for SBC building, team planning, market research, and optional auction trading.

## Install

1. Download **FutSBC-FC27.zip** from [Releases](https://github.com/kabolghar/FutSBC/releases/latest).
2. Extract the ZIP into a permanent folder. Do not delete or move that folder after installing.
3. Open `chrome://extensions/` in Chrome, or your Chromium browser's extension manager.
4. Enable **Developer mode**, click **Load unpacked**, and select the extracted folder containing `manifest.json`.
5. Open or refresh the [EA FC Web App](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/), sign in to your own account, and click the **F** launcher at the bottom right.

Alternatively, download this repository using **Code → Download ZIP**, extract it, and load its **extension** subfolder. The release ZIP contains only the installable extension.

To update, replace the files in the installed folder, click **Reload** in the extension manager, and refresh the EA Web App. Current version: **0.21.7**. Requires Chromium 116 or newer; Arc was used for live checks. This is not a Chrome Web Store installation.

## Use

- **SBC:** Open an SBC in EA and click **Find + build squad**. FutSBC compares readable FUTBIN completed squads, matches exact EA cards, uses matching club cards, and adds concepts for missing players. Swap checks test cheaper candidates against EA's SBC requirements.
- **Buy missing cards:** Click **Check prices**, review the total, and choose **Buy** to approve that ceiling. The extension stops on an uncertain purchase. Final SBC submission always stays with you.
- **Team:** Select positions, choose a total budget, and build a proposed XI. A complete recommendation requires at least 30 chemistry, two chemistry per player, and no chemistry loss for retained players. The search is bounded to checked candidates; source rank is not proof of the best possible team. This feature does not buy cards or apply a squad.
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

Latest validation: 134 automated tests passed. Live checks verified SBC concept building and price quotes, plus Team progress and cancellation. The latest expanded Team run did not complete all live quotes. No live purchases or SBC submissions were made in that verification.

Bundled font licenses are in `extension/fonts/`. Local research, screenshots, development dependencies, and private settings are excluded from the public repository.

### Web App not detected

Update to v0.21.7 or later, allow FutSBC access to EA in the browser’s extension settings, then refresh the EA tab. Regional EA URLs and addresses without a trailing slash are supported. If it still fails, include the full EA tab URL when reporting the issue.
