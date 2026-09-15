# Generating walk-up announcements

Announcement audio is ElevenLabs text-to-speech, generated ahead of the game and
committed to `audio/announcements/`. This file records the exact settings so a
re-run sounds like the existing files.

## Voice and settings

| Setting | UI value | API value |
|---|---|---|
| Voice | Baseball Announcer Two (custom) | `SzhLxXqLBlrRykTRhsSA` |
| Model | Multilingual v2 | `eleven_multilingual_v2` |
| Speed | 1 | `speed: 1.0` |
| Stability | 35% | `stability: 0.35` |
| Similarity | 95% | `similarity_boost: 0.95` |
| Style Exaggeration | 40% | `style: 0.40` |
| Speaker boost | on | `use_speaker_boost: true` |
| Output | — | `mp3_44100_128` |

Style exaggeration and speed need a v2 model; `eleven_v3` ignores them.

## Script text

Without jersey numbers (current):

    Now batting, {First} {Last}

With jersey numbers (once they are assigned):

    Now batting for Bloordale: number {number}, {First} {Last}!

## File naming

`audio/announcements/{First}{Last}.mp3` with every non-alphanumeric character
removed — `Mark O'Shea` becomes `MarkOShea.mp3`. `roster.json` points at these
paths in each player's `announcement` field.

## Path A — hosted MCP server (no API key)

ElevenLabs runs a hosted MCP server that authenticates with OAuth, so nothing is
installed and no key is stored. Registered at user scope as:

    claude mcp add --transport http -s user elevenlabs https://api.us.elevenlabs.io/v1/mcp

`https://api.elevenlabs.io/v1/mcp` redirects to the regional host and fails OAuth
resource validation, so use the regional URL directly. Authenticate with `/mcp`,
then restart Claude Code — a server added mid-session does not load its tools
until the next start.

This is the ElevenCreative flow API, not the plain text-to-speech tool:

1. `creative_list_voices(search="Baseball Announcer")` →
   `Baseball Announcer Two` is `SzhLxXqLBlrRykTRhsSA`.
2. `creative_generate_speech(prompt="Now batting, Nolan Pitton",
   model_id="eleven_multilingual_v2", voice_id="SzhLxXqLBlrRykTRhsSA",
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

Files generated this way on 2026-09-15:
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
