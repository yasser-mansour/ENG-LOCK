// server.js — self-hosted Guess The Word game server
// Run with: npm install && npm start
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
// Set these as Config Vars on Heroku (or in a local .env) instead of editing code.
// Falls back to the old hardcoded defaults for local/offline use.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'itsme';
const DEFAULT_ACCESS_CODE = process.env.DEFAULT_ACCESS_CODE || 'guess123';

const DEFAULT_WORDS = ["ELEPHANT","GUITAR","VOLCANO","KEYBOARD","BUTTERFLY","TELESCOPE","PYRAMID","DOLPHIN",
  "SANDWICH","UMBRELLA","ROBOT","GALAXY","BICYCLE","CASTLE","PENGUIN","ORCHESTRA","VOLLEYBALL","LIGHTHOUSE",
  "AVOCADO","HELICOPTER","DINOSAUR","RAINBOW","TROPHY","MICROSCOPE"];

let config = { words: DEFAULT_WORDS.slice(), roundSeconds: 90, accessCode: DEFAULT_ACCESS_CODE, requiredCorrect: 3, hintIntervalSeconds: 10 };
let state = { active: false, word: null, startedAt: 0, roundId: null, correctGuessers: [], timedOut: false, manuallyEnded: false };
let chatLog = []; // { name, text, ts, correct, rank, points }
let scores = {};  // name -> score

const POINTS_BY_RANK = [10, 8, 7, 6, 5, 4, 3, 2]; // rank 1..8; rank 9+ all get 1
function pointsForRank(rank) { return POINTS_BY_RANK[rank - 1] !== undefined ? POINTS_BY_RANK[rank - 1] : 1; }

// --- static file server ---
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let reqPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, reqPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const clients = new Set(); // { ws, name, isControl, isWordViewer, joined }

function send(ws, obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const c of clients) if (c.joined && c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
}

function hashSeed(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }
function seededOrder(n, seed) {
  const arr = [...Array(n).keys()]; let s = seed || 1;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function computeMask(word, elapsedMs, roundId, hintIntervalSeconds) {
  const chars = word.split('');
  const letterIdx = chars.map((c, i) => /[A-Za-z0-9]/.test(c) ? i : -1).filter(i => i >= 0);
  if (letterIdx.length === 0) return word;
  const order = seededOrder(letterIdx.length, hashSeed(roundId || 'x'));
  const intervalMs = (hintIntervalSeconds || 10) * 1000;
  const revealCount = Math.min(Math.floor(elapsedMs / intervalMs), Math.max(letterIdx.length - 1, 0));
  const revealSet = new Set(order.slice(0, revealCount).map(k => letterIdx[k]));
  return chars.map((c, i) => /[A-Za-z0-9]/.test(c) ? (revealSet.has(i) ? c : '_') : ' ').join(' ');
}
function genId() { return 'r' + Date.now() + '_' + Math.floor(Math.random() * 1e6); }

function pickWord() {
  if (!config.words.length) return null;
  let pool = config.words;
  if (state.word) {
    const filtered = config.words.filter(w => w.toUpperCase() !== state.word.toUpperCase());
    if (filtered.length) pool = filtered;
  }
  return pool[Math.floor(Math.random() * pool.length)].trim().toUpperCase();
}

function startRound() {
  const word = pickWord();
  if (!word) return;
  state = { active: true, word, startedAt: Date.now(), roundId: genId(), roundSeconds: config.roundSeconds,
    hintIntervalSeconds: config.hintIntervalSeconds, correctGuessers: [], timedOut: false, manuallyEnded: false };
  broadcastState();
}
function endRound({ timedOut = false, manuallyEnded = false } = {}) {
  state = { ...state, active: false, timedOut, manuallyEnded, endedAt: Date.now() };
  broadcastState();
  // No automatic next round — the host starts each round manually now.
}
function broadcastState() {
  const elapsed = state.active ? Date.now() - state.startedAt : 0;
  broadcast({
    type: 'state',
    active: state.active,
    length: state.word ? state.word.replace(/[^A-Za-z0-9]/g, '').length : null,
    mask: state.word ? (state.active ? computeMask(state.word, elapsed, state.roundId, state.hintIntervalSeconds) : state.word.split('').join(' ')) : null,
    firstGuesser: state.correctGuessers[0] ? state.correctGuessers[0].name : null,
    correctCount: state.correctGuessers.length,
    correctNames: state.correctGuessers.map(g => g.name),
    requiredCorrect: config.requiredCorrect,
    timedOut: state.timedOut,
    manuallyEnded: state.manuallyEnded,
    roundId: state.roundId
  });
  sendControlStates();
}
function sendControlStates() {
  const elapsed = state.active ? Date.now() - state.startedAt : 0;
  const secondsLeft = state.active ? Math.max(0, Math.ceil((state.roundSeconds * 1000 - elapsed) / 1000)) : null;
  for (const c of clients) {
    if (c.joined && (c.isControl || c.isWordViewer)) send(c.ws, {
      type: 'control_state', active: state.active, word: state.word, secondsLeft,
      roundSeconds: config.roundSeconds, correctCount: state.correctGuessers.length,
      requiredCorrect: config.requiredCorrect, timedOut: state.timedOut, manuallyEnded: state.manuallyEnded
    });
  }
}
function broadcastChat() { broadcast({ type: 'chat', entries: chatLog.slice(-60) }); }
function broadcastScores() {
  const list = Object.entries(scores).map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score).slice(0, 30);
  broadcast({ type: 'scores', list });
}

// game tick: authoritative round timer, checked once per second server-side
setInterval(() => {
  if (state.active) {
    const elapsed = Date.now() - state.startedAt;
    if (elapsed >= state.roundSeconds * 1000) { endRound({ timedOut: true }); return; }
  }
  broadcastState();
}, 1000);

wss.on('connection', (ws) => {
  const meta = { ws, name: 'Player', isControl: false, isWordViewer: false, joined: false };
  clients.add(meta);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    // Joining the lobby: requires the current access code (unless it's been cleared to empty)
    if (msg.type === 'join') {
      if (config.accessCode && config.accessCode.length && msg.accessCode !== config.accessCode) {
        send(ws, { type: 'join_fail', reason: 'Incorrect access code.' });
        return;
      }
      meta.name = (msg.name || 'Player').toString().slice(0, 24).trim() || 'Player';
      meta.joined = true;
      send(ws, { type: 'join_ok' });
      send(ws, { type: 'chat', entries: chatLog.slice(-60) });
      send(ws, { type: 'scores', list: Object.entries(scores).map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score) });
      send(ws, { type: 'config', roundSeconds: config.roundSeconds, hintIntervalSeconds: config.hintIntervalSeconds });
      const elapsed = state.active ? Date.now() - state.startedAt : 0;
      send(ws, {
        type: 'state', active: state.active,
        length: state.word ? state.word.replace(/[^A-Za-z0-9]/g, '').length : null,
        mask: state.word ? (state.active ? computeMask(state.word, elapsed, state.roundId, state.hintIntervalSeconds) : state.word.split('').join(' ')) : null,
        firstGuesser: state.correctGuessers[0] ? state.correctGuessers[0].name : null,
        correctCount: state.correctGuessers.length, correctNames: state.correctGuessers.map(g => g.name),
        requiredCorrect: config.requiredCorrect,
        timedOut: state.timedOut, manuallyEnded: state.manuallyEnded, roundId: state.roundId
      });
      return;
    }

    if (!meta.joined) return; // ignore everything else until properly joined

    if (msg.type === 'message') {
      const text = (msg.text || '').toString().trim().slice(0, 120);
      if (!text) return;
      // Players who already guessed the word can't chat until the round ends
      // (stops them from leaking the answer or hints to everyone else).
      if (state.active && state.correctGuessers.some(g => g.name === meta.name)) {
        send(ws, { type: 'chat_blocked' });
        return;
      }
      const isMatch = state.active && state.word && text.toUpperCase() === state.word.toUpperCase();
      const alreadyGuessed = isMatch && state.correctGuessers.some(g => g.name === meta.name);

      if (isMatch && !alreadyGuessed) {
        const rank = state.correctGuessers.length + 1;
        const points = pointsForRank(rank);
        state.correctGuessers.push({ name: meta.name, rank, points });
        scores[meta.name] = (scores[meta.name] || 0) + points;
        chatLog.push({ name: meta.name, text, ts: Date.now(), correct: true, rank, points });
        if (chatLog.length > 300) chatLog = chatLog.slice(-200);
        broadcastChat();
        broadcastScores();
        if (state.correctGuessers.length >= config.requiredCorrect) {
          endRound({});
        } else {
          broadcastState();
        }
      } else {
        chatLog.push({ name: meta.name, text, ts: Date.now(), correct: false });
        if (chatLog.length > 300) chatLog = chatLog.slice(-200);
        broadcastChat();
      }
    } else if (msg.type === 'auth') {
      if (msg.password === ADMIN_PASSWORD) {
        if (msg.scope === 'word') meta.isWordViewer = true;
        else meta.isControl = true;
        send(ws, {
          type: 'auth_ok', scope: msg.scope || 'control', words: config.words, roundSeconds: config.roundSeconds,
          accessCode: config.accessCode, requiredCorrect: config.requiredCorrect, hintIntervalSeconds: config.hintIntervalSeconds
        });
        sendControlStates();
      } else {
        send(ws, { type: 'auth_fail' });
      }
    } else if (msg.type === 'start_round') {
      if ((meta.isControl || meta.isWordViewer) && !state.active) startRound();
    } else if (msg.type === 'reroll_word') {
      if (meta.isControl || meta.isWordViewer) startRound();
    } else if (msg.type === 'end_round_now') {
      if ((meta.isControl || meta.isWordViewer) && state.active) endRound({ manuallyEnded: true });
    } else if (msg.type === 'set_duration') {
      if (meta.isControl) {
        let secs = parseInt(msg.seconds, 10);
        if (!secs || secs < 20) secs = 20; if (secs > 600) secs = 600;
        config.roundSeconds = secs;
        broadcast({ type: 'config', roundSeconds: config.roundSeconds, hintIntervalSeconds: config.hintIntervalSeconds });
      }
    } else if (msg.type === 'set_hint_interval') {
      if (meta.isControl) {
        let secs = parseInt(msg.seconds, 10);
        if (!secs || secs < 3) secs = 3; if (secs > 60) secs = 60;
        config.hintIntervalSeconds = secs;
        broadcast({ type: 'config', roundSeconds: config.roundSeconds, hintIntervalSeconds: config.hintIntervalSeconds });
      }
    } else if (msg.type === 'set_required_correct') {
      if (meta.isControl) {
        let n = parseInt(msg.count, 10);
        if (!n || n < 1) n = 1; if (n > 25) n = 25;
        config.requiredCorrect = n;
        sendControlStates();
      }
    } else if (msg.type === 'set_words') {
      if (meta.isControl && Array.isArray(msg.words) && msg.words.length) {
        config.words = msg.words.map(w => w.toString().trim()).filter(Boolean);
      }
    } else if (msg.type === 'set_access_code') {
      if (meta.isControl) {
        config.accessCode = (msg.code || '').toString().trim().slice(0, 40);
      }
    } else if (msg.type === 'clear_chat') {
      if (meta.isControl) {
        chatLog = [];
        broadcastChat();
      }
    }
  });

  ws.on('close', () => clients.delete(meta));
});

server.listen(PORT, () => {
  console.log(`Guess The Word running at http://localhost:${PORT}`);
  console.log(`Admin/control password: ${ADMIN_PASSWORD}`);
  console.log(`Default access code for players: ${config.accessCode}`);
});
