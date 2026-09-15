# Generating walk-up announcements

Announcement audio is ElevenLabs text-to-speech, generated ahead of the game and
committed to `audio/announcements/`. This file records the exact settings so a
re-run sounds like the existing files.

## Voice and settings

| Setting | UI value | API value |
|---|---|---|
| Voice | Baseball Announcer Two (custom, in Dean's account) | resolved by name |
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
resource validation, so use the regional URL directly. Authenticate once with
`/mcp` in Claude Code, then per player:

    text_to_speech(
      text = "Now batting, Nolan Pitton",
      voice_name = "Baseball Announcer Two",
      model_id = "eleven_multilingual_v2",
      stability = 0.35,
      similarity_boost = 0.95,
      style = 0.4,
      speed = 1.0,
      use_speaker_boost = true,
      output_format = "mp3_44100_128",
      output_directory = "<repo>/audio/announcements"
    )

The tool names its own output file, so rename the result to `{First}{Last}.mp3`.

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
