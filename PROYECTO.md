# Claude Punisher — descripción del proyecto

## Qué es

Un widget de escritorio para Windows que reacciona a los errores de un agente de IA que
trabaja en local. Cuando el agente falla, un personaje aparece en pantalla y recibe un
latigazo animado, con sonido. Es un dispositivo de feedback: convierte un error silencioso
del terminal en algo visible y físico en el escritorio.

No corrige nada, no bloquea nada, no interfiere con el trabajo del agente. Solo avisa.

## Arquitectura

    agente / claude code
        │
        ├─ MCP stdio ─────────> mcp.js ──────────────┐
        │  (autodenuncia)                            │
        ├─ hook PostToolUse ──> hooks/detect-fail.js ─┤  POST /azotar
        │  (deteccion automatica)                     │
        └─ manual ───────────> window.azotar() ───────┤
                                                      ▼
                                              server.js  (127.0.0.1:47600)
                                                      │  SSE /events
                                                      ▼
                                              widget.html  (personaje)

Tres disparadores, un solo destino. Node 18+, cero dependencias.

| Pieza | Rol |
|---|---|
| `server.js` | Servidor local. Recibe avisos, los reenvía al widget por SSE. Cooldown anti-spam de 4 s. |
| `widget.html` | El personaje. Transparente, arrastrable, un solo archivo offline. |
| `mcp.js` | Servidor MCP por stdio. Expone el tool `azotar_a_claude`. |
| `hooks/detect-fail.js` | Hook `PostToolUse`. Evalúa exit codes y patrones de error. |
| `install.js` | Configura las tres cosas de una vez. |

## Contrato de integración

Cualquier IA que corra en local puede engancharse. El único punto de entrada es un POST.

**Endpoint**

    POST http://127.0.0.1:47600/azotar
    Content-Type: application/json

    {
      "motivo": "exit code 1: npm test",   // string, una línea, máx 160 chars
      "severidad": 2,                       // 1 leve · 2 normal · 3 grave
      "herramienta": "Bash"                 // opcional
    }

**Respuestas**

    { "ok": true,  "listeners": 1, "count": 7 }        // latigazo mostrado
    { "ok": false, "reason": "cooldown" }              // muy seguido, omitido
    { "ok": true,  "listeners": 0 }                    // nadie mirando

**Estado**

    GET http://127.0.0.1:47600/estado
    { "up": true, "listeners": 1, "count": 7 }

Un `listeners: 0` significa que la ventana del widget está cerrada. No es un error y no
hay que reintentar.

## Cómo aplicarlo a una IA local

### Si es Claude Code

`node install.js --global` deja las tres vías configuradas. La detección real la hace el
hook; el MCP cubre los errores que ningún exit code ve.

### Si es otro agente (Cursor, Aider, un script propio, un agente casero)

Dos caminos, según cuánto control tengas sobre él.

**A. Envolver la ejecución de comandos.** Si el agente ejecuta shell a través de una
función tuya, agregale tres líneas después de cada comando:

```js
if (exitCode !== 0) {
  fetch('http://127.0.0.1:47600/azotar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ motivo: `exit code ${exitCode}: ${cmd.slice(0, 70)}`, severidad: 2 }),
  }).catch(() => {});
}
```

El `.catch()` vacío es obligatorio: si el widget no está corriendo, el agente no se tiene
que enterar.

**B. Darle el endpoint como herramienta.** Si el agente soporta MCP, registrá `mcp.js` y
listo. Si soporta tools propias, definí una con esta descripción — la redacción importa,
es lo que el modelo lee para decidir:

> Muestra un popup animado de castigo. Llamalo cuando cometas un error: un comando que
> falla, tests rotos, un archivo editado por equivocación, una suposición incorrecta o
> cualquier cosa que haya que rehacer. Llamalo también si el usuario te lo pide.

Y agregá esto a las instrucciones permanentes del agente:

> Cuando cometas un error, llamá a la herramienta de castigo con el motivo en una línea
> y en primera persona, antes de intentar la corrección. No pidas permiso ni lo anuncies.

## Lo que hay que tener claro

**La autodenuncia es probabilística.** Un tool MCP se ejecuta solo si el modelo decide
llamarlo. Justo cuando falla fuerte es cuando menos ganas tiene de dar un paso extra. Para
detección garantizada hace falta interceptar la ejecución desde afuera: el hook, o el
wrapper del punto A.

**El hook nunca puede bloquear al agente.** `detect-fail.js` sale siempre con código 0 y
no escribe en stdout, pase lo que pase. Un widget caído no debe frenar el trabajo.

**El cooldown existe por algo.** Cinco fallos en diez segundos son cinco latigazos
encimados. El default son 4 s, configurable con `PUNISHER_COOLDOWN` en ms.

**Solo escucha en 127.0.0.1.** No expongas el puerto. Es un endpoint sin autenticación que
dispara animaciones; en una red compartida es una molestia gratuita.

## Verificar que funciona

    npm run test-whip          # el camino completo, sin agente
    curl http://127.0.0.1:47600/estado

Si `test-azote` muestra el latigazo, el servidor y el widget están bien y cualquier
problema está del lado del agente.
