# Catch-Up Companion

Catch-Up Companion gives late-arriving Twitch viewers a short recap in chat and on an OBS overlay when they type `!catchup`. First-message overlay cards are optional.

## Architecture

1. `src/index.ts` validates Twitch settings, connects to EventSub over WebSocket, and coordinates recap triggers.
2. `src/eventHandler.ts` saves chat and channel events to the current SQLite session.
3. `src/recap.ts` calculates top chatters, repeated phrases, chat spikes, raids, and subscriptions.
4. Optional Gemini polishing receives aggregate recap data with chatter names replaced by aliases; failures use the local template.
5. `src/web.ts` sends recap events to `public/index.html`, which renders the transparent OBS card.

## Run

1. Install Node.js 22+. Register a Twitch app with redirect URL `http://localhost:3000` in the [Developer Console](https://dev.twitch.tv/console/apps).
2. Install the [Twitch CLI](https://dev.twitch.tv/docs/cli/) and configure the app's client ID and secret with `twitch configure`. Create a user token:

   ```sh
   twitch configure
   twitch token -u -s 'user:read:chat moderator:read:followers channel:read:subscriptions user:write:chat'
   ```

   Consent as the bot account. In broadcaster chat, run `/mod bot_username`; the broadcaster must authorize subscription access.
3. Copy `.env.example` to `.env`. Set `TWITCH_CLIENT_ID`, `TWITCH_TOKEN`, `CHANNEL_ID`, and `BOT_ID`. Use numeric Twitch IDs from the [Get Users endpoint](https://dev.twitch.tv/docs/api/reference/#get-users). Keep tokens and secrets private.
4. Run `npm install` and `npm run dev`. Startup checks variables, token validity, app/user IDs, and scopes. Production: `npm run build`, then `npm start`.

Add `http://127.0.0.1:3000` as an OBS browser source. `AUTO_RECAP=true` enables first-message cards with a five-minute global cooldown; default is `false`.

## Demo mode

Run `npm run replay -- samples/chat-events.json 10` to replay sample EventSub events at 10× speed. It writes to SQLite and logs events without Twitch credentials. Live replies and overlays need a Twitch connection.

Set `SEED_DEMO_FILE=samples/chat-events.json` to load sample events into the current live session at startup, with the last event timestamp shifted to now.

## Privacy

Chat and channel events are stored in local `catchup.db` and printed to the console. With `GEMINI_API_KEY`, recap metrics and repeated phrases go to Gemini. Known usernames are aliased, but phrase contents are still sent. Without the key, recaps stay local.

## Built with Codex

Codex helped build the EventSub receiver, SQLite storage, recap and tests, chat reply, Gemini fallback, OBS source, and replay tool. It also helped refine setup, privacy, overlay design, and startup validation. Git tracks the work.
