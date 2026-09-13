# Murmur — AI Voice Notes

> Turn spontaneous thoughts into searchable notes and actionable tasks.

Record a memo out loud. Murmur transcribes it with Azure Speech, runs it through Azure AI Language, and organizes the result into a structured note — transcript, summary, topics, and action items — that lives in a searchable history alongside every memo you've recorded.

Text-to-speech is included as a secondary "Listen to summary" feature, read aloud with Azure Neural Voice.

---

## Overview

**Pipeline:** Voice → Transcript → AI Understanding → Summary → Action Items → Topics → Searchable History

1. Record a memo directly in the browser (no file upload required).
2. **Azure Speech** transcribes the audio (speech-to-text, word-level timestamps, confidence score).
3. **Azure AI Language** extracts key phrases, named entities, linked entities, and sentiment from the transcript.
4. The app derives a **summary** and **topics** from those Language outputs, and detects **action items** in the transcript using deterministic phrase-pattern matching (see [Processing Pipeline](#processing-pipeline) for exactly what's real AI output vs. local heuristics).
5. The memo is saved to your local, searchable history. You can favorite it, search it later, see its action items in the Tasks view, see its topics in the Topics view, or hear the summary read aloud with **Azure Neural TTS**.

## Screenshots

_placeholder — add screenshots of the recorder, an expanded memo, the Tasks view, and the Topics view here._

---

## Key Features

- **In-browser recording** with a live waveform (real mic amplitude, not decorative) and timer
- **Explicit pipeline states** — idle, recording, uploading, processing, completed, error — with retry on failure
- **Structured memo view** — transcript, AI summary, action items, topics, sentiment/language, duration
- **Memo history** persisted locally (`localStorage`), reloadable after a refresh
- **Instant client-side search** across transcript, summary, topics, and action items
- **Tasks view** aggregating action items across all memos, each linking back to its source memo, with local complete/incomplete toggling
- **Topics view** grouping memos by extracted key phrases
- **Favorites**
- **Listen to summary** — Azure Neural Voice reads the memo summary back to you, on demand, from any memo in your history
- Responsive layout: sidebar navigation on desktop/tablet, bottom tab bar on mobile
- Full observability preserved: Application Insights tracing, per-stage latency histograms, `/telemetry-summary`

---

## Processing Pipeline

Being upfront about what's actual Azure AI output versus local logic, per the project's "don't invent capabilities" constraint:

| Feature | Source | Notes |
|---|---|---|
| Transcript, language, confidence, word timings | **Azure Speech** (`SpeechRecognizer`) | Real STT output |
| Topics | **Azure AI Language** key phrase extraction | Used as-is |
| Entities, linked entities | **Azure AI Language** | Used as-is |
| Sentiment | **Azure AI Language** | Used as-is |
| Summary | Deterministic template over the Language outputs above (key phrases + sentiment + entity counts) | Azure AI Language, as configured here, has no abstractive summarization endpoint — this is honest templated text, not an LLM summary |
| Action items | Local phrase-pattern heuristic over the transcript (`need to`, `remember to`, `follow up`, `let's`, etc.) | Azure AI Language has no action-item extraction API; adding one would mean a new external AI dependency, which is out of scope here. The heuristic is intentionally conservative and documented in-app as a limitation |
| Summary audio | **Azure Neural TTS** (`en-US-JennyNeural`) | Real synthesis of the summary text above |

The app keeps working end-to-end if any single stage's enrichment is sparse (e.g., a memo with no detected key phrases still saves fine with an empty Topics list).

---

## Architecture

```
public/                     Static frontend (served by Express)
  index.html                 App shell: sidebar + main area
  styles.css                 Design system
  js/
    app.js                    App state, view routing, event wiring
    recorder.js                Mic capture -> PCM -> WAV encoding, waveform metering
    api.js                     fetch() wrappers around /process and /speak
    store.js                   localStorage-backed memo history, search, action-item
                                heuristics, topic/task aggregation
    ui.js                      DOM rendering for each view

server.js                  Local development server (WAV/MP3 via ffmpeg-static normalization)
server_azure.js            Azure Web App entrypoint (WAV only, full OpenTelemetry instrumentation)
telemetry.js               Application Insights bootstrap (@azure/monitor-opentelemetry)
```

Both server variants share the same Azure Speech / Azure AI Language / Azure Neural TTS logic; `server_azure.js` additionally wraps each pipeline stage in an OpenTelemetry span and records latency histograms. Memo history has no backend/database component by design — it's a client-side, `localStorage`-backed, portfolio-scope choice rather than new infrastructure.

### API Endpoints

- `POST /transcribe` — audio in, transcript out (Speech only)
- `POST /analyze` — text in, Language analysis out (key phrases, entities, sentiment, linked entities)
- `POST /process` — full pipeline: audio in → transcript + Language analysis + summary + summary audio out
- `POST /speak` — text in, Azure Neural TTS audio out (reuses the same synthesis function `/process` uses internally; added so "Listen to summary" works for memos loaded from history, not just the one just recorded)
- `GET /telemetry-summary` — aggregated latency/confidence/sentiment stats from the current server process

---

## Tech Stack

- **Backend:** Node.js, Express 5
- **AI services:** Azure Speech SDK (STT + Neural TTS), Azure AI Language (`@azure/ai-text-analytics`)
- **Observability:** Azure Monitor OpenTelemetry (`@azure/monitor-opentelemetry`), `@opentelemetry/api`
- **Frontend:** Vanilla HTML/CSS/JS (ES modules), no build step, no framework
- **Persistence:** Browser `localStorage` for memo history (no database)

---

## Local Development

### 1) Clone and install

```bash
git clone https://github.com/AnnieZX/voice-memo-app.git
cd voice-memo-app
npm install
```

### 2) Configure environment variables

```bash
cp .env.example .env
```

Fill in your Azure values (see [Environment Variables](#environment-variables)).

### 3) Run

```bash
node server.js          # local dev server (accepts WAV/MP3, converts via ffmpeg-static)
# or
node server_azure.js    # the exact entrypoint used in the Azure deployment (WAV only)
```

Open `http://localhost:3000`.

---

## Environment Variables

Names are unchanged from the original project — use `.env.example` as the template:

- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_REGION`
- `AZURE_LANGUAGE_KEY`
- `AZURE_LANGUAGE_ENDPOINT`
- `APPLICATIONINSIGHTS_CONNECTION_STRING`

> Never commit `.env`. Rotate any key immediately if it's ever exposed.

---

## Azure Deployment

This app is already deployed as an Azure Web App (`csc391-speech-luozixiao`, resource group `csc391-speech-rg`) with the startup command `node server_azure.js`. To ship an update to that existing app:

```bash
az webapp up \
  --resource-group csc391-speech-rg \
  --name csc391-speech-luozixiao \
  --runtime "NODE:20-lts"
```

This redeploys code only — it does not touch App Settings, so existing environment variables stay intact.

### Provisioning from scratch (reference only — not needed for the existing deployment)

<details>
<summary>Expand for the original resource-provisioning commands</summary>

```bash
az group create --name csc391-speech-rg --location eastus

az cognitiveservices account create \
  --name csc391-speech-resource \
  --resource-group csc391-speech-rg \
  --kind SpeechServices \
  --sku F0 \
  --location eastus \
  --yes

az cognitiveservices account create \
  --name csc391-language-resource \
  --resource-group csc391-speech-rg \
  --kind Language \
  --sku F0 \
  --location eastus \
  --yes

az monitor app-insights component create \
  --app csc391-insights \
  --location eastus \
  --resource-group csc391-speech-rg \
  --application-type web

az appservice plan create \
  --name csc391-speech-plan \
  --resource-group csc391-speech-rg \
  --sku B1 \
  --is-linux

az webapp create \
  --resource-group csc391-speech-rg \
  --plan csc391-speech-plan \
  --name csc391-speech-luozixiao \
  --runtime "NODE:20-lts"

az webapp config set \
  --resource-group csc391-speech-rg \
  --name csc391-speech-luozixiao \
  --startup-file "node server_azure.js"

az webapp config appsettings set \
  --resource-group csc391-speech-rg \
  --name csc391-speech-luozixiao \
  --settings \
  AZURE_SPEECH_KEY="YOUR_SPEECH_KEY" \
  AZURE_SPEECH_REGION="eastus" \
  AZURE_LANGUAGE_KEY="YOUR_LANGUAGE_KEY" \
  AZURE_LANGUAGE_ENDPOINT="https://eastus.api.cognitive.microsoft.com/" \
  APPLICATIONINSIGHTS_CONNECTION_STRING="YOUR_APPLICATIONINSIGHTS_CONNECTION_STRING"
```

</details>

---

## Observability

`telemetry.js` initializes Azure Monitor OpenTelemetry from `APPLICATIONINSIGHTS_CONNECTION_STRING`. `server_azure.js` (the deployed entrypoint) additionally:

- wraps each pipeline stage (`speech_to_text`, `language_analysis`, `text_to_speech`, and now `speak`) in its own tracer span with stage latency and result attributes
- records per-stage latency histograms (`stage_stt_ms`, `stage_language_ms`, `stage_tts_ms`)
- exposes observable gauges for STT confidence/duration/word count and Language entity/key-phrase counts and sentiment
- keeps an in-memory session log surfaced via `GET /telemetry-summary` (total calls, average/min confidence, p95 STT latency, sentiment breakdown, last 10 calls)

None of this was modified by the frontend redesign; the new `/speak` route follows the same span-wrapping pattern as the existing pipeline stages.

---

## Security

- Never commit `.env`, Azure keys, or connection strings
- `.gitignore` excludes `.env`, `node_modules/`, `temp_audio/`, and OS/log files
- Uploaded audio is written to a temp directory and deleted immediately after processing (success or failure)
- Memo history lives entirely in the browser's `localStorage` — nothing about your recordings is persisted server-side beyond the lifetime of a single request
- Rotate keys immediately if a secret is ever exposed

---

## Troubleshooting

- **Authentication/401 errors**: verify keys and endpoint values in `.env` or App Settings.
- **Region mismatch**: ensure resource region and endpoint region align (e.g., `eastus`).
- **App fails on Azure startup**: confirm the startup command is `node server_azure.js`.
- **No telemetry**: verify `APPLICATIONINSIGHTS_CONNECTION_STRING` is set correctly.
- **Recording button does nothing**: the browser needs microphone permission and a secure context (`https://` or `localhost`).

---

## Limitations

- **Summaries are templated, not LLM-generated.** They're built deterministically from Azure AI Language's key phrases, sentiment, and entity counts — there's no abstractive summarization model in the loop (see [Processing Pipeline](#processing-pipeline)).
- **Action items are a heuristic**, not a dedicated AI capability — detected via conservative phrase-pattern matching over the transcript, not an Azure API.
- **Persistence is local-only.** Memo history lives in the browser's `localStorage`, so it's per-device/per-browser with no sync, backup, or multi-user support.
- **Gmail integration is planned, not implemented.** The Tasks view has a disabled "Draft in Gmail" affordance as a placeholder for future OAuth-based email drafting — it does not currently send or draft anything.
- **No authentication.** This is a single-user portfolio project; anyone with access to the deployed URL can use it.
- Azure free-tier (F0) quotas apply to the deployed instance, so heavy usage may hit rate limits.

## License

Add your project license here (e.g., MIT) if applicable.
