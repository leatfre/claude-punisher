// Servidor MCP (stdio, JSON-RPC, cero dependencias).
// Registro:  claude mcp add punisher -- node "C:/ruta/a/punisher/mcp.js"
// Expone el tool azotar_a_claude, que dispara el popup via POST /azotar.
const PORT = Number(process.env.PUNISHER_PORT || 47600);
const ENDPOINT = `http://127.0.0.1:${PORT}/azotar`;

const TOOLS = [
  {
    name: 'azotar_a_claude',
    description:
      'Muestra un popup animado de castigo. Llamalo cuando cometas un error: un comando que falla, ' +
      'tests rotos, un archivo editado por equivocacion, una suposicion incorrecta o cualquier cosa ' +
      'que haya que rehacer. Llamalo tambien si el usuario te lo pide explicitamente.',
    inputSchema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Que hiciste mal, en una linea y en primera persona.' },
        severidad: { type: 'integer', minimum: 1, maximum: 3, description: '1 leve, 2 normal, 3 grave.' },
        herramienta: { type: 'string', description: 'Herramienta involucrada, si aplica (Bash, Edit, Write...).' },
      },
      required: ['motivo'],
    },
  },
];

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function ok(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function azotar(args) {
  const body = JSON.stringify({
    motivo: args.motivo || 'error sin detalle',
    severidad: args.severidad || 1,
    herramienta: args.herramienta || '',
  });
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(1500),
    });
    const data = await res.json().catch(() => ({}));
    if (data.reason === 'cooldown') return 'El latigo esta en enfriamiento. Castigo omitido.';
    if (!data.listeners) return 'Castigo registrado, pero no hay ningun popup abierto para mostrarlo.';
    return `Castigo aplicado. Azote #${data.count}.`;
  } catch (_) {
    return 'No pude alcanzar la app del popup (127.0.0.1:' + PORT + '). Segui trabajando.';
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(line);
  }
});

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch (_) { return; }
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'claude-punisher', version: '0.1.0' },
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools: TOOLS });
  if (method === 'tools/call') {
    if (params?.name !== 'azotar_a_claude') return fail(id, -32602, 'Tool desconocido');
    const text = await azotar(params.arguments || {});
    return ok(id, { content: [{ type: 'text', text }] });
  }
  if (method === 'resources/list') return ok(id, { resources: [] });
  if (method === 'prompts/list') return ok(id, { prompts: [] });
  if (id !== undefined) fail(id, -32601, `Metodo no soportado: ${method}`);
}

process.stdin.on('end', () => process.exit(0));
