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
VOICE_NAME = "Baseball Announcer Two"
MODEL_ID = "eleven_multilingual_v2"  # supports style exaggeration and speed
OUTPUT_FORMAT = "mp3_44100_128"
TEAM = "Bloordale"

# The dial positions from the ElevenLabs UI, as API values.
VOICE_SETTINGS = {
    "stability": 0.35,          # UI: Stability 35%
    "similarity_boost": 0.95,   # UI: Similarity 95%
    "style": 0.40,              # UI: Style Exaggeration 40%
    "speed": 1.0,               # UI: Speed 1
    "use_speaker_boost": True,
}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "audio", "announcements")


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


def phrase(first, last, number, with_numbers):
    name = "%s %s" % (first, last)
    if with_numbers:
        if number is None:
            sys.exit("--numbers needs a jersey number for %s" % name)
        return "Now batting for %s: number %s, %s!" % (TEAM, number, name)
    return "Now batting, %s" % name


def players_from_roster():
    with open(os.path.join(ROOT, "roster.json"), encoding="utf-8") as fh:
        roster = json.load(fh)
    return [(p["firstName"], p["lastName"], p.get("number")) for p in roster]


def players_from_names(names):
    out = []
    for raw in names:
        number = None
        if ":" in raw:
            number, raw = raw.split(":", 1)
            number = number.strip()
        parts = raw.strip().split()
        if len(parts) < 2:
            sys.exit("Need a first and last name, got %r" % raw)
        out.append((parts[0], " ".join(parts[1:]), number))
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
                    help='use the "Now batting for %s: number N, Name!" phrasing' % TEAM)
    ap.add_argument("--voice", default=VOICE_NAME, help="voice name (default: %s)" % VOICE_NAME)
    ap.add_argument("--key-file", default="~/.elevenlabs-key")
    ap.add_argument("--force", action="store_true", help="overwrite existing MP3s")
    ap.add_argument("--dry-run", action="store_true", help="print the lines, call nothing")
    args = ap.parse_args()

    players = players_from_names(args.names) if args.names else players_from_roster()
    lines = [(slug(f, l), phrase(f, l, n, args.numbers)) for f, l, n in players]

    if args.dry_run:
        for name, text in lines:
            print("%s.mp3  <-  %s" % (name, text))
        return

    key = load_key(args.key_file)
    voice_id = resolve_voice_id(key, args.voice)
    print("Voice %r -> %s (model %s)" % (args.voice, voice_id, MODEL_ID))
    os.makedirs(OUT_DIR, exist_ok=True)

    for name, text in lines:
        path = os.path.join(OUT_DIR, name + ".mp3")
        if os.path.exists(path) and not args.force:
            print("skip   %s.mp3 (exists; --force to replace)" % name)
            continue
        audio = synthesize(key, voice_id, text)
        with open(path, "wb") as fh:
            fh.write(audio)
        print("wrote  %s.mp3  %6d bytes  %s" % (name, len(audio), text))


if __name__ == "__main__":
    main()
