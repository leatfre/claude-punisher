// Contenedor de escritorio (Windows / macOS / Linux).
// Electron solo aporta la ventana: transparente, sin marco, siempre encima,
// fuera de la barra de tareas y click-through. El widget que se renderiza
// adentro es el mismo widget.html que sirve server.js.
//
//   npm run widget
//
// La ventana cubre TODOS los monitores, no solo el principal: el arrastre del
// widget mueve al personaje DENTRO de la pagina (cambia left/top del root), asi
// que la ventana es el limite real por donde se lo puede pasear.
//
// El click-through NO se apoya en que Chromium reenvie mousemove a una ventana
// transparente: si eso falla, una ventana a pantalla completa se come todos los
// clicks del escritorio. Aca el proceso principal consulta la posicion del
// cursor y la compara contra el rectangulo que el preload le reporta.
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen,
        globalShortcut, shell } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PUNISHER_PORT || 47600);
const BASE = `http://127.0.0.1:${PORT}`;
const TAMANOS = [60, 80, 100, 125, 150, 200];
const LINUX = process.platform === 'linux';
const MAC = process.platform === 'darwin';

// En Linux la transparencia necesita un compositor Y este switch, y la ventana
// no puede crearse en el mismo tick que el ready. En Windows y macOS sobra.
if (LINUX) app.commandLine.appendSwitch('enable-transparent-visuals');

// Sin esto una app Electron sin empaquetar guarda en %APPDATA%\Electron o
// ~/Library/Application Support/Electron, carpetas compartidas con cualquier
// otra app en la misma situacion.
app.setName('claude-punisher');

// ------------------------------------------------------------------ idiomas
// El widget viene en ingles; el idioma se elige con click derecho.
const IDIOMAS = {
  en: { nombre: 'English',    zas: 'WHACK!', perdon: "Sorry, I'll get it right this time",
        azotar: 'Whip now', tamano: 'Size', recargar: 'Reload widget', salir: 'Quit', idioma: 'Language' },
  es: { nombre: 'Espanol',    zas: '¡ZAS!', perdon: 'Perdón, esta vez lo voy a hacer bien',
        azotar: 'Azotar ahora', tamano: 'Tamaño', recargar: 'Recargar widget', salir: 'Salir', idioma: 'Idioma' },
  pt: { nombre: 'Português', zas: 'PAH!', perdon: 'Desculpa, desta vez vou fazer certo',
        azotar: 'Chicotear agora', tamano: 'Tamanho', recargar: 'Recarregar widget', salir: 'Sair', idioma: 'Idioma' },
  fr: { nombre: 'Français', zas: 'VLAN!', perdon: 'Pardon, cette fois je vais bien faire',
        azotar: 'Fouetter', tamano: 'Taille', recargar: 'Recharger le widget', salir: 'Quitter', idioma: 'Langue' },
  de: { nombre: 'Deutsch',    zas: 'ZACK!', perdon: 'Sorry, diesmal mache ich es richtig',
        azotar: 'Jetzt peitschen', tamano: 'Größe', recargar: 'Widget neu laden', salir: 'Beenden', idioma: 'Sprache' },
  it: { nombre: 'Italiano',   zas: 'ZAC!', perdon: 'Scusa, stavolta lo faccio bene',
        azotar: 'Frusta ora', tamano: 'Dimensione', recargar: 'Ricarica widget', salir: 'Esci', idioma: 'Lingua' },
};
const POR_DEFECTO = 'en';

let win = null;
let tray = null;
let servidor = null;          // solo si lo levantamos nosotros
let zona = null;              // rectangulo del widget, en px CSS
let pasa = null;              // estado actual de click-through (null = sin aplicar)
let escala = 100;
let idioma = POR_DEFECTO;
const T = () => IDIOMAS[idioma] || IDIOMAS[POR_DEFECTO];

// ------------------------------------------------------------- preferencias
const CFG = () => path.join(app.getPath('userData'), 'punisher.json');
function leerCfg() {
  try { return JSON.parse(fs.readFileSync(CFG(), 'utf8')); } catch (_) { return {}; }
}
function guardarCfg(obj) {
  try {
    fs.mkdirSync(path.dirname(CFG()), { recursive: true });
    fs.writeFileSync(CFG(), JSON.stringify(obj, null, 2) + '\n');
  } catch (_) { /* preferencia perdida no es motivo para romper nada */ }
}

// ----------------------------------------------------------------- servidor
function pedir(ruta, metodo = 'GET', cuerpo = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: ruta, method: metodo, timeout: 1500,
        headers: cuerpo ? { 'content-type': 'application/json' } : {} },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve(b)); }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

async function estaVivo() {
  try { return JSON.parse(await pedir('/estado')).up === true; } catch (_) { return false; }
}

async function asegurarServidor() {
  if (await estaVivo()) { console.log('[punisher] reuso el servidor de ' + PORT); return; }
  // ELECTRON_RUN_AS_NODE hace que el propio binario de Electron corra como Node,
  // asi no hace falta tener node suelto en el PATH.
  servidor = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PUNISHER_PORT: String(PORT), ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (await estaVivo()) { console.log('[punisher] servidor levantado en ' + PORT); return; }
  }
  throw new Error('el servidor no respondio en ' + BASE);
}

const azotar = (motivo) =>
  pedir('/azotar', 'POST', JSON.stringify({ motivo, severidad: 2 })).catch(() => {});

// ------------------------------------------------------------ click-through
function dejarPasarClicks(on) {
  if (on === pasa || !win || win.isDestroyed()) return;
  pasa = on;
  win.setIgnoreMouseEvents(on, { forward: true });
}

function vigilarCursor() {
  if (!win || win.isDestroyed()) return;
  // sin zona reportada la ventana no captura nada: fallar hacia el lado seguro
  if (!zona) { dejarPasarClicks(true); return; }
  if (zona.agarrado) { dejarPasarClicks(false); return; }   // no soltar a media arrastrada
  const c = screen.getCursorScreenPoint();
  const b = win.getContentBounds();
  const dentro = c.x >= b.x + zona.x && c.x < b.x + zona.x + zona.w &&
                 c.y >= b.y + zona.y && c.y < b.y + zona.y + zona.h;
  dejarPasarClicks(!dentro);
}

// --------------------------------------------------------- todos los monitores
// El escritorio virtual: la caja que contiene TODAS las pantallas. Con esto el
// personaje se puede arrastrar de un monitor a otro. Ojo: en un arreglo en L
// pueden quedar zonas de la ventana sobre "vacio"; como es click-through y
// transparente, no molesta.
function escritorioVirtual() {
  const p = screen.getAllDisplays().map((d) => d.workArea);
  const x = Math.min(...p.map((a) => a.x));
  const y = Math.min(...p.map((a) => a.y));
  const x2 = Math.max(...p.map((a) => a.x + a.width));
  const y2 = Math.max(...p.map((a) => a.y + a.height));
  return { x, y, width: x2 - x, height: y2 - y };
}

// setResizable(false) fija el maximo al tamano actual, asi que para crecer hay
// que soltarlo primero. Ver el comentario en crearVentana.
function estirarSobreMonitores(b) {
  if (!win || win.isDestroyed()) return;
  win.setResizable(true);
  win.setBounds(b);
  win.setResizable(false);
}

function ajustarAMonitores() {
  if (!win || win.isDestroyed()) return;
  estirarSobreMonitores(escritorioVirtual());
}

// --------------------------------------------------------------------- menu
function aplicarEscala(v) {
  escala = v;
  guardarCfg({ ...leerCfg(), escala: v });
  if (win && !win.isDestroyed()) win.webContents.send('punisher:escala', v);
}

function aplicarIdioma(codigo) {
  idioma = IDIOMAS[codigo] ? codigo : POR_DEFECTO;
  guardarCfg({ ...leerCfg(), idioma });
  if (win && !win.isDestroyed()) win.webContents.send('punisher:idioma', T());
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(plantillaMenu()));
}

function plantillaMenu() {
  const t = T();
  return [
    { label: t.azotar, click: () => azotar('azote manual') },
    { type: 'separator' },
    {
      label: t.tamano,
      submenu: TAMANOS.map((v) => ({
        label: `${v}%`, type: 'radio', checked: escala === v, click: () => aplicarEscala(v),
      })),
    },
    {
      label: t.idioma,
      submenu: Object.entries(IDIOMAS).map(([codigo, v]) => ({
        label: v.nombre, type: 'radio', checked: idioma === codigo,
        click: () => aplicarIdioma(codigo),
      })),
    },
    { type: 'separator' },
    { label: t.recargar, click: () => win && !win.isDestroyed() && win.reload() },
    { label: t.salir, click: () => app.quit() },
  ];
}

// ------------------------------------------------------------------ ventana
function crearVentana() {
  const b = escritorioVirtual();

  // OJO: Windows recorta a UN monitor el tamano pedido en el constructor. Hay
  // que crear la ventana chica y agrandarla despues con setBounds, que no se
  // recorta. Medido sobre 4 monitores: al crear -> 2560x1080, con setBounds ->
  // 5569x2112. Si se pide en el constructor, el widget termina dibujado fuera
  // del viewport y no se ve en ninguna pantalla.
  win = new BrowserWindow({
    width: 800, height: 600,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: true,          // se fija en false recien despues de agrandarla
    movable: false,
    skipTaskbar: true,
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,     // sin esto la animacion se frena sin foco
    },
  });

  estirarSobreMonitores(b);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // La esquina de la ventana puede caer en el hueco entre monitores (un arreglo
  // en L deja zonas sin pantalla). Le pasamos al widget donde empieza el monitor
  // principal dentro de la ventana, para que arranque siempre visible.
  const p = screen.getPrimaryDisplay().workArea;
  win.loadURL(`${BASE}/widget.html?app=1&ox=${p.x - b.x}&oy=${p.y - b.y}`);

  win.once('ready-to-show', () => {
    win.show();
    // recien despues de show() los estilos extendidos quedan firmes
    pasa = null;
    dejarPasarClicks(true);
    setInterval(vigilarCursor, 80);

    // Diagnostico util: si el sistema recorta la ventana, el widget puede
    // quedar dibujado fuera del viewport y no verse en ningun monitor.
    const c = win.getContentBounds();
    console.log('[punisher] %d monitor(es) | pedido %dx%d en (%d,%d) | obtenido %dx%d en (%d,%d) | offset principal (%d,%d)',
                screen.getAllDisplays().length, b.width, b.height, b.x, b.y,
                c.width, c.height, c.x, c.y, p.x - b.x, p.y - b.y);
    if (c.width < b.width || c.height < b.height) {
      console.warn('[punisher] el sistema recorto la ventana: el widget se limita al area obtenida');
    }
  });

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('punisher:escala', escala);
    win.webContents.send('punisher:idioma', T());
  });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  // enchufar o desenchufar un monitor no deberia dejar al widget encerrado
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(ev, ajustarAMonitores);
  }
}

function crearBandeja() {
  // En algunos escritorios de Linux no hay bandeja: no es motivo para no arrancar.
  try {
    let icono = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    if (!icono.isEmpty()) icono = icono.resize({ width: MAC ? 16 : 20, height: MAC ? 16 : 20 });
    tray = new Tray(icono);
    tray.setToolTip('Claude Punisher');
    tray.setContextMenu(Menu.buildFromTemplate(plantillaMenu()));
    tray.on('double-click', () => azotar('azote manual desde la bandeja'));
  } catch (err) {
    console.warn('[punisher] sin bandeja del sistema: ' + err.message);
    console.warn('[punisher] para salir: Ctrl+Alt+Shift+P');
  }
}

// -------------------------------------------------------------------- ciclo
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  ipcMain.on('punisher:zona', (_e, z) => { zona = z; });
  ipcMain.on('punisher:menu', () => {
    if (win && !win.isDestroyed()) Menu.buildFromTemplate(plantillaMenu()).popup({ window: win });
  });

  app.whenReady().then(async () => {
    // es un widget, no una app: fuera del Dock de macOS
    if (MAC && app.dock) app.dock.hide();

    const cfg = leerCfg();
    escala = TAMANOS.includes(cfg.escala) ? cfg.escala : 100;
    idioma = IDIOMAS[cfg.idioma] ? cfg.idioma : POR_DEFECTO;

    try {
      await asegurarServidor();
    } catch (err) {
      console.error('[punisher] ' + err.message);
      app.quit();
      return;
    }

    if (LINUX) await new Promise((r) => setTimeout(r, 250));   // ver switch de arriba
    crearVentana();
    crearBandeja();

    for (const [combo, fn] of [['Control+Alt+P', () => azotar('azote manual por atajo')],
                               ['Control+Alt+Shift+P', () => app.quit()]]) {
      if (!globalShortcut.register(combo, fn)) console.warn('[punisher] atajo ocupado: ' + combo);
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (servidor) servidor.kill();
  });
}
