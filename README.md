<p align="center">
  <img src="https://static.wixstatic.com/media/4d1028_ee09050f15a844459a6b1b2366fb3c17~mv2.png/v1/fit/w_2500,h_1330,al_c/4d1028_ee09050f15a844459a6b1b2366fb3c17~mv2.png" alt="Voice-Bridge Logo" width="140" height="140" />
</p>
<h1 align="center">Voice-Bridge</h1>
<p align="center">Thai speech detection for deaf worker in the browser, LINE webhook + push notifications, and AI action summaries via OpenRouter.</p>

<p align="center">
  <video src="https://github.com/user-attachments/assets/b7976cda-ff5e-4a92-a4a3-0cf4e71224ea" width="720" muted autoplay loop playsinline controls></video>
</p>

## What it does
- Frontend (Vite + React): Listens for Thai speech (Web Speech API), matches a phrase, then triggers a backend call.
- Backend (Express): LINE webhook receiver, push sender, and OpenRouter summarization to generate “what to do” action items for Deaf users.

## Prerequisites
- LINE Messaging API channel (Channel access token + Channel secret)
- Optional (for AI summaries): OpenRouter API key
- Node.js (18+ recommended)

## Setup
1) Create `.env`
- Copy `.env.example` to `.env` and fill:
  - `PORT` (optional, default 8787)
  - `LINE_CHANNEL_ACCESS_TOKEN`
  - `LINE_CHANNEL_SECRET`
  - `LINE_USER_ID` (default recipient; can be userId, groupId, or roomId)
  - `OPENROUTER_API_KEY` (optional, enables AI summaries)
  - `LOCAL_SUMMARY_FALLBACK=1` (optional; simple local summary if OpenRouter fails)

2) Install and run dev (client + server)

```cmd
npm install
npm run dev
```

- Frontend: http://localhost:5173 (proxies `/api/*` to backend)
- Backend:  http://localhost:8787

## Configure LINE Webhook
Point your LINE webhook URL to your public HTTPS tunnel ending with `/webhook`.

Example local flow:
- Expose http://localhost:8787 using a tunneling tool (Cloudflare Tunnel, ngrok, etc.)
- Set the LINE webhook URL to: https://<your-public-domain>/webhook
- Click “Verify” in the LINE Developers console

The server verifies `x-line-signature` with `LINE_CHANNEL_SECRET`.

Bot replies in chat:
- On any text message: echoes the message and shows `userId/groupId/roomId`.
- On follow (1:1 add): replies with `userId`.
- On join (group/room): replies with `groupId/roomId`.

You can also fetch last seen IDs from: `GET /api/last-ids`.

### Using ngrok (quick start)
1) Install and sign in to ngrok (https://ngrok.com/), then run:

```cmd
ngrok http 8787
```

2) Copy the HTTPS forwarding URL shown by ngrok, e.g. `https://<random>.ngrok.io`.

3) In LINE Developers console, set the webhook URL to:

```
https://<random>.ngrok.io/webhook
```

4) Click “Verify”, it should return 200. Send a message to the bot to see the IDs reply.

## Using the app
1) In the UI:
- Enter the Thai phrase to match.
- Optionally set a LINE target (userId/groupId/roomId). If empty, the server uses `LINE_USER_ID` or the last seen IDs from webhook.
- Keep “สรุปสิ่งที่ควรทำก่อนส่ง LINE” enabled to request AI summaries.
- Click “▶ Start Listening”, speak Thai.

2) When the phrase is detected:
- You’ll see an alert.
- Backend summarizes (if enabled) using OpenRouter model `google/gemma-3n-e2b-it:free`.
- A LINE push message is sent with: Matched, Heard, and Summary (AI).

## API endpoints
- `GET /api/health` → `{ status: 'ok' }`
- `GET /api/last-ids` → last `userId/groupId/roomId`
- `GET /api/env-check` → shows which env values are loaded (no secrets)
- `POST /api/notify-line` → `{ message: string, to?: string }` (push message)
- `POST /api/report-detection` → `{ matchedText: string, recognizedText: string, to?: string, serverSummary?: boolean, locale?: 'th-TH' }`
- `POST /api/summarize` → `{ text: string, locale?: string }` returns `{ summary }`

## Troubleshooting
- 400 “Missing target recipient”
  - Set `LINE_USER_ID` in `.env`, or fill the Target field in the UI, or make sure the webhook has captured IDs (see `/api/last-ids`). Restart server after editing `.env`.
- Webhook 401 “Invalid signature”
  - Ensure `LINE_CHANNEL_SECRET` matches the channel. Your webhook URL must be exactly `<public>/webhook`.
- No AI summary
  - Check `/api/env-check` → `hasOpenRouterKey` should be true. Review server logs for “OpenRouter error”. Optionally set `LOCAL_SUMMARY_FALLBACK=1`.
- Browser ASR
  - Web Speech API is best on Chrome/Edge. Some browsers may not support `th-TH`.

## Docker (optional)

### Build and run server-only
This image runs only the Express server (no Vite dev server). Ensure `.env` exists in the project root.

```cmd
docker build -t voice-bridge .
docker run --name voice-bridge -p 8787:8787 --env-file .env -d voice-bridge
```

### Docker Compose with ngrok
Brings up the app and an ngrok tunnel so you can copy the HTTPS URL for the LINE webhook.

```cmd
docker compose up -d --build
```

- App: http://localhost:8787
- ngrok Web UI: http://localhost:4040 (copy the HTTPS forwarding URL and set it as `https://<...>/webhook` in LINE console)

Optional: set `NGROK_AUTHTOKEN` in your `.env` to avoid rate limits.

## Future plan
- Hand-gesture converter: integrate camera-based hand pose/gesture recognition to augment or replace speech triggers.
- DEVIO CONNEXT (AIS) integration: connect to DEVIO Beacon from AIS to receive proximity or context signals and trigger notifications/actions in Voice-Bridge.


