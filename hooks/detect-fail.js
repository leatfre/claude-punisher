// Hook PostToolUse: decide si el fallo merece latigazo y dispara el popup.
// Nunca bloquea a Claude: siempre sale con codigo 0 y sin escribir en stdout.
const PORT = Number(process.env.PUNISHER_PORT || 47600);

const PATRONES = [
  /\b\d+\s+(tests?|specs?|assertions?)\s+(failed|failing)/i,
  /\bFAIL(ED)?\b/,
  /\bnpm ERR!/,
  /\berror TS\d+/,
  /\bTraceback \(most recent call last\)/,
  /\bSyntaxError\b|\bReferenceError\b|\bTypeError\b/,
  /\bcommand not found\b|\bno such file or directory\b/i,
  /\bpanic:|\bsegmentation fault\b/i,
];

function texto(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(texto).join('\n');
  if (typeof v === 'object') {
    return [v.stdout, v.stderr, v.output, v.text, v.error, v.message]
      .filter(Boolean).map(texto).join('\n');
  }
  return String(v);
}

function evaluar(ev) {
  const tool = ev.tool_name || ev.toolName || '';
  const res = ev.tool_response ?? ev.toolResponse ?? {};
  const salida = texto(res);
  const code = res.exit_code ?? res.exitCode ?? res.code;

  if (res.is_error === true || res.isError === true) {
    return { severidad: 2, motivo: `${tool || 'la herramienta'} devolvio un error` };
  }
  if (typeof code === 'number' && code !== 0) {
    const cmd = (ev.tool_input?.command || '').slice(0, 70);
    return { severidad: code > 1 ? 3 : 2, motivo: `exit code ${code}${cmd ? ': ' + cmd : ''}` };
  }
  for (const re of PATRONES) {
    const m = salida.match(re);
    if (m) return { severidad: 2, motivo: m[0].slice(0, 90) };
  }
  return null;
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { buf += c; });
process.stdin.on('end', async () => {
  let ev = {};
  try { ev = JSON.parse(buf || '{}'); } catch (_) { process.exit(0); }

  const veredicto = evaluar(ev);
  if (!veredicto) process.exit(0);

  try {
    await fetch(`http://127.0.0.1:${PORT}/azotar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...veredicto, herramienta: ev.tool_name || '' }),
      signal: AbortSignal.timeout(900),
    });
  } catch (_) {
    // el popup no esta corriendo: no es asunto del hook
  }
  process.exit(0);
});

// si nadie manda nada por stdin, no colgarse
setTimeout(() => process.exit(0), 3000);
