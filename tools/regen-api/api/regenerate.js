// Re-records one player's walk-up announcement.
//
// The app is a static site, so the ElevenLabs key cannot live in it. This
// function holds the key, checks a passcode, and returns the audio. Deployed
// separately from GitHub Pages; see tools/regen-api/README.md.
//
// Env: ELEVENLABS_API_KEY, REGEN_PASSCODE, ELEVEN_VOICE_ID (optional),
//      GITHUB_TOKEN + GITHUB_REPO (optional — commits the result when set).

const MODEL_ID = 'eleven_v3';
// The app offers these by key. Anything else falls back to the default, so a
// request cannot name an arbitrary voice.
const VOICES = {
  four: 'ymICdMZoQRE2xrJTPSjR',  // Baseball Voice Four
  three: 'dhlnEOuE4v7Hy8nuusjU', // Baseball Voice Three
};
const DEFAULT_VOICE_ID = process.env.ELEVEN_VOICE_ID || VOICES.four;

// Same dial positions as tools/generate_announcements.py. Change one, change
// the other, or a re-record stops matching the committed files.
const VOICE_SETTINGS = {
  stability: 0.5, // v3 accepts only 0.0, 0.5 or 1.0
  similarity_boost: 0.8,
  style: 0, // above 0 adds a trailing "s" to most takes
  speed: 1.0,
  use_speaker_boost: true,
};

const ALLOWED_ORIGINS = [
  'https://dean3586.github.io',
  'http://127.0.0.1:8777',
  'http://localhost:8777',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slug(first, last) {
  return (first + last).replace(/[^A-Za-z0-9]/g, '');
}

function phrase({ firstName, lastName, pronunciation, jersey, withNumbers }) {
  const name = (pronunciation || `${firstName} ${lastName}`).trim();
  // Ends on a period, not an exclamation: the bang made the voice release the
  // final consonant with a flourish that came out as a hiss on names ending
  // in n. The ellipses stay — they are the pauses that build the crescendo.
  if (withNumbers && jersey != null && jersey !== '') {
    return `Now batting ... number ${jersey} ... ${name}. [pause]`;
  }
  return `Now batting ... ${name}. [pause]`;
}

async function commitToGitHub(path, base64, message) {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!token || !repo) return { committed: false, reason: 'no GITHUB_TOKEN' };

  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'walkup-regen',
  };

  let sha;
  const existing = await fetch(`${url}?ref=main`, { headers });
  if (existing.ok) sha = (await existing.json()).sha;

  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: base64, branch: 'main', sha }),
  });
  if (!res.ok) {
    return { committed: false, reason: `GitHub ${res.status}: ${(await res.text()).slice(0, 200)}` };
  }
  return { committed: true };
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  // Browsers send Origin on cross-site POSTs; a missing or foreign one is not
  // this app. It does not stop a forged request, it stops the casual ones.
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Not an allowed origin' });
  }

  const body = req.body || {};
  const { passcode, firstName, lastName, pronunciation, jersey, withNumbers, voice } = body;
  const voiceId = Object.hasOwn(VOICES, voice) ? VOICES[voice] : DEFAULT_VOICE_ID;

  if (!process.env.REGEN_PASSCODE || passcode !== process.env.REGEN_PASSCODE) {
    await sleep(1500); // slow down guessing
    return res.status(401).json({ error: 'Wrong passcode' });
  }
  // The app unlocks Settings by asking here, so the passcode never ships in
  // app.js. Answering costs no credits.
  if (body.check) return res.status(200).json({ ok: true });
  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'firstName and lastName are required' });
  }
  if (pronunciation && String(pronunciation).length > 80) {
    return res.status(400).json({ error: 'Pronunciation is too long' });
  }

  const text = phrase({ firstName, lastName, pronunciation, jersey, withNumbers });

  const tts = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
    }
  );

  if (!tts.ok) {
    const detail = (await tts.text()).slice(0, 300);
    return res.status(502).json({ error: `ElevenLabs ${tts.status}`, detail });
  }

  const audio = Buffer.from(await tts.arrayBuffer());
  const base64 = audio.toString('base64');
  const file = `${slug(firstName, lastName)}.mp3`;

  const commit = await commitToGitHub(
    `audio/announcements/${file}`,
    base64,
    `Re-record ${firstName} ${lastName}'s announcement\n\nSpoken as: ${text}\nVoice: ${voiceId}`
  );

  return res.status(200).json({ file, text, audio: base64, ...commit });
}
