// Сгенерировано docs/contracts/embed-op-schemas.py из docs/contracts/schemas/. Руками не править:
// CI сверяет этот файл с источником (embed-op-schemas.py --check).

// list-metrics-request.schema.json
inline const TCHAR* ListMetricsRequest = TEXT(R"ficsitai_schema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ficsit-ai/contracts/list-metrics-request.schema.json",
  "title": "ListMetricsRequest",
  "description": "Аргументы операции list_metrics — каталога метрик телеметрии (public-api-v0.md, §Запросы v0 и §Операции v0; ARCHITECTURE.md §7.5, §8.2). Модель получает каталог страницами и с фильтром, а не целиком: перечень из десятков метрик в одном ответе переполнил бы контекст. Все поля необязательны: вызов без аргументов отдаёт первую страницу полного каталога.",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "metricId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128,
      "description": "Один идентификатор метрики. Ответ тогда содержит ровно один дескриптор, а курсор областей в нём однозначен (Gs-8.1)."
    },
    "scope": {
      "type": "string",
      "enum": [
        "factory",
        "powerNetwork",
        "item",
        "machineType",
        "line"
      ],
      "description": "Фильтр по уровню метрики. `line` в v0.1 не заполняется: экрана линий в срезе нет."
    },
    "filter": {
      "type": "string",
      "maxLength": 128,
      "description": "Подстрока по названию и идентификатору метрики."
    },
    "scopeFilter": {
      "type": "string",
      "maxLength": 128,
      "description": "Подстрока по названию области. Допустим только вместе с `metricId`, иначе `INVALID_ARGUMENT`."
    },
    "pageSize": {
      "type": "integer",
      "minimum": 1,
      "maximum": 200,
      "default": 50,
      "description": "По умолчанию 50, максимум 200. Вне границ — `INVALID_ARGUMENT`, а не молчаливое усечение."
    },
    "cursor": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "description": "Курсор метрик: непрозрачная строка из `nextCursor` предыдущей страницы. Клиент её не разбирает и не конструирует."
    },
    "scopeCursor": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "description": "Курсор областей одной метрики из `nextScopeCursor`. Допустим только вместе с `metricId`. Курсоры метрик и областей не взаимозаменяемы: подмена — `INVALID_ARGUMENT`, а не пустая страница, которая выглядела бы как «областей больше нет»."
    }
  },
  "dependentRequired": {
    "scopeFilter": [
      "metricId"
    ],
    "scopeCursor": [
      "metricId"
    ]
  }
})ficsitai_schema");

// query-metric-request.schema.json
inline const TCHAR* QueryMetricRequest = TEXT(R"ficsitai_schema({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ficsit-ai/contracts/query-metric-request.schema.json",
  "title": "QueryMetricRequest",
  "description": "Аргументы операции query_metric (public-api-v0.md, §Запросы v0 и §Операции v0). Одна операция отвечает и значением, и рядом: окно задано — ряд, не задано — значение. Отдельной операции на ряд у модели нет нарочно, иначе у неё появилось бы два способа спросить одно и то же (§Операции v0). Запрос читает последний снимок и сбор не инициирует.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "metricId"
  ],
  "properties": {
    "metricId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128,
      "description": "Идентификатор из живого каталога. Пришедший от модели сверяется с каталогом, а не принимается из текста (§7.3): это один из трёх механизмов против инъекции через авторский текст игрока. Неизвестный — `UNKNOWN_METRIC`."
    },
    "scopeId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128,
      "description": "Экземпляр области из `availableScopes` дескриптора. Обязателен по смыслу для метрик уровня `item`, `machineType`, `powerNetwork` и `line`: без него — `SCOPE_REQUIRED`, с неизвестным — `SCOPE_NOT_FOUND`. Для `factory` не передаётся."
    },
    "window": {
      "type": "string",
      "enum": [
        "last5Min",
        "last15Min",
        "last60Min"
      ],
      "description": "Задано — ответом будет ряд (`kind: \"series\"`), и метрика должна иметь `hasSeries: true`, иначе `SERIES_NOT_AVAILABLE`. Не задано — ответом будет значение (`kind: \"value\"`)."
    }
  }
})ficsitai_schema");
