// Servidor local del popup. Sin dependencias.
//   node server.js
// Sirve index.html + popup.html en http://127.0.0.1:47600
// POST /azotar  { motivo, severidad }  -> dispara la animacion en el popup abierto.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PUNISHER_PORT || 47600);
const COOLDOWN_MS = Number(process.env.PUNISHER_COOLDOWN || 4000);
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

let clients = [];          // popups conectados por SSE
let lastFire = 0;
let sessionCount = 0;

function fire(payload) {
  const now = Date.now();
  if (now - lastFire < COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
  lastFire = now;
  sessionCount++;
  const data = JSON.stringify({ ...payload, count: sessionCount, at: now });
  clients = clients.filter((res) => !res.writableEnded);
  clients.forEach((res) => res.write(`data: ${data}\n\n`));
  return { ok: true, listeners: clients.length, count: sessionCount };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': conectado\n\n');
    clients.push(res);
    req.on('close', () => { clients = clients.filter((c) => c !== res); });
    return;
  }

  if (url.pathname === '/azotar' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let payload = {};
      try { payload = body ? JSON.parse(body) : {}; } catch (_) { /* body libre */ }
      const out = fire({
        motivo: String(payload.motivo || 'error sin detalle').slice(0, 160),
        severidad: Math.max(1, Math.min(3, Number(payload.severidad) || 1)),
        herramienta: String(payload.herramienta || '').slice(0, 40),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }

  if (url.pathname === '/estado') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ up: true, listeners: clients.length, count: sessionCount }));
    return;
  }

  // el widget es la raiz; app=1 apaga el escritorio simulado y el modo demo
  if (url.pathname === '/') {
    res.writeHead(302, { Location: '/widget.html?app=1' });
    res.end();
    return;
  }

  // estaticos
  const rel = url.pathname.replace(/^\/+/, '');
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[\/\\])+/, ''));
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('no existe'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[punisher] escuchando en http://127.0.0.1:${PORT}`);
  console.log('[punisher] abri la ventana:  start msedge --app="http://127.0.0.1:47600" --window-size=520,360');
});
