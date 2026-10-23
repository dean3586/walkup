// Stores the app's playback log.
//
// The app records what playback did on each phone (taps, when each sound
// started, load and play errors, launches, resets) and sends it here in
// batches. Each batch is committed as one file to the repo's `logs` branch,
// under logs/<date>/, so problems on other people's phones can be read
// afterwards. The branch is created from main the first time it is needed.
// Nothing on `logs` is deployed.
//
// Env: GITHUB_TOKEN (Contents: read and write), GITHUB_REPO.

const ALLOWED_ORIGINS = [
  'https://dean3586.github.io',
  'http://127.0.0.1:8777',
  'http://localhost:8777',
];

const BRANCH = 'logs';
const MAX_ENTRIES = 100;
const MAX_MESSAGE = 2000;

function github(path, init = {}) {
  return fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO || 'dean3586/walkup'}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'walkup-log',
      'Content-Type': 'application/json',
    },
  });
}

async function createBranch() {
  const main = await github('/git/ref/heads/main');
  if (!main.ok) return false;
  const { object } = await main.json();
  const res = await github('/git/refs', {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: object.sha }),
  });
  return res.ok || res.status === 422; // 422: another request created it first
}

function putFile(path, content, message) {
  return github(`/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), branch: BRANCH }),
  });
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
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Not an allowed origin' });
  }
  if (!process.env.GITHUB_TOKEN) return res.status(503).json({ error: 'no GITHUB_TOKEN' });

  const { device, entries } = req.body || {};
  if (typeof device !== 'string' || !/^[a-z0-9]{1,16}$/.test(device)) {
    return res.status(400).json({ error: 'Bad device' });
  }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ENTRIES) {
    return res.status(400).json({ error: 'Bad entries' });
  }
  const lines = [];
  for (const e of entries) {
    if (!e || typeof e.at !== 'string' || typeof e.message !== 'string') {
      return res.status(400).json({ error: 'Bad entry' });
    }
    lines.push(JSON.stringify({ at: e.at.slice(0, 40), message: e.message.slice(0, MAX_MESSAGE) }));
  }

  const now = new Date().toISOString();
  const path = `logs/${now.slice(0, 10)}/${now.slice(11, 19).replace(/:/g, '')}-${device}-`
    + `${Math.random().toString(36).slice(2, 6)}.jsonl`;
  const content = lines.join('\n') + '\n';
  const message = `Playback log from ${device} (${entries.length} entries)`;

  let put = await putFile(path, content, message);
  if (put.status === 404 || put.status === 422) {
    // The logs branch does not exist yet.
    if (await createBranch()) put = await putFile(path, content, message);
  }
  if (!put.ok) {
    return res.status(502).json({ error: `GitHub ${put.status}`, detail: (await put.text()).slice(0, 200) });
  }
  return res.status(200).json({ stored: path });
}
