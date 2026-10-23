# Re-record endpoint

Backs the "Re-record" button in the app's Settings tab. The app is a static site
on GitHub Pages, so the ElevenLabs key cannot live in it; this function holds the
key, checks a passcode, generates the announcement, and hands the MP3 back.

Not tied to Supabase, and no key is ever stored on a device — the passcode is
typed once per browser and the key stays server-side.

## Deploy

    cd tools/regen-api
    npx vercel login          # once, interactive
    npx vercel link           # project: walkup-regen
    npx vercel --prod

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ELEVENLABS_API_KEY` | yes | the key from `~/.elevenlabs-key` |
| `REGEN_PASSCODE` | yes | what the app asks for before re-recording |
| `ELEVEN_VOICE_ID` | no | defaults to Baseball Announcer Two (`SzhLxXqLBlrRykTRhsSA`) |
| `GITHUB_TOKEN` | no | fine-grained PAT with Contents: read and write on this repo |
| `GITHUB_REPO` | no | `dean3586/walkup` |

Set them with `npx vercel env add NAME production`.

Without `GITHUB_TOKEN` the endpoint still returns audio and the app saves it on
the device that asked, reporting "Saved on this device". With it, the endpoint
commits the MP3 to `audio/announcements/`, Pages redeploys, and every phone gets
the new take — the app then reports "Saved for everyone". That is why
`audio/announcements/*.mp3` is excluded from Git LFS in `.gitattributes`: a
commit through the GitHub API writes a plain blob, not an LFS pointer.

## Request

    POST /api/regenerate
    { "passcode": "...", "number": 3, "firstName": "Joseph",
      "lastName": "Fotia", "pronunciation": "Joseph Foh-TEE-ah",
      "withNumbers": false }

Replies `{ file, text, audio (base64 mp3), committed }`. Requests are refused
unless the `Origin` header is the app's, and a wrong passcode costs the caller a
1.5-second delay.

## Playback log

`POST /api/log` stores the app's playback log: taps, when each sound started,
load and play errors, launches, returns from the background and resets. The
app queues entries on the phone and sends them in batches:

    { "device": "k3j9x0a2", "entries": [{ "at": "<ISO time>", "message": "..." }] }

Each batch is committed as one file, `logs/<date>/<time>-<device>-<id>.jsonl`,
to the repo's `logs` branch, which the endpoint creates from `main` the first
time. Nothing on `logs` is deployed. Uses the same `GITHUB_TOKEN` and
`GITHUB_REPO` as re-recording, and the same `Origin` check. Read it with
`git fetch origin logs` and `git show origin/logs:logs/<date>/<file>`.

## Voice settings

Identical to `tools/generate_announcements.py`: `eleven_v3`,
stability 0.5, similarity 0.8, style 0, speed 1.0, speaker boost on. Change
one and change the other, or re-recordings will not match the committed files.

## Testing it locally

The app calls `http://127.0.0.1:8788/api/regenerate` when served from localhost,
so the handler can be run behind any small HTTP shim on that port with
`ELEVENLABS_API_KEY` and `REGEN_PASSCODE` set.
