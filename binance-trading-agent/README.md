# Agente de trading para Binance USD-M Futures

Agente en Python (largos y cortos) que lee velas de Binance, aplica una estrategia de tendencia con pullback, dimensiona cada operación por riesgo y deja siempre un stop en el exchange. Arranca en **dry-run**: no toca dinero real salvo confirmación explícita.

> Herramienta educativa. No es asesoría financiera ni promete rentabilidad. La estrategia es una base genérica y transparente, sin ventaja estadística demostrada. Compruébala con backtest y testnet antes de arriesgar capital.

## Estado de validación

| Qué | Estado |
|---|---|
| Indicadores, estrategia, riesgo, backtester | 81 tests automáticos en verde |
| Firma HMAC | Verificada contra el vector oficial de la documentación de Binance |
| Flujo completo (cliente, agente, órdenes) | Probado sobre HTTP contra un exchange simulado local que valida firmas y orden de requests |
| **Contra Binance real o testnet** | **No probado.** El entorno donde se construyó no podía llegar a Binance. Ejecuta `check --mode testnet` antes de nada |

Los endpoints y parámetros de órdenes condicionales (`/fapi/v1/algoOrder`) salen del changelog oficial de Binance (migración del 2025-12-09) y de implementaciones de terceros, no de la página oficial del endpoint. Si el testnet rechaza alguna orden, el agente cierra la posición y se detiene (ver abajo).

## Seguridad por diseño

- **Modos:** `dry-run` (por defecto, datos reales y cuenta simulada), `testnet`, `live`. Para `live` hace falta `BINANCE_LIVE_CONFIRM=I_UNDERSTAND_THE_RISK`.
- **Claves separadas:** `BINANCE_TESTNET_API_KEY/SECRET` para testnet y `BINANCE_API_KEY/SECRET` para live, para que unas no puedan usarse en el otro entorno. Solo por variables de entorno; nunca se registran ni aparecen en errores.
- **Stop obligatorio:** tras la entrada se coloca un `STOP_MARKET` con `closePosition`. Si falla, la posición se cierra de inmediato (reduce-only) y el agente se **detiene de forma persistente** hasta que ejecutes `reset-halt`. Si además falla el cierre, queda registrado como `critical`.
- **Timeout en la entrada:** si la orden de entrada expira sin respuesta, consulta si la posición existe; si existe, la protege, y si no, aborta.
- **Límites:** riesgo por operación (por defecto 0,5%), apalancamiento máximo, posiciones abiertas, operaciones por día y pérdida diaria (por defecto 3%, detiene nuevas entradas hasta el día siguiente).
- **Sin repintado:** solo opera con velas cerradas, una vez por vela, y descarta señales con más de 120 s de antigüedad (evita entrar tarde tras un reinicio).
- **Interruptor de emergencia:** crea un archivo `KILL` y no se abrirán entradas nuevas. Las posiciones abiertas conservan sus stops en el exchange.
- **Comprobaciones previas:** reloj sincronizado y cuenta en modo One-way (el agente asume una posición por símbolo).

## Uso

```bash
cd binance-trading-agent
pip install -r requirements.txt
python -m unittest discover -s tests -t .

# 1. Backtest sobre datos reales (endpoint público, sin claves)
python -m agent backtest --symbol BTCUSDT --interval 1h --candles 4000

# 2. Dry-run: datos reales, cuenta simulada
python -m agent run --mode dry-run

# 3. Testnet: claves de https://testnet.binancefuture.com
export BINANCE_TESTNET_API_KEY=... BINANCE_TESTNET_API_SECRET=...
python -m agent check --mode testnet
python -m agent run --mode testnet

# 4. Dinero real (solo tras semanas de testnet)
export BINANCE_API_KEY=... BINANCE_API_SECRET=... BINANCE_LIVE_CONFIRM=I_UNDERSTAND_THE_RISK
python -m agent check --mode live
python -m agent run --mode live
```

Otros comandos: `run --once` (un solo ciclo), `reset-halt` (limpia una detención persistida), `--config ruta.json` (ver `config.example.json`).

Todas las decisiones se escriben en `journal.jsonl` (señales, rechazos, entradas, errores, detenciones).

**Claves de API en Binance:** habilita solo Futuros, **desactiva retiros** y restringe por IP. Usa una subcuenta con el capital que estés dispuesto a perder.

## Estrategia

Seguimiento de tendencia con entrada en retroceso, sobre la vela cerrada:

- **Largo:** EMA20 > EMA50 > EMA200, cierre sobre EMA200 y el RSI(14) recupera el nivel 40 desde abajo.
- **Corto:** espejo, con EMA20 < EMA50 < EMA200 y el RSI cruzando 60 desde arriba hacia abajo.
- **Stop:** 2 x ATR(14) desde la entrada. **Objetivo:** 2R.
- **Tamaño:** `equity x riesgo% / distancia al stop`, limitado por el apalancamiento máximo y redondeado a los filtros del símbolo (`LOT_SIZE`, `MIN_NOTIONAL`).

La lógica es modular: `agent/strategy.py` es el único archivo a tocar para cambiarla. El backtester usa exactamente el mismo código de señales.

## Limitaciones del backtester

- Rellena stops y objetivos con el rango de cada vela; si una vela toca ambos niveles cuenta como pérdida, y un hueco por encima del stop se rellena a la apertura.
- Aplica comisión y deslizamiento estimados. **No modela funding rates**, límites diarios ni liquidez.
- Una serie sintética suave puede dar 100% de aciertos; eso no es evidencia. Usa siempre datos reales y compara con comprar y mantener (se muestra en el resumen).
- Un buen backtest no garantiza resultados futuros.

## Estructura

```
agent/binance_client.py   cliente REST firmado (testnet/live, dry-run sin escrituras)
agent/strategy.py         señales          agent/risk.py       tamaño y límites
agent/backtest.py         simulador        agent/runner.py     ejecutores y bucle principal
agent/__main__.py         CLI              tests/              unitarios + integración local
```
