# Generating walk-up announcements

Announcement audio is ElevenLabs text-to-speech, generated ahead of the game and
committed to `audio/announcements/`. This file records the exact settings so a
re-run sounds like the existing files.

## Voice and settings

| Setting | UI value | API value |
|---|---|---|
| Voice | Baseball Voice Three (custom) | `dhlnEOuE4v7Hy8nuusjU` |
| Model | Multilingual v2 | `eleven_multilingual_v2` |
| Speed | 0.9 | `speed: 0.9` |
| Stability | 90% | `stability: 0.90` |
| Similarity | 100% | `similarity_boost: 1.0` |
| Style Exaggeration | 15% | `style: 0.15` |
| Speaker boost | on | `use_speaker_boost: true` |
| Output | — | `mp3_44100_128` |

Style exaggeration and speed need a v2 model; `eleven_v3` ignores them.
Style is kept low on purpose: the voice already builds its own crescendo, and
pushing exaggeration on top of that destabilises the read.

## Script text

Without jersey numbers (current):

    Now batting ... {First} {Last}!

With jersey numbers:

    Now batting ... number {jersey} ... {First} {Last}!

The ellipses are pauses, and they matter — the announcer builds to the name
instead of reading a flat line. Say "for Bloordale" and it goes back in.

## Jersey numbers

Every player carries two numbers. `number` in `roster.json` is the internal id:
lineups, song picks, start times and stored re-records are all keyed by it, so
it never changes. `jersey` is the number on the shirt — blank until assigned,
editable in the app, and the one that gets displayed and announced.

Set them in Settings: the `#` box beside each player's name. The checkbox above,
"Say jersey numbers", decides which of the two phrasings a re-record uses. Both
sync across devices with everything else, and both take effect the next time an
announcement is recorded, not during playback.

From the command line the jersey comes out of `roster.json`, or from `--names`
as `17:Nolan Pitton`, with `--numbers` choosing the phrasing:

    python tools/generate_announcements.py --numbers --force

## Pronunciation

Each player in `roster.json` has a `pronunciation` field. Leave it `null` and the
announcer says the real name; set it and that string is spoken instead:

    {
      "number": 2,
      "firstName": "Charlie",
      "lastName": "Mondoux",
      "pronunciation": "Charlie mon-DOO",
      ...
    }

It only changes what is spoken. The name on screen and the MP3 filename still
come from `firstName` and `lastName`, so a respelling never renames a file or
breaks the roster.

Write it as a respelling: hyphens between syllables, capitals on the stressed
one — `mon-DOO`, `FOH-tee-uh`, `BUR-kuh`. That is the available lever on
`eleven_multilingual_v2`: SSML phoneme tags work only on `eleven_flash_v2`, and
IPA-in-slashes (`/ˌbaɪoʊˈkemɪstri/`) only on `eleven_v3`. If a respelling refuses
to land, `<lexeme><grapheme>Mondoux</grapheme><alias>mon-DOO</alias></lexeme>` is
the v2-compatible fallback and can go straight in the field.

Audition one without overwriting a committed file — `--names` takes
`[Number:]Name[=Pronunciation]`:

    python tools/generate_announcements.py --force --out-dir %TEMP%         --names "Charlie Mondoux=Charlie mon-DOO"

When it sounds right, put it in `roster.json` and re-render for real:

    python tools/generate_announcements.py --force

## File naming

`audio/announcements/{First}{Last}.mp3` with every non-alphanumeric character
removed — `Mark O'Shea` becomes `MarkOShea.mp3`. `roster.json` points at these
paths in each player's `announcement` field.

## Re-recording from the app

Settings has a "Re-record" button beside each pronunciation field. The whole
Settings tab is read-only until the passcode (`REGEN_PASSCODE` in `app.js`) is
entered, because everything there is the team's shared setup.

The button posts to `https://walkup-regen.vercel.app/api/regenerate`
(source and deploy notes in `tools/regen-api/`). That endpoint holds the
ElevenLabs key and a GitHub token, checks the passcode, generates the audio, and
commits the MP3 to `audio/announcements/` — Pages redeploys and every device
gets it. Nothing secret sits in `app.js`.

A committed take is played from memory and deliberately not stored on the
device: a local copy would shadow the team version the next time someone else
re-records that player. If the endpoint has no GitHub token it still returns
audio, the app keeps it locally, and the status says so.

The endpoint duplicates the voice, model and settings below. Change one and
change the other, or a re-record stops matching the committed files.

## Jersey numbers

Every player carries two numbers. `number` in `roster.json` is the internal id:
lineups, song picks, start times and stored re-records are all keyed by it, so
it never changes. `jersey` is the number on the shirt — blank until assigned,
editable in the app, and the one that gets displayed and announced.

Set them in Settings: the `#` box beside each player's name. The checkbox above,
"Say jersey numbers", decides which of the two phrasings a re-record uses. Both
sync across devices with everything else, and both take effect the next time an
announcement is recorded, not during playback.

From the command line the jersey comes out of `roster.json`, or from `--names`
as `17:Nolan Pitton`, with `--numbers` choosing the phrasing:

    python tools/generate_announcements.py --numbers --force

## Pronunciation

Each player in `roster.json` has a `pronunciation` field. Leave it `null` and the
announcer says the real name; set it and that string is spoken instead:

    {
      "number": 2,
      "firstName": "Charlie",
      "lastName": "Mondoux",
      "pronunciation": "Charlie mon-DOO",
      ...
    }

It only changes what is spoken. The name on screen and the MP3 filename still
come from `firstName` and `lastName`, so a respelling never renames a file or
breaks the roster.

Write it as a respelling: hyphens between syllables, capitals on the stressed
one — `mon-DOO`, `FOH-tee-uh`, `BUR-kuh`. That is the available lever on
`eleven_multilingual_v2`: SSML phoneme tags work only on `eleven_flash_v2`, and
IPA-in-slashes (`/ˌbaɪoʊˈkemɪstri/`) only on `eleven_v3`. If a respelling refuses
to land, `<lexeme><grapheme>Mondoux</grapheme><alias>mon-DOO</alias></lexeme>` is
the v2-compatible fallback and can go straight in the field.

Audition one without overwriting a committed file — `--names` takes
`[Number:]Name[=Pronunciation]`:

    python tools/generate_announcements.py --force --out-dir %TEMP%         --names "Charlie Mondoux=Charlie mon-DOO"

When it sounds right, put it in `roster.json` and re-render for real:

    python tools/generate_announcements.py --force

## File naming

`audio/announcements/{First}{Last}.mp3` with every non-alphanumeric character
removed — `Mark O'Shea` becomes `MarkOShea.mp3`. `roster.json` points at these
paths in each player's `announcement` field.

## Re-recording from the app

Settings has a "Re-record" button beside each pronunciation field, so a name can
be fixed at the field instead of from a laptop. The buttons stay hidden until the
passcode in `REGEN_PASSCODE` (`app.js`) is entered, which is what stops someone
spending credits by tapping something they don't recognise.

It calls ElevenLabs directly from the browser — no server, no proxy. The key in
`ELEVEN_API_KEY` is public by design and restricted in the ElevenLabs dashboard
to a small credit quota, so a stray copy can spend a few announcements' worth of
credit and nothing more. Rotate it there if needed, and paste the new one into
`app.js`.

`ELEVEN_VOICE_SETTINGS` and the phrase in `app.js` duplicate what is in
`tools/generate_announcements.py`. Change one and change the other, or
re-recordings will not match the committed files.

A re-record plays immediately and is stored in that browser (IndexedDB), so it
overrides the committed file on that device only. To give everyone the new take,
regenerate with the script and commit the MP3. Announcements phrase with numbers
when `ANNOUNCE_WITH_NUMBERS` in `app.js` is flipped to true.

## Path A — hosted MCP server (no API key)

ElevenLabs runs a hosted MCP server that authenticates with OAuth, so nothing is
installed and no key is stored. Registered at user scope as:

    claude mcp add --transport http -s user elevenlabs https://api.us.elevenlabs.io/v1/mcp

`https://api.elevenlabs.io/v1/mcp` redirects to the regional host and fails OAuth
resource validation, so use the regional URL directly. Authenticate with `/mcp`,
then restart Claude Code — a server added mid-session does not load its tools
until the next start.

This is the ElevenCreative flow API, not the plain text-to-speech tool:

1. `creative_list_voices(search="Baseball")` →
   `Baseball Voice Three` is `dhlnEOuE4v7Hy8nuusjU`. Earlier takes used
   `Baseball Announcer Two` (`SzhLxXqLBlrRykTRhsSA`).
2. `creative_generate_speech(prompt="Now batting, Nolan Pitton",
   model_id="eleven_multilingual_v2", voice_id="dhlnEOuE4v7Hy8nuusjU",
   generations_count=1, flow_id=<one flow for the batch>)`. Pass
   `estimate_only=true` first to price it — about 25 credits ($0.0025) per name.
   `generations_count` defaults to 4, so set it to 1 or pay four times over.
3. Poll `creative_get_flow_run_status` with the flow_id and every session_id
   until `all_completed`.
4. Each `media` entry carries its `prompt` and a signed `url` valid for two
   hours. Download with curl to `audio/announcements/{First}{Last}.mp3`.

**Limitation:** the TTS node exposes only `voice_id` and `language_code`. There is
no stability, similarity, style, or speed parameter on any TTS model here
(checked v2, v3, v4), so this path cannot apply the settings in the table above —
it generates with the voice's defaults. Use Path B when the exact dial positions
matter.

A first pass was generated this way on 2026-09-15 and then re-rendered through
Path B to pick up the settings. The takes are still on the canvas:
<https://elevenlabs.io/app/flows/b7dqzPdYuavXyhh3B9lV>

## Path B — script against the REST API

`tools/generate_announcements.py` holds the same settings and writes correctly
named files directly. It needs an API key in `ELEVENLABS_API_KEY` or in
`~/.elevenlabs-key` (gitignored), and uses only the Python standard library.

    # every player in roster.json, name-only phrasing
    python tools/generate_announcements.py

    # once numbers are assigned, re-record everyone
    python tools/generate_announcements.py --numbers --force

    # players not in roster.json yet
    python tools/generate_announcements.py --names "Charlie Mondoux" "Joseph Fotia"
    python tools/generate_announcements.py --numbers --names "5:Nolan Pitton"

Existing files are skipped unless `--force` is passed. `--dry-run` prints the
lines and filenames without calling the API.

## When numbers arrive

1. Put the numbers in `roster.json`.
2. `python tools/generate_announcements.py --numbers --force`
3. Listen to each file, then commit the MP3s.
