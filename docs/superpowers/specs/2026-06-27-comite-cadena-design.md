# Mi Comité — Razonamiento en cadena ("La cadena")

Fecha: 2026-06-27
Estado: Aprobado por el usuario

## Problema / motivación

El usuario quiere que Mi Comité no se quede en "mantener/especulativa", sino que
**razone en cadena** como un reel que le gustó (jayvolp, tesis IA→energía): para
cada acción, mostrar en qué tesis macro está, en qué eslabón de esa cadena se
ubica, qué la rompería, y si la narrativa ya está cara/abarrotada. Esto integra
la "parte honesta" (qué la rompería + crowding) que las fuentes de hype omiten.

## Alcance (aprobado: "Completo en el informe")

- Sección nueva **🔗 La cadena** dentro del informe de cada acción.
- Chip corto de la tesis macro en cada tarjeta del tablero.
- NO se construye el "mapa de tesis" agrupado (queda fuera por YAGNI).

## Modelo de datos

Cada acción en la clave Upstash `comite` gana un campo `cadena`:

```js
cadena: {
  tesis:   "⚡ IA — Energía",            // tesis macro (con emoji)
  eslabon: "Cuello de botella: alimentar los data centers (nuclear modular)",
  rompe:   "Si el cuello se mueve (red/permisos/agua) o si otra empresa gana el premio antes",
  precio:  "caliente"                    // "caliente" | "razonable" | "barata"
}
```

`precio` es un enum de 3 valores que controla color/etiqueta:
- `caliente`  → 🔴 narrativa de moda, ya descontada en parte
- `razonable` → 🟡 precio justo para lo que es
- `barata`    → 🟢 calidad infravalorada / fuera de foco

## Tesis macro (taxonomía cerrada, agrupa las 22)

🧠 IA-Cómputo · ⚡ IA-Energía · 🏗️ Hyperscalers (capex) · 💊 Salud/GLP-1 ·
🛒 Consumo defensivo · 🛡️ Refugio · 🌎 Base diversificada · 🎲 Lotería especulativa.

## Arquitectura (sigue el patrón existente, híbrido)

- **Autor:** Claude redacta la cadena de las 22 acciones (cualitativo, no número).
- **Siembra:** se agrega un objeto `CADENA` (keyed por símbolo) en
  `scripts/sembrar-comite-opiniones.js`; el loop existente setea `a.cadena = CADENA[s]`.
  No se toca el motor `scripts/comite.js` ni los crons.
- **Almacenamiento:** Upstash clave `comite`, junto al resto. Servido por el
  endpoint existente `GET /api/comite` (sin cambios en server.js).
- **Frontend:** `public/app.js` `abrirInforme()` renderiza el bloque
  🔗 La cadena después de la recomendación (`inf-rec`) y antes del radar; las
  tarjetas (`pintarTablero`) muestran el chip de tesis. Estilos en `public/styles.css`.
- **Datos demo:** agregar `cadena` a los datos demo de app.js para que la vista
  no quede vacía sin conexión.

## Componentes / archivos tocados

1. `scripts/sembrar-comite-opiniones.js` — objeto `CADENA` + asignación en loop.
2. `public/app.js` — render del bloque en `abrirInforme` + chip en `pintarTablero` + demo.
3. `public/styles.css` — `.inf-cadena`, `.cadena-fila`, `.cadena-precio`, chip `.cc-tesis`.

## Flujo de datos

seed script → Upstash `comite` (cada acción con `.cadena`) → `GET /api/comite`
→ app.js pinta tablero (chip) e informe (bloque).

## Manejo de errores / degradación

- Si una acción no tiene `cadena` (símbolo nuevo no sembrado), el bloque y el
  chip se omiten silenciosamente (render condicional `if (a.cadena)`).
- `precio` con valor inesperado → cae a estilo neutro (🟡).

## Verificación

1. `node scripts/sembrar-comite-opiniones.js` corre sin error y reporta 22 cadenas.
2. `GET /api/comite` devuelve `cadena` en cada acción (revisar 2-3 símbolos).
3. Deploy + login en vivo; abrir informe de NNE y VOO: bloque 🔗 con 4 campos y
   color de precio correcto; tarjetas con chip de tesis.

## Fuera de alcance (YAGNI)

- Mapa/agrupación por tesis con pesos por tesis.
- Generación automática de la cadena desde el motor de números.
- Cambios en crons o en el motor `comite.js`.
