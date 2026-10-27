# catchup

A minimal TypeScript app that receives Twitch EventSub notifications over WebSocket and logs them to the console. It does not need a public URL.

## Requirements

- Node.js 22 or newer
- A Twitch user access token for the app's client ID, with these scopes:
  - `user:read:chat`
  - `moderator:read:followers`
  - `channel:read:subscriptions`
  - `user:write:chat`
- The bot account must be a moderator in the channel for follow notifications. `BOT_ID` must match the user ID associated with `TWITCH_TOKEN`.

## Run

1. Copy `.env.example` to `.env` and fill in the Twitch client ID, user access token, channel broadcaster ID, and bot user ID.
2. Install dependencies: `npm install`
3. Start in development mode: `npm run dev`

To build and run the compiled app, use `npm run build` followed by `npm start`.

For an OBS browser source, add `http://127.0.0.1:3000` as the URL. The page shows the recap card when someone uses `!catchup` and hides it after 15 seconds. Change the optional `PORT` environment variable if port 3000 is already in use.

## Replay recorded chat

Run the included sample at normal speed with `npm run replay`. Pass a JSON file and optional playback speed multiplier to replay other captures, for example `npm run replay -- samples/chat-events.json 10` for 10× speed. Replay files are JSON arrays of EventSub notification messages. Each replay gets a new SQLite session ID, which is printed when playback starts.

Each EventSub notification is printed with its subscription type and JSON event payload. Twitch must be able to validate the token's scopes; the app creates each subscription after the WebSocket session is welcomed.

To enable optional recap polishing, set `GEMINI_API_KEY` in `.env`. Without it, the bot uses the plain recap template. When set, recap metrics and repeated chat text are sent to Google's Gemini API; errors and timeouts fall back to the template.
