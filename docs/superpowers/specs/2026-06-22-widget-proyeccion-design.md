# Widget de proyección a 30 días — Diseño

Fecha: 2026-06-22 · Estado: aprobado por el usuario (opción "gratis y automático")

## Qué es
Tarjeta en el dashboard (debajo de los KPIs), por portafolio activo: cuánto proyecta
Claude que valdrá la plata en 30 días, con rango probable y mini-gráfica de cono.
Se actualiza solo cada 2 días (gratis, GitHub Actions). Es estimación, no garantía.

## Cálculo (scripts/proyeccion.js)
Por cada posición de un portafolio:
- σ30 (volatilidad mensual) = desviación estándar de retornos diarios (~3 meses de Yahoo) × √21. Clamp [0.01, 0.5].
- μ30 (deriva esperada):
  - Si hay lectura ABIERTA del símbolo: `conv = (prob-0.5)*2` (signo según dirección), `μ = 0.005 + conv*min(σ30,0.15)`.
  - Si no hay lectura: `μ = 0.005 + clamp(tendencia_1mes*0.2, -0.04, 0.04)`.
  - Clamp final μ a [-0.18, 0.18].
- valor_i = cantidad × precio actual.
Portafolio:
- valorHoy = Σ valor_i + efectivo
- esperado = Σ valor_i·(1+μ_i) + efectivo
- bandaσ = √(Σ (valor_i·σ30_i)²)  → pesimista = esperado-bandaσ, optimista = esperado+bandaσ
- pctEsperado = (esperado-valorHoy)/valorHoy·100
Resultado: el Conservador da banda angosta; el Agresivo, banda ancha (correcto).

## Almacenamiento
Clave Upstash `proyeccion` = `{generado, horizonteDias:30, portafolios:{<id>:{valorHoy,esperado,pesimista,optimista,pctEsperado}}}`.
En local (sin env Upstash) lee data.json y escribe proyeccion.json (gitignored).

## Actualización (gratis)
`.github/workflows/proyeccion.yml`: cron `0 11 */2 * *` (cada 2 días) + workflow_dispatch.
Usa los secrets UPSTASH_* ya existentes. Se siembra a mano la primera vez.

## Servidor
`server.js` → `leerProyeccion()` (Upstash o proyeccion.json) y `/api/estado` adjunta
`proyeccion` del portafolio activo. No recalcula en cada petición (solo lee lo guardado).

## Frontend
`index.html`: `<section class="proyeccion" id="proyeccion" hidden>`. `app.js`: `pintarProyeccion()`
pinta valor esperado (count-up), % , rango y un cono SVG que sale del valor de hoy hacia 30 días.
`styles.css`: tarjeta glass + gradiente del cono.

## Honesto
Estimación probabilística (mis lecturas + matemática de volatilidad). No es promesa.
