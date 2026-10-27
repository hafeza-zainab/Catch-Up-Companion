# catchup

A minimal TypeScript app that receives Twitch EventSub notifications over WebSocket and logs them to the console. It does not need a public URL.

## Requirements

- Node.js 22 or newer
- A Twitch user access token for the app's client ID, with these scopes:
  - `user:read:chat`
  - `moderator:read:followers`
  - `channel:read:subscriptions`
- The bot account must be a moderator in the channel for follow notifications. `BOT_ID` must match the user ID associated with `TWITCH_TOKEN`.

## Run

1. Copy `.env.example` to `.env` and fill in the Twitch client ID, user access token, channel broadcaster ID, and bot user ID.
2. Install dependencies: `npm install`
3. Start in development mode: `npm run dev`

To build and run the compiled app, use `npm run build` followed by `npm start`.

Each EventSub notification is printed with its subscription type and JSON event payload. Twitch must be able to validate the token's scopes; the app creates each subscription after the WebSocket session is welcomed.
