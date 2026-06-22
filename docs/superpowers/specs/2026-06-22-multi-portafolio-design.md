# Multi-portafolio en pestañas — Diseño

Fecha: 2026-06-22 · Estado: aprobado por el usuario

## Objetivo
Manejar 3 portafolios en el dashboard "Mi Cartera", cambiables por pestañas tipo Excel,
en la misma página/URL. Cada uno con $10,000 de dinero ficticio y su propio historial.

- **Agresivo** (riesgo 8.5/10): el portafolio actual (6 small-caps).
- **Conservador** (riesgo 2/10): núcleo S&P 500 + blue chips + casi-efectivo.
- **Balanceado** (riesgo 5/10): índice + calidad diversificada + lastre (oro/bonos).

## Modelo de datos (Upstash, clave `cartera`)
Pasa de `{operaciones, predicciones, snapshots}` a:
```
{
  version: 2,
  activo: "agresivo",
  portafolios: [
    { id, nombre, riesgo, capitalInicial, operaciones[], predicciones[], snapshots[] }
  ]
}
```
**Migración:** si el blob trae `operaciones` arriba (formato viejo) y no `portafolios`,
se envuelve como `portafolios[0]` con id `agresivo`, capitalInicial 10000, riesgo 8.5.
`normaliza()` garantiza la estructura y arrays por defecto en cada portafolio.

## Efectivo y valor total (mejora)
Cada portafolio tiene `capitalInicial`. El efectivo se deriva de las operaciones:
`efectivo = capitalInicial − Σ(compra: cant·precio+comisión) + Σ(venta: cant·precio−comisión)`.
- **Valor total = efectivo + valor de posiciones** (antes solo posiciones).
- **P&L total = valor total − capitalInicial** (modelo de cuenta de capital fijo).
- Snapshots guardan el valor total (incluye efectivo).
- `gananciaMes` se simplifica a `total_hoy − total_inicioMes` (no hay aportes externos).

## Endpoints (server.js)
- `GET /api/estado?portafolio=<id>` → estado del portafolio activo **+** `pestanas:[{id,nombre,riesgo,capitalInicial,valorTotal,gpTotalPct}]` para pintar las tabs. Default: `activo` o el primero.
- `POST/DELETE /api/operaciones` y `/api/predicciones` → aceptan `portafolio` (body/query); default al activo.
- `/api/buscar`, `/api/precio`, `/api/historial` quedan igual (globales).

## Frontend
- **index.html**: barra de pestañas debajo del topbar, arriba del buscador.
- **styles.css**: estilo glass tipo Excel, pestaña activa marcada, badge de riesgo por color.
- **app.js**: render de pestañas desde `pestanas`; clic → refetch `?portafolio=id` → redibuja todo; hero usa `valorTotal` (incluye efectivo); KPI de efectivo; POST/DELETE mandan el id activo.

## Sembrado (una vez)
Script `scripts/sembrar3.js`: GET `cartera` → migra/asegura agresivo → calcula acciones
fraccionarias con precios en vivo de Yahoo → escribe `conservador` y `balanceado` ($10k c/u,
fecha hoy) → SET. Idempotente (reescribe los 2 nuevos, preserva el agresivo).

## Robot de alertas
`scripts/revisar.js`: iterar sobre los 3 portafolios para movimientos fuertes y lecturas cumplidas
(dedup por símbolo/día y por id de lectura, como ya hace).

## Orden de despliegue (evita ventana en blanco / clobber)
1. Push + deploy del código nuevo (lee formato viejo y nuevo; agresivo se migra al vuelo).
2. `node scripts/sembrar3.js` **&&** disparar deploy hook en el mismo comando (el server reinicia y carga los 3 en memoria; sin huecos para que /api/estado pise el sembrado).
3. Verificar las 3 pestañas en vivo.

## Composición (precios del 2026-06-22)
**Conservador $10k:** VOO 55%, SCHD 12%, SGOV 10%, MSFT 8%, AAPL 7%, JNJ 5%, NVDA 3%.
**Balanceado $10k:** VOO 40%, SCHD 12%, MSFT 10%, JPM 9%, GE 8%, LLY 8%, GLD 8%, BIL 3% (+~$200 efectivo).
