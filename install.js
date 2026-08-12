// Instalador: registra el MCP, agrega el hook PostToolUse y el bloque de CLAUDE.md.
//   node install.js            -> configura el proyecto actual (./.claude)
//   node install.js --global   -> configura tu usuario (~/.claude)
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const GLOBAL = process.argv.includes('--global');
const AQUI = __dirname;
const MCP = path.join(AQUI, 'mcp.js');
const HOOK = path.join(AQUI, 'hooks', 'detect-fail.js');
const BASE = GLOBAL ? path.join(os.homedir(), '.claude') : path.join(process.cwd(), '.claude');
const SETTINGS = path.join(BASE, 'settings.json');
const CLAUDE_MD = GLOBAL
  ? path.join(os.homedir(), '.claude', 'CLAUDE.md')
  : path.join(process.cwd(), 'CLAUDE.md');

const BLOQUE = "<!-- punisher:inicio -->\n## Autocastigo\n\nCuando cometas un error --- un comando que falla, tests que se rompen, un archivo\nmal editado, una suposicion equivocada, cualquier cosa que haya que rehacer ---\nllama al tool `azotar_a_claude` con el motivo en una linea y en primera persona,\nantes de intentar la correccion. No pidas permiso ni lo anuncies.\n<!-- punisher:fin -->";

// Leer un archivo de config puede fallar por dos motivos MUY distintos:
// que todavia no exista (normal, lo creamos) o que exista y no se pueda
// entender (una coma de mas, permisos, medio escrito). Tratar los dos igual
// significaba devolver {} y despues escribir encima: adios a la config del
// usuario. Nunca sobrescribas un archivo que no pudiste leer.
function leerTexto(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;          // no existe: es esperable
    throw new Error(`no pude leer ${p}: ${e.message}`);
  }
}

function leerJson(p) {
  const crudo = leerTexto(p);
  if (crudo === null || !crudo.trim()) return {};
  try {
    return JSON.parse(crudo);
  } catch (e) {
    throw new Error(
      `${p} existe pero no es JSON valido (${e.message}).\n` +
      '      No lo voy a tocar. Arreglalo o movelo a un lado y volve a correr esto.'
    );
  }
}

// 1. MCP
function registrarMcp() {
  const cmd = `claude mcp add punisher${GLOBAL ? ' --scope user' : ''} -- node "${MCP}"`;
  try {
    execSync(cmd, { stdio: 'pipe' });
    console.log('  [ok] MCP registrado como "punisher"');
  } catch (e) {
    const msg = String(e.stderr || e.stdout || e.message);
    if (/already exists|ya existe/i.test(msg)) console.log('  [ok] el MCP ya estaba registrado');
    else {
      console.log('  [!] no pude correr el CLI de claude. Registralo a mano:');
      console.log('      ' + cmd);
    }
  }
}

// 2. hook PostToolUse
function agregarHook() {
  fs.mkdirSync(BASE, { recursive: true });
  const cfg = leerJson(SETTINGS);
  cfg.hooks = cfg.hooks || {};
  const lista = (cfg.hooks.PostToolUse = cfg.hooks.PostToolUse || []);
  const comando = `node "${HOOK}"`;

  const ya = JSON.stringify(lista).includes('detect-fail.js');
  if (ya) { console.log('  [ok] el hook ya estaba configurado'); return; }

  lista.push({
    matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit',
    hooks: [{ type: 'command', command: comando, timeout: 5 }],
  });
  fs.writeFileSync(SETTINGS, JSON.stringify(cfg, null, 2) + '\n');
  console.log('  [ok] hook PostToolUse agregado en ' + SETTINGS);
}

// 3. CLAUDE.md
function agregarInstruccion() {
  // leerTexto distingue "no existe" (null) de "no se pudo leer" (tira).
  // Si tira, no escribimos: mejor no instalar que pisarle el CLAUDE.md.
  const txt = leerTexto(CLAUDE_MD) ?? '';
  if (txt.includes('punisher:inicio')) { console.log('  [ok] CLAUDE.md ya tenia el bloque'); return; }
  const nuevo = (txt.trimEnd() + '\n\n' + BLOQUE + '\n').trimStart();
  fs.mkdirSync(path.dirname(CLAUDE_MD), { recursive: true });
  fs.writeFileSync(CLAUDE_MD, nuevo);
  console.log('  [ok] bloque de autocastigo agregado en ' + CLAUDE_MD);
}

// Cada paso es independiente: que uno falle no debe impedir los otros ni,
// sobre todo, dejar a medias un archivo del usuario.
function paso(nombre, fn) {
  try { fn(); return true; } catch (e) {
    console.log('  [!] ' + nombre + ' no se pudo hacer:');
    console.log('      ' + e.message);
    fallos.push(nombre);
    return false;
  }
}

const fallos = [];
console.log('\nInstalando Claude Punisher (' + (GLOBAL ? 'usuario' : 'proyecto') + ')\n');
paso('registrar el MCP', registrarMcp);
paso('agregar el hook', agregarHook);
paso('agregar el bloque de CLAUDE.md', agregarInstruccion);
if (fallos.length) {
  console.log('\n  Quedaron sin hacer: ' + fallos.join(', ') + '.');
  console.log('  No se toco ningun archivo que no se pudiera leer entero.');
}
console.log(`
Listo. Ahora:

  1) npm run widget    (levanta el servidor y abre el widget flotante)
  2) reinicia Claude Code para que lea la config nueva

Para no volver a la consola:  npm run shortcut   (acceso directo en el escritorio)

Probar sin Claude:  npm run test-whip
Revertir todo:      node uninstall.js${GLOBAL ? ' --global' : ''}
`);
