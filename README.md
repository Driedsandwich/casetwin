# CaseTwin

CaseTwin helps a support agent investigate “only this CSV fails to import” without uploading the customer file. A local model suggests a failure condition. Deterministic JavaScript builds a three-row fictional reproduction, runs both inputs through the same importer validator, and compares error kind, field, condition and validator version. A developer receives a reviewed synthetic bundle instead of customer data.

The C3 interface follows the supplied evidence and handoff designs. English is the default; **EN / 日本語** preserves the working data. Only Japanese displays the prototype guidance banner. `prototype/` remains unchanged. `DESIGN.md` records the visual specification.

## Run locally

Use Node.js 26 or later and npm (the installed Node test DOM dependency requires a recent Node release). This implementation was tested with Node 26.13.0 and npm 11.20.0.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite yourself. No configuration is needed for Demo mode. The initial CSV is the prototype's 64-row **fully fictional** sample. Load another sample or choose a UTF-8 CSV up to 2 MiB and 10,000 data records.

1. Select **Analyze on this device**, or select a condition manually.
2. Select **Create synthetic repro**. A condition mismatch blocks review.
3. After a match, select **Review what will be shared**. Review both sharing columns and the exact cloud input disclosure.
4. In configured mode, explicitly authorize the fictional cloud input and select **Generate cloud draft**. In Demo mode a labeled static draft appears.
5. Review the report and check the approval box. **Export share bundle** downloads `casetwin-share-bundle.json` locally. Export does not send it anywhere.

**Save bundle to Firestore** is a separate explicit action and requires Google sign-in outside Demo mode. **Make shorter and clearer** sends only the existing draft through the rewrite feature; its displayed disclosure explains the possible cloud fallback. A rewritten draft revokes export approval.

## Inference policy

The single executable feature policy table is [`src/inference-policy.js`](src/inference-policy.js). The table below documents that policy; all SDK model options are constructed from it. Build and tests reject private inputs assigned a cloud-capable mode. Every actual answer displays the SDK's `response.inferenceSource` (`on_device` or `in_cloud`); missing or contradictory provenance is rejected. Simulations say **Simulated · no inference** and have a null source.

| Feature | Allowed input | Enforced mode | Meaning / 日本語訳 |
| --- | --- | --- | --- |
| Failure-condition candidates | Private original summary: column names, inferred types, problem shape and check states | `ONLY_ON_DEVICE` | Device only with no cloud retry / 端末だけで推論 |
| Developer report draft | Fictional repro CSV, static importer validation code and fingerprint | `ONLY_IN_CLOUD` | Cloud only / 雲だけで推論 |
| Shorter and clearer report | Existing draft text only | `PREFER_ON_DEVICE` | Prefer the device and use the cloud when unavailable / 端末を優先して利用できなければ雲へ |

All real inference uses **`firebase/ai` from exactly `firebase@13.4.0`**. No direct model API, direct browser model inference, or third-party model endpoint is used. The installed SDK's declarations and implementation were inspected locally, without web research. `getGenerativeModel` uses `HybridParams.mode`, optional `inCloudParams`, and `initializeDeviceModel()` for candidates.

A defensive capability guard runs before private model initialization. In the installed 13.4.0 browser code, a missing `LanguageModel` means no Chrome adapter is created, and the dispatcher has a cloud path without an adapter. CaseTwin therefore refuses private inference before invoking the SDK when that API is absent. Availability detection only checks the browser API's presence; inference and device initialization still go through Firebase AI Logic.

Local calls, including report rewrites that may run locally, are serialized. The first candidate call displays preparation guidance. The supplied observation was that Chrome 158 can run `ONLY_ON_DEVICE` with dummy Firebase values, taking about 11 seconds on the first call and returning trailing blank lines. This observation was **not independently reproduced here**. Responses are trimmed. While preparing, or after unavailable/failed/invalid local inference, the agent can choose a condition manually. Private data has no cloud fallback.

## Demo mode

Missing or incomplete configuration selects Demo mode and displays **Demo mode — cloud steps are simulated**. All dummy Firebase values are `demo` (four characters).

- Candidate inference is real Firebase AI Logic on-device inference if supported, with the same manual fallback.
- Cloud drafts and rewrites use labeled in-code fictional templates; they make no inference request.
- Google sign-in, Firestore save and App Check are simulations. No Firebase auth, database or App Check initialization is performed for those actions.
- Export is a real local JSON download. MCP can serve a clearly fictional approved fixture.
- Generation, all four checks and fingerprint comparison run real JavaScript in both modes.

Demo rewrites are simulations of the workflow, not a claim that the `PREFER_ON_DEVICE` production route ran. A browser may need to prepare or download its on-device model. Browser support and actual inference latency on a particular machine remain unverified.

## Configure Firebase locally

Only [`public/firebase-config.example.js`](public/firebase-config.example.js), with empty strings, is committed. Do not put real keys, project values, App Check debug values, customer data or personal information in the repository.

1. Copy `public/firebase-config.example.js` to `public/firebase-config.js`. The real file is ignored by git. Fill the Firebase Web app settings and `appCheckSiteKey` locally. Set `cloudModel` to a text model enabled for your Firebase AI Logic project. There is no guessed production model name in this repository.
2. In your Firebase project, configure Firebase AI Logic for the Gemini Developer API backend, Google Authentication and a Firestore database. Enable Google sign-in and authorize the intended app domain.
3. Register the web app for App Check with reCAPTCHA v3 and place its site key in `appCheckSiteKey`. The app initializes `ReCaptchaV3Provider` with automatic token refresh before configured Firebase calls. Configure App Check enforcement for the relevant services in your project.
4. Apply `firestore.rules` to the intended project before using database storage. `firebase.json` references the rules and Vite build output. No project ID or `.firebaserc` with a real value is included. Deployment and rule application are manual operator tasks and were not performed here.
5. Restart Vite after changing the local config. Verify that the Demo banner is gone. Sign in through Settings. Review the exact cloud payload before the first report request.

For **development only**, add `window.CASETWIN_APP_CHECK_DEBUG = true;` to your ignored local configuration file before loading the app. Vite's `import.meta.env.DEV` guard is required before the App Check debug hook is enabled. Register any SDK-generated token through your own Firebase administration process and keep it out of source files and logs you publish. No debug token is supplied here. Production builds remove this development branch.

When the optional private config is absent, Vite serves or emits an empty configuration script and bootstrap continues into Demo mode. The source repository still contains only the empty-value example. Firebase Web configuration is necessarily delivered to the browser in a configured deployment; git exclusion is repository hygiene, not an authorization mechanism. Authentication, App Check and Firestore rules supply the service boundaries.

Exact console navigation, live project enablement, quotas, model availability and end-to-end credentials are **unverified** from the supplied materials. No live Firebase operation was attempted during implementation.

## Sharing and storage boundary

[`src/core.js`](src/core.js) is the prototype's core script extracted verbatim. Its CSV parser, deterministic generator, four validation checks and fingerprint comparison are unchanged. A test compares the source with `prototype/index.html`.

[`createCloudPayload`](src/sharing.js) is the only cloud-input factory. It accepts synthetic data and returns exactly fictional CSV content and encoding, importer code and a known fingerprint. It checks the repro against the deterministic generator's output format, including collision salts and invalid UTF-8 bytes. Arbitrary source headers cannot become cloud fingerprint fields. Report calls never receive the original file, its filename, its cell values, original row numbers or local AI notes.

The approved export includes `schemaVersion`, `approved`, `synthetic`, `importerCode`, `fingerprint`, `validation`, `report` and `createdAt`. Validation summaries are reconstructed from the matching synthetic checks; they omit original row numbers and raw logs. Invalid UTF-8 reproductions are Base64 encoded to preserve exact bytes. Decode that field before testing the importer. The exported `importerCode` can be saved as `importer-r17.cjs`; it exports `readBytes` and `validate` for Node.

Firestore uses `users/{uid}/bundles/{id}` and adds `ownerId` plus a server creation timestamp. Rules allow only the owner to read or write and enforce exact field allowlists, bounded text, known fingerprints and sanitized check structures. Other documents are denied. Firestore Lite is loaded only for explicit save; there is no original-file persistence or Firestore offline cache in the app. Original CSV data stays in page memory and clears on reload. Google Authentication may maintain its own login session.

Rules enforce ownership and structure; they cannot prove that arbitrary strings submitted by a modified client are fictional. The application verifies generated bytes before exporting or storing. Human approval in local JSON is a workflow marker, not a cryptographic signature. Use trusted local exports and filesystem permissions when exposing bundles to an agent.

“No original values” means no source data-cell value is copied into synthetic data. Schema identifiers required by r17 are intentionally shared. Accidental substrings, common words in static code, or coincidentally equal numerical row counts are not copied customer data. Source values are not model inputs to cloud steps. A matching signature is not proof of a matching underlying cause.

## MCP for AI agents

The Node MCP adapter uses `@modelcontextprotocol/sdk` over stdio. It performs no inference, opens no network listener and does not contact Firebase. The app's Settings includes **For AI agents**. `llms.txt` is the repository entry point.

```sh
# Approved fictional fixture
npm run mcp -- --demo

# A bundle reviewed and downloaded from the web app
CASETWIN_BUNDLE_PATH=/absolute/path/to/casetwin-share-bundle.json node mcp/server.js
```

Configure your MCP client to launch `node` with the absolute path to `mcp/server.js`, the repository as its working directory, and either `--demo` or the `CASETWIN_BUNDLE_PATH` environment variable. Use direct `node` invocation for clients that require pure JSON-RPC stdout; npm prints a startup banner.

| Tool | Result |
| --- | --- |
| `prepare_repro` | The location of an already locally exported approved bundle. It does not generate, approve or send. If no valid export exists, it asks the operator to export one. |
| `get_repro` | Only the approved fictional CSV, fixed synthetic filename and encoding. |
| `get_validation_report` | Only fingerprint and sanitized validation results. |

No tool accepts customer CSV or a caller-selected file path. The configured local export is size-limited and validated before any tool responds. Unapproved exports, unexpected fields, arbitrary CSV values, modified importer code and inconsistent validation are refused. Error responses do not echo input, filenames or private parser errors. MCP never returns the original CSV, original filename, original cell contents, original row numbers, raw logs, local AI notes or report prose. Preparation returns the **export path**, not a customer-file path. The demo path is `demo://approved-repro` and is consumed through the other two tools rather than the filesystem.

## Tests and build

```sh
npm test
npm run build
npm run preview
```

`npm test` runs Node tests for policy enforcement, SDK mode mapping, absence-of-device guards, serialized inference, cloud payload privacy, synthetic collision avoidance, both fingerprint outcomes, Demo detection, dictionary parity, approved-only MCP access and a real MCP stdio round trip. JSDOM tests exercise the UI workflow and escaping without launching a browser. The unchanged prototype's 30 checks also run. Tests never call a live model or Firebase service.

`npm run build` checks policy before Vite and fails if any emitted JavaScript chunk exceeds **500,000 bytes**. Firebase AI, App Check, Authentication and Firestore are separately lazy-loaded. The local development server binds to `127.0.0.1` by default.

## Limits and verification status

- The target is **one importer**: the prototype's validator `r17`, not a supplied production database transaction. No production importer integration was available.
- r17 checks UTF-8, CSV structure, required `customer_id` and `name`, embedded newlines, then duplicate keys. It stops at the first failure. `not_run` is not a pass. Rows are data records excluding the header.
- The generator covers duplicate keys, embedded newlines in known columns, either required column missing and invalid UTF-8. Arbitrary extra-column failures, malformed CSV and the row-limit failure may not reproduce; mismatches block handoff.
- A matching failure fingerprint can have a different root cause. Cloud reports are hypotheses requiring developer review. Model outputs do not generate the CSV or determine validation success.
- Browser rendering, keyboard/screen-reader behavior, actual Chrome inference, Google popup login, reCAPTCHA/App Check and deployed Firestore rules remain **unverified** in this environment. Node DOM tests do not establish visual correctness. No browser or screenshot was used.
- The initial npm installation reported five high-severity dependency findings. Zod was updated to the MCP-supported 4.x line and the Node-side `@grpc/grpc-js` dependency was overridden to the patched 1.14.x-or-later 1.x line while preserving Firebase 13.4.0. The final npm installation audit reported **0 vulnerabilities**. The browser app uses Firestore Lite; the Node Firestore backend is not used by MCP.
- No web search, browser automation, external app write, message, deployment, git commit, YouTube fetch or X fetch was performed. Only npm installation used external network access.

## License

Apache-2.0. The full license is included in [`LICENSE`](LICENSE).
