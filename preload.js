// Puente entre la pagina y el proceso principal.
//
// Responsabilidades, y ninguna mas:
//   1. contarle al principal DONDE esta el widget y si esta agarrado,
//      para que decida cuando la ventana deja pasar los clicks al escritorio;
//   2. desviar el click derecho al menu nativo, sin que dispare un azote;
//   3. aplicar la escala y el idioma elegidos.
//
// No dependemos de que Chromium reenvie mousemove a una ventana click-through:
// si eso falla, la ventana a pantalla completa se come todos los clicks.
const { ipcRenderer } = require('electron');

let agarrado = false;
let escala = 100;
let textos = null;
let ultimo = '';

const raiz = () => document.querySelector('[data-tauri-drag-region]');

function reportar() {
  const el = raiz();
  const r = el && el.getBoundingClientRect();
  if (!r || !r.width || !r.height) { ipcRenderer.send('punisher:zona', null); return; }
  // px CSS == DIP con zoom 1, que es lo que usa screen.getCursorScreenPoint().
  // getBoundingClientRect ya viene con la escala aplicada, asi que la zona
  // sensible sigue al tamano elegido sin cuentas extra.
  const z = { x: r.left, y: r.top, w: r.width, h: r.height, agarrado };
  const clave = JSON.stringify(z);
  if (clave === ultimo) return;
  ultimo = clave;
  ipcRenderer.send('punisher:zona', z);
}

function aplicarEscala() {
  const el = raiz();
  if (!el) return;
  const t = escala === 100 ? '' : `scale(${escala / 100})`;
  if (el.style.transform !== t) { el.style.transform = t; ultimo = ''; reportar(); }
  compensarBocadillo();
}

// El bocadillo se achica junto con todo el widget: a 60% sus 13px terminan
// siendo 7.8px en pantalla y no se lee. Le subimos la tipografia lo justo para
// que nunca baje de MINIMO px reales, y ensanchamos el globo en proporcion para
// que el texto no se parta en cuatro lineas.
// No se puede contra-escalar el globo entero: tick() ya le maneja el transform.
const BOC = { base: 13, ancho: 196, minimo: 11, anchoMax: 300 };
function compensarBocadillo() {
  const txt = document.querySelector('[data-i18n="perdon"]');
  const globo = txt && txt.parentElement;
  if (!globo) return;
  const f = Math.max(BOC.base, BOC.minimo / (escala / 100));
  const w = Math.min(BOC.anchoMax, Math.round(BOC.ancho * f / BOC.base));
  const fs = f.toFixed(1) + 'px';
  const ws = w + 'px';
  if (globo.style.fontSize !== fs) globo.style.fontSize = fs;
  if (globo.style.width !== ws) globo.style.width = ws;
}

// Los textos traducibles del widget llevan data-i18n="<clave>".
function aplicarTextos() {
  if (!textos) return;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const k = el.getAttribute('data-i18n');
    if (textos[k] != null && el.textContent !== textos[k]) el.textContent = textos[k];
  }
}

// Click derecho: menu nativo. Lo frenamos en fase de captura sobre window para
// que no llegue al onPointerDown del widget, que lo tomaria como un azote.
window.addEventListener('pointerdown', (e) => {
  if (e.button === 2) {
    e.preventDefault();
    e.stopPropagation();
    ipcRenderer.send('punisher:menu');
    return;
  }
  agarrado = true;
  reportar();
}, true);

window.addEventListener('pointerup', () => { agarrado = false; reportar(); }, true);
window.addEventListener('pointermove', reportar, true);
window.addEventListener('contextmenu', (e) => e.preventDefault(), true);

ipcRenderer.on('punisher:escala', (_e, v) => { escala = v; aplicarEscala(); });
ipcRenderer.on('punisher:idioma', (_e, t) => { textos = t; aplicarTextos(); });

window.addEventListener('DOMContentLoaded', () => {
  reportar();
  // el widget se mueve al arrastrarlo y React podria repintar el root:
  // reafirmamos escala, textos y zona con una cadencia baja
  setInterval(() => { aplicarEscala(); aplicarTextos(); reportar(); }, 200);
});
