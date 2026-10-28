# Catch-Up Companion

## Tagline

Give late-arriving Twitch viewers a quick way into the stream.

## Inspiration

Streams move quickly. When someone arrives halfway through, the chat may be reacting to a joke, a close call, or a raid they missed. I wanted a simple way for them to catch up without asking the streamer to stop.

## What it does

Viewers type `!catchup` and receive a short recap in chat. The same recap appears briefly as a readable OBS overlay card. It summarizes active chatters, repeated phrases, busy chat minutes, raids, and subscriptions. The recap shown in the demo uses seeded sample chat; the bot also supports real Twitch chat in a live channel. Optional Gemini polishing is off unless `GEMINI_API_KEY` is set. When enabled, anonymized chat text and metrics are sent to Google for polishing; if Gemini is unavailable, a local template is used. Automatic first-message cards can be enabled with a five-minute global cooldown.

## How I built it with Codex

I used Codex across the project to build the Twitch EventSub WebSocket receiver, SQLite session storage, recap calculations, chat command, Gemini fallback, and OBS browser source. Codex also helped add recorded-event replay, improve setup and startup checks, and refine the overlay and privacy behavior. Work continued in a second Codex session after usage limits. I worked through the features in small steps and kept the functionality reviewable in Git.

## Challenges

The recap needs to be useful without making up events. I kept its facts grounded in stored chat and channel events, and made Gemini optional with a deterministic fallback. Twitch tokens also need the right scopes and account permissions, so the app checks those at startup and explains missing setup.

## What's next

I’d like to add configurable recap length and overlay placement, improve the demo replay so it can preview the overlay without a live Twitch connection, and give streamers more control over which chat details are included.
