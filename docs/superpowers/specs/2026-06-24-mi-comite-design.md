# Diseño — "Mi Comité" (dashboard de análisis por acción)

**Fecha:** 2026-06-24 · **Estado:** aprobado por el usuario (luz verde al diseño)

## Objetivo

Una vista nueva dentro del panel actual ("Mi Cartera") que **analiza a fondo cada acción del usuario**, como un comité de 8 analistas especializados + un Director que sintetiza. Dinámica, visual y fácil para una persona NO técnica (Lima, Perú, español). Es **análisis honesto, no asesoría licenciada**; nunca ejecuta operaciones.

## Decisiones del brainstorming

1. **Frescura híbrida (gratis):** los analistas de números se refrescan solos por cron; los de opinión los genera Claude bajo demanda (el usuario dice "re-analiza"). Costo $0/mes.
2. **Vive dentro del panel actual:** una vista nueva (botón "🏛️ Mi Comité"), mismo login, mismo deploy, misma piel dark glass. NO es una app separada.
3. **Las 8 áreas en el informe:** gráfico de araña (radar) arriba + barras con puntaje debajo.

## Arquitectura

Dos motores que escriben a una sola clave Upstash `comite`; el front solo pinta.

### Motor de números (automático, gratis) — `scripts/comite.js`
Corre en GitHub Actions (cron, junto a los otros robots) y también on-demand. Lee la clave `cartera` de Upstash (símbolos dinámicos — si cambia la cartera, el comité se ajusta), y para cada símbolo baja de Yahoo (`chart?range=1y` + `quoteSummary` módulos `price,summaryDetail,defaultKeyStatistics,financialData,calendarEvents`). Calcula 4 analistas cuantitativos y deja sus puntajes en `comite`. No toca los campos de opinión existentes (merge, no overwrite).

### Motor de opinión (Claude, gratis, bajo demanda)
Cuando el usuario pide "re-analiza X" / "re-analiza todo", Claude (en el chat) genera los 4 analistas cualitativos + el Director y los escribe a `comite` (GET → merge → SET, preservando los números). 🏛️ Políticos queda `estado:'inactivo'` mientras no haya fuente de datos.

## Los 8 analistas

Cada analista devuelve `{ puntaje: 0–100, senal: 'positiva'|'neutra'|'negativa', veredicto: <frase corta>, razones: [2–3 strings], fuente: 'datos'|'claude' }`.

**Cuantitativos (motor de números, `fuente:'datos'`):**
1. 🔍 **Valuación** — acción: forwardPE / trailingPE / priceToSales vs referencia del sector (más barato → mayor puntaje); ETF: expense ratio + posición del precio en su rango de 52 semanas.
2. 🛡️ **Riesgo** — volatilidad anualizada (de `chart` 1y), beta, peor caída (max drawdown 1y), deuda (debtToEquity). Menos riesgo → mayor puntaje. Las especulativas salen bajas a propósito.
3. 📈 **Técnico** — precio vs SMA50/SMA200 (cruce dorado/muerte), momentum 3 meses, distancia a máximos/mínimos. Sobre las medias + momentum positivo → mayor puntaje.
4. 💵 **Dividendos** — dividendYield, crecimiento, payout (sostenibilidad). Sin dividendo → puntaje bajo en esta lente (no penaliza la tesis de crecimiento, solo refleja la óptica de ingresos).

**Cualitativos (motor de opinión de Claude, `fuente:'claude'`):**
5. 🏰 **Moat / Negocio** — ventaja competitiva, márgenes, durabilidad. (ETF: calidad y diversificación del fondo.)
6. 🌎 **Macro** — cómo le pegan tasas, inflación, ciclo y su sector.
7. 📰 **Catalizadores / Noticias** — próximos earnings (de `calendarEvents`), fechas FDA (moonshots tipo VRDN), titulares recientes. Si no hay fuente de noticias, lo dice.
8. 🏛️ **Políticos e Insiders (STOCK Act)** — `estado:'inactivo'`, `veredicto:'Sin datos — la fuente pública gratis se cerró; necesita API de pago'`. Se activa el día que haya fuente.

## Director y puntaje compuesto

El Director combina los analistas en un compuesto 0–100 con pesos (más peso a fundamentales que a técnico):

| Área | Peso |
|---|---|
| Moat | 20% |
| Valuación | 18% |
| Riesgo | 15% |
| Macro | 12% |
| Catalizadores | 10% |
| Técnico | 10% |
| Dividendos | 8% |
| Políticos | 7% |

Cuando un analista no tiene dato (ej: Políticos inactivo, o aún sin opinión de Claude), su peso se **redistribuye proporcionalmente** entre los presentes. El Director produce: `{ puntaje, veredicto, tesis, riesgoPrincipal, confianza }`.

Veredicto en palabras + color: `≥75` verde "Comprar en caídas / Mantener fuerte"; `55–74` verde/ámbar "Mantener"; `40–54` ámbar "Mantener · vigilar / Reducir"; `<40` rojo "Especulativa / Riesgo alto". El mapeo exacto de frase lo decide el Director con su criterio, dentro de estos rangos de color.

## Adaptación para ETFs

Detectar `tipoActivo` desde `quoteSummary.price.quoteType` (`ETF` vs `EQUITY`). Para ETFs: Valuación → costo (expense ratio) + precio vs rango; Moat → calidad/diversificación del fondo; Dividendos → yield del fondo; el lenguaje del Director lo refleja ("este es un fondo, no una empresa").

## Modelo de datos (Upstash `comite`)

```json
{
  "generado": "ISO — último motor de números",
  "opinionGenerada": "ISO — última opinión de Claude",
  "acciones": {
    "NVDA": {
      "simbolo": "NVDA", "nombre": "NVIDIA", "tipoActivo": "accion",
      "precio": 201.0,
      "analistas": {
        "valuacion": { "puntaje": 60, "senal": "neutra", "veredicto": "...", "razones": ["..."], "fuente": "datos" },
        "riesgo": {}, "tecnico": {}, "dividendos": {},
        "moat": { "puntaje": 95, "senal": "positiva", "veredicto": "...", "razones": ["..."], "fuente": "claude" },
        "macro": {}, "catalizadores": {},
        "politicos": { "estado": "inactivo", "veredicto": "Sin datos — necesita API" }
      },
      "director": { "puntaje": 82, "veredicto": "Mantener y comprar en caídas", "tesis": "...", "riesgoPrincipal": "...", "confianza": 68 },
      "actualizado": "ISO"
    }
  }
}
```

## UI (3 vistas)

- **Botón "🏛️ Mi Comité"** en la cabecera del panel → cambia a la vista del comité (las dos conviven en el mismo `index.html`/`app.js`, toggle de vistas; no recarga).
- **Vista 1 — Tablero:** grid de tarjetas (una por acción) con puntaje compuesto, barra de color y veredicto en una palabra. Ordenable (puntaje / riesgo / alfabético) y buscador. Botón "🔄 Re-analizar" (dispara el motor de números; para opiniones, indica "pídeselo a Claude en el chat").
- **Vista 2 — Informe:** al tocar una tarjeta → banner con veredicto del Director + compuesto + confianza; **radar de las 8 áreas** + **barras** con puntaje por analista; gráfico de precio (reusa el modal de gráfico existente); cada analista expandible ("¿por qué?") con sus razones. Sello de honestidad al pie.
- **Vista 3 — Comparar:** elegir 2 acciones → radares/barras lado a lado.
- **Tour** de primer uso explicando cada parte en lenguaje simple. **Responsive** (tarjetas apiladas en celular).

## Endpoints del servidor

- `GET /api/comite` → devuelve la clave `comite` (todas las acciones) — detrás del mismo login.
- `POST /api/comite/reanalizar` → dispara el motor de números (recalcula los cuantitativos y guarda). Las opiniones las sigue generando Claude por el chat.

## Actualización (cron)

Nuevo workflow `.github/workflows/comite.yml` (o se engancha al de proyección) que corre `scripts/comite.js` cada 1–2 días con los secrets UPSTASH_* existentes. Las opiniones de Claude no van en cron (las genera el usuario pidiéndolas).

## Reglas de honestidad

- Sello "Análisis probabilístico, no asesoría financiera licenciada" en cada informe.
- Probabilidades reales; si falta un dato, se dice (no se inventa).
- Políticos: "sin datos" hasta tener fuente.
- Moonshots (VRDN, RDW, CRML, SERV, RCAT, NNE): aviso explícito de riesgo de caer a cero.
- Todo en español simple.

## Archivos

- **Nuevo:** `scripts/comite.js` (motor de números), `.github/workflows/comite.yml` (cron).
- **Modificar:** `server.js` (`leerComite()` + endpoints `/api/comite`, `/api/comite/reanalizar`), `public/index.html` (botón + contenedor de las 3 vistas), `public/app.js` (`pintarComite`, radar, barras, comparar, toggle de vista), `public/styles.css` (estilos `.comite-*`). `.gitignore` (comite.json local).

## Fuera de alcance (YAGNI, por ahora)

- Vigía de Políticos activo (necesita API de pago).
- Backtesting o señales de trading intradía.
- Alertas por correo del comité (los vigilantes ya cubren alertas; el comité es para consultar).

## Criterio de éxito

El usuario abre "Mi Comité", ve de un vistazo qué acciones están verdes y cuáles en alerta, toca una y en 30 segundos —sin saber finanzas— entiende qué opina cada analista y qué debería hacer, con su porqué y su confianza.
