// Crea un acceso directo en el escritorio que abre el widget de un doble click.
//   node shortcut.js             -> escritorio
//   node shortcut.js --startup   -> escritorio + arranque de sesion
//   node shortcut.js --remove    -> saca los dos
//   node shortcut.js --name "X"  -> con otro nombre, para convivir con otra copia
//
// El acceso directo apunta al binario de Electron, NO a "npm run widget": npm
// es un proceso de consola, asi que lanzarlo por ahi deja una ventana negra
// abierta al lado del widget. El binario de Electron es un ejecutable de
// subsistema grafico y no abre ninguna. Y no hace falta node en el PATH:
// desktop.js levanta el servidor con ELECTRON_RUN_AS_NODE.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const QUITAR = process.argv.includes('--remove');
const ARRANQUE = process.argv.includes('--startup');
const AQUI = __dirname;
const ENTRADA = path.join(AQUI, 'desktop.js');

// Dos copias del repo (una publica, una tuya) crearian el mismo acceso directo
// y se pisarian. --name las separa. Ojo: --remove necesita el mismo --name.
function nombrePedido() {
  const i = process.argv.indexOf('--name');
  const v = i >= 0 ? process.argv[i + 1] : null;
  return v && !v.startsWith('--') ? v : 'Claude Punisher';
}
const NOMBRE = nombrePedido();
const ID = NOMBRE.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'punisher';
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';

// ------------------------------------------------------------------ electron
// El paquete npm de electron exporta la ruta al binario cuando se lo requiere
// desde Node. path.txt es el respaldo por si algun dia cambia esa API.
function binarioElectron() {
  let ruta = null;
  try {
    const v = require('electron');
    if (typeof v === 'string') ruta = v;
  } catch (_) { /* probamos el respaldo */ }
  if (!ruta) {
    const base = path.join(AQUI, 'node_modules', 'electron');
    const txt = path.join(base, 'path.txt');
    if (fs.existsSync(txt)) ruta = path.join(base, 'dist', fs.readFileSync(txt, 'utf8').trim());
  }
  if (!ruta || !fs.existsSync(ruta)) {
    throw new Error('no encuentro Electron. Corre "npm install" en ' + AQUI);
  }
  return ruta;
}

// --------------------------------------------------------------- powershell
// Las rutas viajan por variables de entorno, no interpoladas en el script: asi
// un directorio con comillas o acentos no rompe nada ni inyecta comandos.
function ps(script, vars = {}) {
  return execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { env: { ...process.env, ...vars }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim();
}

// El escritorio no siempre es ~/Desktop: OneDrive lo redirige, y en Linux
// xdg-user-dir lo traduce al idioma del sistema.
function carpetaEscritorio() {
  if (WIN) return ps("[Environment]::GetFolderPath('Desktop')");
  if (!MAC) {
    try {
      const d = execFileSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' }).trim();
      if (d && fs.existsSync(d)) return d;
    } catch (_) { /* sin xdg-user-dir caemos al de siempre */ }
  }
  return path.join(os.homedir(), 'Desktop');
}

function carpetaArranque() {
  if (WIN) return ps("[Environment]::GetFolderPath('Startup')");
  if (MAC) return null;                                   // usa Items de Inicio
  return path.join(os.homedir(), '.config', 'autostart');
}

function borrar(p) {
  if (!p || !fs.existsSync(p)) return false;
  fs.rmSync(p, { recursive: true, force: true });
  return true;
}

// -------------------------------------------------------------------- windows
const PS_CREAR = `
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:PUNISHER_LNK)
$s.TargetPath = $env:PUNISHER_EXE
$s.Arguments = '"' + $env:PUNISHER_ARG + '"'
$s.WorkingDirectory = $env:PUNISHER_CWD
$s.Description = 'Widget de escritorio que azota a un personaje cuando tu agente se equivoca'
if (Test-Path $env:PUNISHER_ICO) { $s.IconLocation = $env:PUNISHER_ICO + ',0' }
$s.Save()
`;

function windows(destinos) {
  const exe = binarioElectron();
  for (const lnk of destinos) {
    fs.mkdirSync(path.dirname(lnk), { recursive: true });
    ps(PS_CREAR, {
      PUNISHER_LNK: lnk,
      PUNISHER_EXE: exe,
      PUNISHER_ARG: ENTRADA,
      PUNISHER_CWD: AQUI,
      PUNISHER_ICO: path.join(AQUI, 'avatar.ico'),
    });
    console.log('  [ok] ' + lnk);
  }
}

// ---------------------------------------------------------------------- mac
// Un .command en el escritorio tambien funciona, pero abre una ventana de
// Terminal que queda ahi mientras dure el widget. Un .app minimo (tres
// archivos, sin firmar) arranca limpio.
function bundleMac(destino) {
  const macos = path.join(destino, 'Contents', 'MacOS');
  fs.mkdirSync(macos, { recursive: true });
  fs.writeFileSync(
    path.join(destino, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${NOMBRE}</string>
  <key>CFBundleIdentifier</key><string>io.github.leatfre.${ID}</string>
  <key>CFBundleExecutable</key><string>${ID}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`
  );
  const guion = path.join(macos, ID);
  fs.writeFileSync(guion, `#!/bin/sh\ncd "${AQUI}"\nexec "${binarioElectron()}" "${ENTRADA}"\n`);
  fs.chmodSync(guion, 0o755);
  console.log('  [ok] ' + destino);
}

function itemDeInicio(app, agregar) {
  const script = agregar
    ? `tell application "System Events" to make login item at end with properties {path:"${app}", hidden:true}`
    : `tell application "System Events" to delete login item "${NOMBRE}"`;
  try {
    execFileSync('osascript', ['-e', script], { stdio: 'pipe' });
    console.log('  [ok] item de inicio ' + (agregar ? 'agregado' : 'sacado'));
  } catch (e) {
    console.log('  [!] no pude tocar los items de inicio (falta permiso de Automatizacion).');
    console.log('      Hacelo a mano: Ajustes > General > Items de inicio.');
  }
}

// -------------------------------------------------------------------- linux
function archivoDesktop() {
  return `[Desktop Entry]
Type=Application
Name=${NOMBRE}
Comment=Widget de escritorio que azota a un personaje cuando tu agente se equivoca
Exec="${binarioElectron()}" "${ENTRADA}"
Path=${AQUI}
Icon=${path.join(AQUI, 'avatar.png')}
Terminal=false
StartupNotify=false
Categories=Utility;
`;
}

function linux(destinos) {
  const contenido = archivoDesktop();
  for (const f of destinos) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, contenido);
    fs.chmodSync(f, 0o755);
    // GNOME ignora los .desktop del escritorio hasta que se los marca de confianza.
    try { execFileSync('gio', ['set', f, 'metadata::trusted', 'true'], { stdio: 'ignore' }); } catch (_) {}
    console.log('  [ok] ' + f);
  }
}

// --------------------------------------------------------------------- rutas
function rutas() {
  const esc = carpetaEscritorio();
  const arr = carpetaArranque();
  if (WIN) {
    return {
      escritorio: path.join(esc, NOMBRE + '.lnk'),
      arranque: arr ? path.join(arr, NOMBRE + '.lnk') : null,
    };
  }
  if (MAC) return { escritorio: path.join(esc, NOMBRE + '.app'), arranque: null };
  return {
    escritorio: path.join(esc, ID + '.desktop'),
    menu: path.join(os.homedir(), '.local', 'share', 'applications', ID + '.desktop'),
    arranque: arr ? path.join(arr, ID + '.desktop') : null,
  };
}

// ---------------------------------------------------------------------- main
function crear() {
  const r = rutas();
  const destinos = [r.escritorio];
  if (r.menu) destinos.push(r.menu);
  if (ARRANQUE && r.arranque) destinos.push(r.arranque);

  if (WIN) windows(destinos);
  else if (MAC) {
    bundleMac(r.escritorio);
    if (ARRANQUE) itemDeInicio(r.escritorio, true);
  } else linux(destinos);

  console.log(`
Listo. Doble click en "${NOMBRE}" en el escritorio y aparece el personaje.
No abre ninguna consola y el servidor lo levanta el widget solo.

Para sacarlo:  node shortcut.js --remove`);
  if (!ARRANQUE) console.log('Que arranque con la sesion:  node shortcut.js --startup');
}

function quitar() {
  const r = rutas();
  let n = 0;
  for (const p of [r.escritorio, r.menu, r.arranque]) {
    if (borrar(p)) { console.log('  [ok] borrado ' + p); n++; }
  }
  if (MAC) itemDeInicio(r.escritorio, false);
  console.log(n ? '\nListo, no queda nada.' : '\nNo habia nada que sacar.');
}

console.log(`\n${QUITAR ? 'Sacando' : 'Creando'} el acceso directo de Claude Punisher\n`);
try {
  if (QUITAR) quitar();
  else crear();
} catch (e) {
  console.log('  [!] ' + e.message);
  console.log('\n  Siempre te queda: npm run widget');
  process.exitCode = 1;
}
