#!/usr/bin/env python3
"""Generate walk-up announcement MP3s with the ElevenLabs text-to-speech API.

Writes one file per player to audio/announcements/<FirstLast>.mp3, matching the
naming the app expects in roster.json.

Examples:
  # every player in roster.json, name-only phrasing
  python tools/generate_announcements.py

  # once jersey numbers are assigned
  python tools/generate_announcements.py --numbers

  # specific players not yet in roster.json ("Name" or "Number:Name")
  python tools/generate_announcements.py --names "Nolan Pitton" "Charlie Mondoux"
  python tools/generate_announcements.py --numbers --names "5:Nolan Pitton"

  # pick up pronunciations typed into the app's Settings tab
  python tools/generate_announcements.py --from-cloud --force

  # audition a pronunciation respelling without touching the committed files
  python tools/generate_announcements.py --force --out-dir %TEMP%       --names "Charlie Mondoux=Charlie mon-DOO"

The API key is read from the ELEVENLABS_API_KEY environment variable, or from
the file named by --key-file (default: ~/.elevenlabs-key).
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.elevenlabs.io"
# The app syncs its settings, pronunciations included, to this Supabase row.
# Same URL and publishable key the app ships in app.js.
SYNC_URL = ("https://uijbrrvchglumgvleeoo.supabase.co/rest/v1/walkup_config"
            "?id=eq.default&select=data")
SYNC_KEY = "sb_publishable_Pq7c9QAC8ylL4toRZwrrSw_9Uu2MArL"
VOICE_NAME = "Baseball Voice Three"
MODEL_ID = "eleven_multilingual_v2"  # supports style exaggeration and speed
OUTPUT_FORMAT = "mp3_44100_128"

# The dial positions from the ElevenLabs UI, as API values.
VOICE_SETTINGS = {
    "stability": 0.90,          # UI: Stability 90%
    "similarity_boost": 1.0,    # UI: Similarity 100%
    "style": 0.15,              # UI: Style Exaggeration 15%
    "speed": 0.9,               # UI: Speed 0.9
    "use_speaker_boost": True,
}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "audio", "announcements")

# A player in roster.json may carry a "pronunciation": the spoken form of their
# full name, respelled so the announcer stresses the right syllables — e.g.
# "Charlie mon-DOO". eleven_multilingual_v2 has no phoneme tag support (that is
# eleven_flash_v2 only), so respelling with capitals and hyphens is the lever.
# It changes only what is spoken; the displayed name and the filename still come
# from firstName/lastName.


def load_key(key_file):
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if key:
        return key
    path = os.path.expanduser(key_file)
    if os.path.exists(path):
        with open(path) as fh:
            return fh.read().strip()
    sys.exit(
        "No API key. Set ELEVENLABS_API_KEY or put the key in %s" % path
    )


def request(url, key, data=None, accept="application/json"):
    req = urllib.request.Request(url, data=data)
    req.add_header("xi-api-key", key)
    req.add_header("Accept", accept)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:500]
        sys.exit("ElevenLabs API error %s on %s\n%s" % (e.code, url, body))


def resolve_voice_id(key, name):
    """Look up a voice by exact name (case-insensitive) in the account."""
    url = "%s/v2/voices?%s" % (
        API,
        urllib.parse.urlencode({"search": name, "page_size": 100}),
    )
    voices = json.loads(request(url, key)).get("voices", [])
    for v in voices:
        if v.get("name", "").strip().lower() == name.strip().lower():
            return v["voice_id"]
    if voices:
        found = ", ".join(repr(v.get("name")) for v in voices)
        sys.exit("No voice named %r. Close matches: %s" % (name, found))
    sys.exit("No voice named %r in this account." % name)


def slug(first, last):
    """CarterBelvedere, MarkOShea — the filename convention in roster.json."""
    return re.sub(r"[^A-Za-z0-9]", "", first + last)


def phrase(first, last, number, with_numbers, spoken=None):
    name = spoken or "%s %s" % (first, last)
    if with_numbers:
        if number is None:
            sys.exit("--numbers needs a jersey number for %s %s" % (first, last))
        return "Now batting ... number %s ... %s!" % (number, name)
    return "Now batting ... %s!" % name


def show_history(key, limit):
    """Recent generations on the account: which voice actually spoke each line."""
    url = "%s/v1/history?%s" % (API, urllib.parse.urlencode({"page_size": limit}))
    items = json.loads(request(url, key)).get("history", [])
    if not items:
        print("No history returned.")
        return
    print("%-20s  %-24s  %s" % ("when", "voice", "text"))
    import datetime
    for it in items:
        when = datetime.datetime.fromtimestamp(
            it.get("date_unix", 0)).strftime("%Y-%m-%d %H:%M:%S")
        print("%-20s  %-24s  %s" % (
            when,
            "%s" % it.get("voice_name", "?"),
            (it.get("text") or "").strip()[:60],
        ))


def cloud_pronunciations():
    """Reads the pronunciations people typed into the app's Settings tab."""
    req = urllib.request.Request(SYNC_URL)
    req.add_header("apikey", SYNC_KEY)
    req.add_header("Authorization", "Bearer " + SYNC_KEY)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            rows = json.loads(resp.read())
    except (urllib.error.URLError, ValueError) as e:
        sys.exit("Could not read the synced config: %s" % e)
    data = (rows[0].get("data") or {}) if rows else {}
    return {str(k): v for k, v in (data.get("pronunciations") or {}).items()}


def players_from_roster():
    with open(os.path.join(ROOT, "roster.json"), encoding="utf-8") as fh:
        roster = json.load(fh)
    # "jersey" is the shirt number; "number" is the internal id used as a
    # placeholder until a jersey is assigned.
    return [(p["firstName"], p["lastName"], p.get("jersey") or p.get("number"),
             p.get("pronunciation")) for p in roster]


def players_from_names(names):
    """Parses "[Number:]Name[=Pronunciation]" arguments."""
    out = []
    for raw in names:
        number = spoken = None
        if ":" in raw:
            number, raw = raw.split(":", 1)
            number = number.strip()
        if "=" in raw:
            raw, spoken = raw.split("=", 1)
            spoken = spoken.strip()
        parts = raw.strip().split()
        if len(parts) < 2:
            sys.exit("Need a first and last name, got %r" % raw)
        out.append((parts[0], " ".join(parts[1:]), number, spoken))
    return out


def synthesize(key, voice_id, text):
    url = "%s/v1/text-to-speech/%s?%s" % (
        API, voice_id, urllib.parse.urlencode({"output_format": OUTPUT_FORMAT})
    )
    body = json.dumps({
        "text": text,
        "model_id": MODEL_ID,
        "voice_settings": VOICE_SETTINGS,
    }).encode("utf-8")
    return request(url, key, data=body, accept="audio/mpeg")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--names", nargs="+", metavar='"[Number:]Name"',
                    help="players to generate instead of reading roster.json")
    ap.add_argument("--numbers", action="store_true",
                    help='use the "Now batting ... number N ... Name!" phrasing')
    ap.add_argument("--voice", default=VOICE_NAME, help="voice name (default: %s)" % VOICE_NAME)
    ap.add_argument("--key-file", default="~/.elevenlabs-key")
    ap.add_argument("--force", action="store_true", help="overwrite existing MP3s")
    ap.add_argument("--dry-run", action="store_true", help="print the lines, call nothing")
    ap.add_argument("--out-dir", default=OUT_DIR,
                    help="where to write the MP3s (default: audio/announcements)")
    ap.add_argument("--history", nargs="?", type=int, const=15, metavar="N",
                    help="list the last N generations with the voice used, then exit")
    ap.add_argument("--from-cloud", action="store_true",
                    help="take pronunciations from the app's synced settings, "
                         "overriding roster.json")
    args = ap.parse_args()

    if args.history:
        show_history(load_key(args.key_file), args.history)
        return

    players = players_from_names(args.names) if args.names else players_from_roster()

    if args.from_cloud:
        cloud = cloud_pronunciations()
        players = [(f, l, n, cloud.get(str(n), sp)) for f, l, n, sp in players]
        for f, l, n, sp in players:
            if cloud.get(str(n)):
                print("cloud  #%s %s %s -> %r" % (n, f, l, sp))
    lines = [(slug(f, l), phrase(f, l, n, args.numbers, sp)) for f, l, n, sp in players]

    if args.dry_run:
        for name, text in lines:
            print("%s.mp3  <-  %s" % (name, text))
        return

    key = load_key(args.key_file)
    voice_id = resolve_voice_id(key, args.voice)
    print("Voice %r -> %s (model %s)" % (args.voice, voice_id, MODEL_ID))
    out_dir = os.path.expandvars(os.path.expanduser(args.out_dir))
    os.makedirs(out_dir, exist_ok=True)

    for name, text in lines:
        path = os.path.join(out_dir, name + ".mp3")
        if os.path.exists(path) and not args.force:
            print("skip   %s.mp3 (exists; --force to replace)" % name)
            continue
        audio = synthesize(key, voice_id, text)
        with open(path, "wb") as fh:
            fh.write(audio)
        print("wrote  %s.mp3  %6d bytes  %s" % (name, len(audio), text))


if __name__ == "__main__":
    main()
