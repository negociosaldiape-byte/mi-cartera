# 🐺📈 PROMPT MAESTRO — Rehacer "Mi Panel de Inversiones" (versión world-class)

> **Cómo usarlo:** abre una sesión nueva de Claude Code **dentro de la carpeta `C:\Users\mela\FINANZAS`** y pega TODO lo que está debajo de la línea. Claude se encargará del resto. No necesitas tocar código.

---

## 🎭 Quién eres
Eres **la mejor persona del mundo diseñando y construyendo dashboards personales**. Tienes gusto exquisito, criterio fuerte y obsesión por el detalle. Tu misión: convertir un panel funcional pero básico en un producto que **se sienta como una app fintech premium** (nivel Robinhood / Revolut / Linear), pero que corra **localmente, sin fricción y sin instalar nada**. No haces "lo genérico de IA"; haces algo con alma.

## 🧠 Antes de empezar — entiende lo que YA existe (NO empieces de cero)
En esta carpeta ya hay un panel funcionando. **Léelo completo antes de tocar nada** (`server.js`, `public/index.html`, `public/styles.css`, `public/app.js`, `data.json`, `config.json`, `iniciar.bat`, `LEEME.txt`). Resumen:

- **Backend:** `server.js` — servidor Node **sin dependencias** (módulo `http` nativo). Sirve `public/`, expone una API JSON y trae precios en vivo.
- **API actual:** `GET /api/estado`, `POST/DELETE /api/operaciones`, `POST/DELETE /api/predicciones`.
- **Datos:** `data.json` con `{ operaciones, predicciones, snapshots }`. `config.json` define el proveedor de precios (`yahoo` gratis por defecto, o `finnhub` con llave).
- **Precios:** Yahoo Finance (`query1.finance.yahoo.com/v8/finance/chart/SIMBOLO`) sin llave; cache de 60s.
- **Funciones:** registro manual de compras/ventas, tabla de posiciones con P&L, tarjetas KPI (invertido, valor hoy, ganancia/pérdida, "este mes" por snapshots), y un **marcador de predicciones** que auto-marca acierto/fallo al cumplirse el plazo.
- **Lanzamiento:** doble clic en `iniciar.bat` → abre el navegador en `http://localhost:3000`. Hay una variable `PANEL_NO_ABRIR=1` que evita el auto-abrir (úsala para probar sin abrir navegador).
- **Workflow especial:** cuando el usuario le pide a Claude una "lectura" de mercado, esa predicción se registra en `data.json` con `autor: "claude"`.

## ⛔ Restricciones DURAS (no negociables)
1. **Cero dependencias, cero build, cero framework.** Vanilla JS + HTML + CSS puro. Si una sola micro-librería es imprescindible (p. ej. confetti), **vendoriza un único archivo local** — jamás npm/package.json/build.
2. **Se sigue abriendo con doble clic en `iniciar.bat`** y sigue corriendo en Windows con el `server.js` existente. La experiencia de arranque no empeora.
3. **Preserva el esquema de `data.json` y TODOS los endpoints actuales**, además del flujo `autor: "claude"` y la lógica de snapshots/marcador. Los datos que el usuario ya tenga deben seguir funcionando (migración suave).
4. **UI 100% en español**, cálida y simple, para una persona **no técnica**.
5. **Conserva el alma honesta:** el marcador auto-evalúa acierto/fallo; el pie dice "análisis, no garantías; esto no es asesoría financiera". Nunca presentes una predicción como certeza.
6. **Respeta `prefers-reduced-motion`** (si está activo, sin animaciones; escribe los valores finales directo).
7. **No rompas la obtención de precios** (Yahoo por defecto, Finnhub opcional).

## 🛠️ Skills que DEBES usar (en este orden)
> Usa la herramienta `Skill`. Elige las relevantes como lo haría un experto; no invoques skills que no aportan.

1. **`ui-ux-pro-max`** — primero. Define el **sistema de diseño**: estilo, paleta (apto para finanzas: base oscura profunda, verde/rojo vivos para ganancia/pérdida, UN acento premium), pareja tipográfica, escala de espaciado, sombras y los **tipos de gráfico** correctos. Aplica sus guías de UX para la reducción de fricción y el onboarding.
2. **`frontend-design`** — para implementar la interfaz con calidad **distintiva y de producción**, evitando la estética genérica de IA.
3. **`humanizalo`** — pasa **TODO el texto visible** (tutorial, tooltips, estados vacíos, toasts, microcopy) por esta skill para que suene humano y cálido, no robótico.
4. **`verify` / `run`** — al final, para arrancar el panel de verdad y comprobar que todo funciona (ver "Definición de terminado").

No hay skill ni conector de bolsa disponible para descargar (ya se verificó el registro); no lo necesitas: los precios ya llegan por la API existente.

---

## 🎯 OBJETIVO 1 — Menos fricción (que sea facilísimo)
- **"Agregar operación" inteligente:** un solo campo de búsqueda de símbolo con **autocompletado** (debounce ~250 ms, flechas + Enter para elegir). Al elegir un símbolo, **autocompleta el precio actual** (editable) y la **fecha = hoy**. Solo símbolo + cantidad son obligatorios; lo demás detrás de un `<details>` "Más opciones".
  - *Permitido en backend:* añade endpoints proxy mínimos en `server.js` (sigue sin dependencias): `GET /api/buscar?q=` (proxy a `query1.finance.yahoo.com/v1/finance/search?q=`) y, si hace falta, `GET /api/precio?simbolo=`.
- **Inputs grandes y amables:** `font-size:18px`, alto mínimo 44 px, `inputmode="decimal"` en números.
- **Edición en línea** de filas (click → input → Enter confirma, Esc cancela). Acciones por fila con un toque (✏️/🗑️) vía delegación de eventos.
- **Botón flotante (FAB)** "+" siempre visible para agregar.
- **UI optimista + toast con DESHACER** en vez de `confirm()`: al borrar, quita la fila al instante y muestra "Eliminado — Deshacer" por 5 s; si no deshacen, recién ahí persiste.
- **Estados vacíos** con una sola llamada a la acción ("Agregar mi primera operación").
- **Responsive/móvil:** KPIs con `grid auto-fit`; en pantallas chicas la tabla colapsa a tarjetas apiladas. **Atajos:** `N` nueva operación, `/` buscar, `Esc` cerrar.
- Formateo de moneda en vivo con `Intl.NumberFormat('es')`; verde/rojo automático.

## 🎯 OBJETIVO 2 — Tutorial / onboarding dentro del panel
- **Tour tipo "spotlight" sin librería:** overlay fijo a pantalla completa; el "agujero" sobre el elemento resaltado se logra con un cuadro posicionado (según `getBoundingClientRect()`) y **`box-shadow: 0 0 0 9999px rgba(0,0,0,.6)`**. Tooltip posicionado al lado con texto + "Siguiente / Atrás / Saltar" + "Paso 2 de 5". Pasos = array `{selector, título, texto}`; re-mide en cada paso; `scrollIntoView({block:'center'})`.
  - Pasos sugeridos: el formulario ("Aquí registras una compra"), las KPI ("Aquí ves tu ganancia"), el marcador ("Las lecturas de tu bróker, con su % de aciertos").
- **Modo demo:** botón "Ver con datos de ejemplo" que carga una cartera de muestra (sin persistir, con bandera `demoMode`) y un banner "Estás viendo datos de ejemplo"; botón "Borrar y empezar de cero" limpia todo y vuelve al estado vacío.
- **Tooltips por métrica:** "ⓘ" junto a cada KPI con explicación en español llano ("Ganancia = valor hoy − lo invertido").
- **Botón "?" persistente** (abajo-izquierda) para repetir el tour cuando quieran.
- **Primera vez:** si `!localStorage.seenTour`, arranca el tour (u ofrece el modo demo) y marca la bandera al terminar/saltar.
- **Mini-walkthrough de la primera operación:** 3 pasos guiados sobre el formulario real ("Busca lo que compraste" → "¿Cuántas acciones?" → "¡Listo, mira tu cartera!").
- Todo el copy: cálido, plano, español (pásalo por `humanizalo`).

## 🎯 OBJETIVO 3 — Más bonito + animaciones dinámicas muy vistosas
- **Count-up de KPIs** con `requestAnimationFrame` + easing (`easeOutExpo`) y `font-variant-numeric: tabular-nums` (que los dígitos no salten). Al refrescar, **flash** verde/rojo según suba/baje (clase auto-removida en `animationend`).
- **Gráficos SVG sin librería:**
  - **Dona de asignación** (un `<circle>` por posición, `stroke-dasharray` + `stroke-dashoffset`).
  - **Área de P&L en el tiempo** (a partir de `snapshots`; si hay pocos datos, muestra "se irá llenando con los días").
  - **Sparklines** por posición.
  - **Anillo de % de aciertos** del marcador (animando `stroke-dashoffset`, `stroke-linecap:round`).
  - Animación universal "draw-on" con `getTotalLength()` + transición de `stroke-dashoffset`.
- **Entrada con stagger:** `--i` por tarjeta + `animation-delay: calc(var(--i)*60ms)`; **View Transitions API** (`document.startViewTransition`) como mejora progresiva; **scroll-reveal** con un único `IntersectionObserver`.
- **Skeletons/shimmer** mientras cargan los precios (gradiente animado por `background-position`, misma altura que el contenido para no saltar el layout).
- **Toasts** con `aria-live` (y el patrón de deshacer del Objetivo 1).
- **Confetti** en vanilla (`<canvas>` + rAF, ~150 partículas con gravedad) al marcar una predicción "acertada" o un nuevo máximo histórico de cartera.
- **Estética premium:** glassmorphism sutil (`backdrop-filter: blur(12px)` + fondo translúcido + borde claro), **fondo aurora** (radiales borrosos animados lento en un `::before`), sombras suaves multicapa, radios 12–16 px, transiciones 150–250 ms con `cubic-bezier(.2,.8,.2,1)`, UN acento. **Evita:** morado-azul saturado por defecto, emojis como íconos, sombras negras duras, todo centrado.
- **Rendimiento:** anima solo `transform`/`opacity`; `requestAnimationFrame` (no `setInterval`); pausa el polling de precios con la Page Visibility API (`document.hidden`).

## 🎯 OBJETIVO 4 — Elevar el núcleo (sin romperlo)
Agrega los gráficos que hoy no existen (dona, área de P&L, sparklines, anillo de aciertos) usando los datos reales. **Los números deben seguir siendo correctos** (verifica P&L, costo promedio, "este mes"). No toques la honestidad del marcador.

---

## ✅ Definición de TERMINADO (verifica de verdad, no asumas)
Arranca el panel (`PANEL_NO_ABRIR=1` + `node server.js` para probar sin abrir navegador, o `iniciar.bat`) y comprueba en `http://localhost:3000`:
1. Primera visita → estado vacío bonito + tour de bienvenida (o modo demo).
2. Agregar operación con el buscador → autocompleta precio y fecha → aparece en la tabla.
3. Las KPI hacen **count-up**; los gráficos **animan**; hay **shimmer** mientras cargan los precios.
4. Borrar muestra **toast con Deshacer** (sin `confirm()`).
5. El **anillo de aciertos** y la **dona** se ven y animan; el confetti dispara en un acierto.
6. **Responsive** en ventana angosta; con `prefers-reduced-motion` activo NO hay animaciones.
7. **La API y los datos viejos siguen funcionando** (prueba `GET /api/estado`, `POST/DELETE` de operaciones y predicciones, y que un `data.json` con datos previos cargue sin error).
8. **Cero errores en la consola** del navegador.

## 📦 Cómo entregar
- Transforma `public/*`; extiende `server.js` solo lo mínimo (endpoints proxy) manteniendo cero dependencias.
- Actualiza `LEEME.txt` con la info del nuevo tutorial.
- Al final, dile al usuario (no técnico, en español): qué cambió, cómo abrirlo, y cómo repetir el tour.
- **No cambies** la forma de lanzar (doble clic) ni el formato de `data.json`.
