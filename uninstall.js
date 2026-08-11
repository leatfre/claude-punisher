// Revierte lo que hizo install.js.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const GLOBAL = process.argv.includes('--global');
const BASE = GLOBAL ? path.join(os.homedir(), '.claude') : path.join(process.cwd(), '.claude');
const SETTINGS = path.join(BASE, 'settings.json');
const CLAUDE_MD = GLOBAL
  ? path.join(os.homedir(), '.claude', 'CLAUDE.md')
  : path.join(process.cwd(), 'CLAUDE.md');

try {
  execSync(`claude mcp remove punisher${GLOBAL ? ' --scope user' : ''}`, { stdio: 'pipe' });
  console.log('  [ok] MCP dado de baja');
} catch (_) {
  console.log('  [!] no pude dar de baja el MCP. A mano: claude mcp remove punisher');
}

try {
  const cfg = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  if (cfg.hooks?.PostToolUse) {
    cfg.hooks.PostToolUse = cfg.hooks.PostToolUse.filter(
      (e) => !JSON.stringify(e).includes('detect-fail.js')
    );
    if (!cfg.hooks.PostToolUse.length) delete cfg.hooks.PostToolUse;
    if (!Object.keys(cfg.hooks).length) delete cfg.hooks;
    fs.writeFileSync(SETTINGS, JSON.stringify(cfg, null, 2) + '\n');
    console.log('  [ok] hook removido de ' + SETTINGS);
  }
} catch (_) { console.log('  [-] sin settings.json que limpiar'); }

try {
  const txt = fs.readFileSync(CLAUDE_MD, 'utf8');
  const limpio = txt.replace(/<!-- punisher:inicio -->[\s\S]*?<!-- punisher:fin -->\n?/g, '').trimEnd();
  fs.writeFileSync(CLAUDE_MD, limpio ? limpio + '\n' : '');
  console.log('  [ok] bloque removido de CLAUDE.md');
} catch (_) { console.log('  [-] sin CLAUDE.md que limpiar'); }
