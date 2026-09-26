'use strict';

// hackAIthon finals: committee scoring and people's choice voting.
// No dependencies. Node 18 or later.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

const PORT = Number(process.env.PORT) || 8080;
const COMMITTEE_PIN = String(process.env.COMMITTEE_PIN || config.committeePin);
const ADMIN_PIN = String(process.env.ADMIN_PIN || config.adminPin);
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'data.json');

const CRITERIA = ['value', 'feasibility', 'risk', 'originality', 'presentation'];
const finalistIds = new Set(config.finalists.map(f => f.id));
const memberIds = new Set(config.committee.map(m => m.id));

// ---------------------------------------------------------------- storage

function emptyState() {
  return { votingOpen: false, votingClosed: false, scoringLocked: false, scores: {}, votes: {} };
}

function load() {
  try {
    return Object.assign(emptyState(), JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch (e) {
    return emptyState();
  }
}

let state = load();

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------------------------------------------------------------- helpers

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, headers));
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 16 * 1024) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function sha(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function pinMatches(given, expected) {
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Slow down PIN guessing: 15 wrong attempts per address per 10 minutes.
const failures = new Map();
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}
function blocked(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.first > 10 * 60 * 1000) { failures.delete(ip); return false; }
  return f.count >= 15;
}
function recordFailure(ip) {
  const f = failures.get(ip) || { count: 0, first: Date.now() };
  f.count += 1;
  failures.set(ip, f);
}

function requirePin(req, res, expected) {
  const ip = clientIp(req);
  if (blocked(ip)) { send(res, 429, { error: 'Too many wrong PIN attempts. Try again in 10 minutes.' }); return false; }
  if (!pinMatches(req.headers['x-pin'], expected)) {
    recordFailure(ip);
    send(res, 401, { error: 'That PIN is not right.' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- results

const round2 = n => Math.round(n * 100) / 100;

function entryFor(memberId, finalistId) {
  return ((state.scores[memberId] || {})[finalistId]) || {};
}

function scoredCount(entry) {
  return CRITERIA.filter(c => Number.isInteger(entry[c])).length;
}

function computeRanking() {
  const rows = config.finalists.map(f => {
    const complete = [];
    const memberTotals = {};
    config.committee.forEach(m => {
      const e = entryFor(m.id, f.id);
      if (scoredCount(e) === 5) {
        const t = CRITERIA.reduce((s, c) => s + e[c], 0);
        complete.push(e);
        memberTotals[m.id] = t;
      } else {
        memberTotals[m.id] = null;
      }
    });
    const avg = {};
    CRITERIA.forEach(c => {
      avg[c] = complete.length ? round2(complete.reduce((s, e) => s + e[c], 0) / complete.length) : null;
    });
    const totals = Object.values(memberTotals).filter(t => t !== null);
    const total = totals.length ? round2(totals.reduce((s, t) => s + t, 0) / totals.length) : null;
    return { id: f.id, title: f.title, presenter: f.presenter, avg, total, memberTotals, membersComplete: complete.length };
  });

  // Equal weights. Ties on total fall back to average value, then average feasibility.
  const scored = rows.filter(r => r.total !== null).sort((a, b) =>
    (b.total - a.total) || (b.avg.value - a.avg.value) || (b.avg.feasibility - a.avg.feasibility));
  const unscored = rows.filter(r => r.total === null);

  scored.forEach((r, i) => {
    r.rank = i + 1;
    r.tiedOnTotal = scored.some(o => o !== r && o.total === r.total);
    r.unresolvedTie = scored.some(o => o !== r && o.total === r.total &&
      o.avg.value === r.avg.value && o.avg.feasibility === r.avg.feasibility);
  });
  unscored.forEach(r => { r.rank = null; r.tiedOnTotal = false; r.unresolvedTie = false; });
  return scored.concat(unscored);
}

function computeVotes() {
  const counts = {};
  config.finalists.forEach(f => { counts[f.id] = 0; });
  Object.values(state.votes).forEach(v => { if (counts[v.f] !== undefined) counts[v.f] += 1; });
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const max = Math.max(0, ...Object.values(counts));
  const leaders = max > 0 ? Object.keys(counts).filter(id => counts[id] === max) : [];
  return { counts, total, leaders, tie: leaders.length > 1 };
}

function computeProgress() {
  const out = {};
  config.committee.forEach(m => {
    out[m.id] = {};
    config.finalists.forEach(f => { out[m.id][f.id] = scoredCount(entryFor(m.id, f.id)); });
  });
  return out;
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildCsv() {
  const lines = [];
  const row = arr => lines.push(arr.map(csvCell).join(','));
  row(['Committee scores']);
  row(['Finalist', 'Presenter', 'Member', 'Value', 'Feasibility', 'Risk', 'Originality', 'Presentation', 'Total out of 25', 'Comment']);
  config.finalists.forEach(f => {
    config.committee.forEach(m => {
      const e = entryFor(m.id, f.id);
      const complete = scoredCount(e) === 5;
      row([f.title, f.presenter, m.name].concat(CRITERIA.map(c => e[c] ?? ''),
        [complete ? CRITERIA.reduce((s, c) => s + e[c], 0) : '', e.comment || '']));
    });
  });
  row([]);
  row(['Committee ranking']);
  row(['Rank', 'Finalist', 'Presenter', 'Avg value', 'Avg feasibility', 'Avg risk', 'Avg originality', 'Avg presentation', 'Avg total out of 25', 'Members complete']);
  computeRanking().forEach(r => {
    row([r.rank ?? '', r.title, r.presenter].concat(CRITERIA.map(c => r.avg[c] ?? ''), [r.total ?? '', r.membersComplete]));
  });
  row([]);
  row(["People's choice"]);
  row(['Finalist', 'Votes']);
  const v = computeVotes();
  config.finalists.forEach(f => row([f.title, v.counts[f.id]]));
  row(['Total', v.total]);
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- static files

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const PAGES = { '/': 'vote.html', '/vote': 'vote.html', '/committee': 'committee.html', '/admin': 'admin.html' };

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
};

function serveStatic(req, res, pathname) {
  const rel = PAGES[pathname.replace(/\/+$/, '') || '/'] || pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Not found');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    const ext = path.extname(file);
    res.writeHead(200, Object.assign({
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300'
    }, SECURITY_HEADERS));
    res.end(buf);
  });
}

// ---------------------------------------------------------------- API

async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  // ---- public
  if (p === '/api/public' && m === 'GET') {
    return send(res, 200, {
      eventName: config.eventName,
      votingOpen: state.votingOpen,
      votingClosed: state.votingClosed,
      finalists: config.finalists.map(f => ({ id: f.id, title: f.title }))
    });
  }

  if (p === '/api/vote/status' && m === 'GET') {
    const token = cookies(req).pc_token || url.searchParams.get('token') || '';
    const v = token ? state.votes[sha(token)] : null;
    return send(res, 200, { votingOpen: state.votingOpen, votingClosed: state.votingClosed, voted: !!v, choice: v ? v.f : null });
  }

  if (p === '/api/vote' && m === 'POST') {
    const body = await readBody(req);
    const token = cookies(req).pc_token || String(body.token || '');
    if (!/^[a-f0-9]{32,64}$/.test(token)) return send(res, 400, { error: 'This phone could not be identified. Reload the page and try again.' });
    const key = sha(token);
    const cookie = `pc_token=${token}; Max-Age=2592000; Path=/; SameSite=Lax; HttpOnly`;
    if (state.votes[key]) return send(res, 409, { error: 'already_voted', choice: state.votes[key].f }, { 'Set-Cookie': cookie });
    if (!state.votingOpen) return send(res, 409, { error: 'Voting is not open.' });
    if (!finalistIds.has(body.finalistId)) return send(res, 400, { error: 'Choose one of the five ideas.' });
    state.votes[key] = { f: body.finalistId, at: Date.now() };
    save();
    return send(res, 200, { ok: true, choice: body.finalistId }, { 'Set-Cookie': cookie });
  }

  // ---- committee
  if (p === '/api/committee/login' && m === 'POST') {
    if (!requirePin(req, res, COMMITTEE_PIN)) return;
    return send(res, 200, { ok: true, eventName: config.eventName, committee: config.committee, finalists: config.finalists, locked: state.scoringLocked });
  }

  if (p === '/api/committee/state' && m === 'GET') {
    if (!requirePin(req, res, COMMITTEE_PIN)) return;
    const member = url.searchParams.get('member');
    if (!memberIds.has(member)) return send(res, 400, { error: 'Choose your name first.' });
    return send(res, 200, { locked: state.scoringLocked, scores: state.scores[member] || {} });
  }

  if ((p === '/api/committee/score' || p === '/api/committee/comment') && m === 'POST') {
    if (!requirePin(req, res, COMMITTEE_PIN)) return;
    const body = await readBody(req);
    if (!memberIds.has(body.member)) return send(res, 400, { error: 'Choose your name first.' });
    if (!finalistIds.has(body.finalist)) return send(res, 400, { error: 'Unknown finalist.' });
    if (state.scoringLocked) return send(res, 423, { error: 'Scoring is locked.' });
    state.scores[body.member] = state.scores[body.member] || {};
    const entry = state.scores[body.member][body.finalist] = state.scores[body.member][body.finalist] || {};
    if (p === '/api/committee/score') {
      if (!CRITERIA.includes(body.criterion)) return send(res, 400, { error: 'Unknown criterion.' });
      const val = body.value;
      if (val === null) delete entry[body.criterion];
      else if (Number.isInteger(val) && val >= 1 && val <= 5) entry[body.criterion] = val;
      else return send(res, 400, { error: 'Scores go from 1 to 5.' });
    } else {
      entry.comment = String(body.comment || '').slice(0, 1000);
    }
    entry.updatedAt = Date.now();
    save();
    return send(res, 200, { ok: true, entry });
  }

  // ---- admin
  if (p.startsWith('/api/admin/')) {
    if (!requirePin(req, res, ADMIN_PIN)) return;

    if (p === '/api/admin/state' && m === 'GET') {
      const comments = {};
      config.finalists.forEach(f => {
        comments[f.id] = config.committee
          .map(mb => ({ member: mb.name, comment: entryFor(mb.id, f.id).comment || '' }))
          .filter(c => c.comment);
      });
      return send(res, 200, {
        eventName: config.eventName,
        votingOpen: state.votingOpen,
        votingClosed: state.votingClosed,
        scoringLocked: state.scoringLocked,
        committee: config.committee,
        finalists: config.finalists,
        progress: computeProgress(),
        ranking: computeRanking(),
        votes: computeVotes(),
        comments
      });
    }

    if (p === '/api/admin/voting' && m === 'POST') {
      const body = await readBody(req);
      state.votingOpen = !!body.open;
      state.votingClosed = !body.open;
      save();
      return send(res, 200, { ok: true, votingOpen: state.votingOpen });
    }

    if (p === '/api/admin/lock' && m === 'POST') {
      const body = await readBody(req);
      state.scoringLocked = !!body.locked;
      save();
      return send(res, 200, { ok: true, scoringLocked: state.scoringLocked });
    }

    if (p === '/api/admin/reset' && m === 'POST') {
      const body = await readBody(req);
      if (body.confirm !== 'RESET') return send(res, 400, { error: 'Type RESET to confirm.' });
      if (body.scope === 'votes' || body.scope === 'all') state.votes = {};
      if (body.scope === 'scores' || body.scope === 'all') state.scores = {};
      if (body.scope === 'all' || body.scope === 'votes') { state.votingOpen = false; state.votingClosed = false; }
      if (body.scope === 'all') state.scoringLocked = false;
      save();
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/export' && m === 'GET') {
      return send(res, 200, buildCsv(), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="hackaithon-finals-results.csv"'
      });
    }
  }

  return send(res, 404, { error: 'Not found' });
}

// ---------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/healthz') return send(res, 200, 'ok');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    const msg = e.message === 'too_large' ? 'Request too large.' : e.message === 'bad_json' ? 'Invalid request.' : 'Something went wrong on the server.';
    if (!res.headersSent) send(res, 400, { error: msg });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`hackAIthon finals running on port ${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
  if (!process.env.ADMIN_PIN && config.adminPin === 'change-this-pin') {
    console.warn('Warning: the admin PIN is still the default. Set ADMIN_PIN or edit config.json before the event.');
  }
});
