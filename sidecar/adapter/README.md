# `adapter` — адаптер сайдкара

Тонкая прослойка между Foreman и модом. Для Foreman адаптер — **единственный `MCP_URL`**; для мода — точка входа чата и инструментов. Foreman не форкается и не патчится (ADR-012): всё, что расходится, гасится здесь.

## Что уже есть (P-3, [#4](https://github.com/kkkingqz/ficsit-ai-helper/issues/4))

Каркас, на который навешивается S2:

- слушатель **только на петле** — не-loopback адрес не предупреждение, а отказ запуска (`src/config.ts`);
- проверка токена из query `MCP_URL` постоянным по времени сравнением;
- MCP-эндпоинт `POST /mcp` на Streamable HTTP, **без управления сессиями**: на каждый запрос свой сервер и транспорт (так требует SDK в stateless-режиме);
- `GET /health` — версия, `apiVersion`, адреса Foreman и `sf-mcp`, состояние канала мода;
- логи с вычищенными секретами: токен, `x-anthropic-api-key`, `Bearer`, `sk-…` (`src/log.ts`).

Инструментов модели **намеренно нет**: они приходят из реестра операций, а не пишутся здесь — описания генерируются из реестра (ARCHITECTURE §7.5, правило 2). Пустой список инструментов — валидный ответ MCP, и Foreman с ним соединяется.

## Что будет дальше

| Когда | Что добавится |
|---|---|
| S2 ([#10](https://github.com/kkkingqz/ficsit-ai-helper/issues/10)) | автоматический вход в Foreman (локальный аккаунт, сессия Better Auth), `saveId` → playthrough, API чата поверх `POST /api/playthroughs/:id/chat` (SSE): поток, отмена, история; белый список; исходящий канал к моду |
| S6 ([#12](https://github.com/kkkingqz/ficsit-ai-helper/issues/12)) | источник Save: разбор `.sav` пакетами Foreman в снимок API |
| V-3 ([#20](https://github.com/kkkingqz/ficsit-ai-helper/issues/20)) | генерация описаний инструментов из реестра; схемы `list_metrics` и `query_metric` в `docs/contracts/` |
| V-7 ([#24](https://github.com/kkkingqz/ficsit-ai-helper/issues/24)) | проверка `apiVersion`, переподключение, логи без секретов под тестом |

## Окружение

| Переменная | По умолчанию | Что делает |
|---|---|---|
| `ADAPTER_HOST` | `127.0.0.1` | только петля; другое значение — отказ запуска |
| `ADAPTER_PORT` | `8730` | порт адаптера |
| `ADAPTER_TOKEN` | — | **обязателен**, не короче 16 символов; генерирует лаунчер, в репозитории не лежит |
| `FOREMAN_BASE_URL` | `http://127.0.0.1:8724` | куда ходить за чатом и playthrough |
| `SF_MCP_URL` | `http://127.0.0.1:8723/mcp` | MCP-сервер Foreman; модели не выставляется |
| `FICSITAI_API_VERSION` | `0.1.0` | версия публичного API мода ([docs/interfaces/public-api-v0.md](../../docs/interfaces/public-api-v0.md)) |
| `ADAPTER_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## Запуск

Отдельно (нужен Node 22):

```bash
npm install
ADAPTER_TOKEN=$(cat ~/.local/share/ficsitai/foreman/adapter.token) npm run dev
```

Вместе с Foreman — [`../launcher/dev/foreman-local.sh`](../launcher/dev/foreman-local.sh).

Проверки: `npm run typecheck`, `npm run build`, `npm test`.

## Ревью

Контрактная поверхность адаптера — инструменты из реестра, белый список, `apiVersion`, формат канала и вид `MCP_URL` — проходит ревью Co. Лаунчер и сборка архива ревью не проходят: вместо него чек-лист Gf2 и тесты с fake-LLM (решение King 09.11.2026).
