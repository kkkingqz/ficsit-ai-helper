# V-14 · Карточки в чате

`chatCard({ presenter, Plot, copy })` создаёт представление с `element`, `update(model)` и `destroy()`. Подключите `ui-kit.css`, `cards.css` и локальные JS/CSS uPlot. Перед первым `update` добавьте `element` в контейнер сообщения. Масштаб задаётся переменной хоста `--ficsit-ui-scale`.

Вызов `destroy()` удаляет карточку и освобождает график при закрытии сообщения или экрана. Поздние обновления после удаления игнорируются.

## Модель от контроллера

```js
const view = chatCard({ presenter, Plot: window.uPlot, copy });
messageElement.append(view.element);
view.update({
  resolved,                       // ResolvedCard из web/screens/cards/
  state: { kind: resolved.status, label: localizedStatus, detail: localizedDetail },
  start: windowStartSessionTimeSec,
  end: windowEndSessionTimeSec,
});
```

- `resolved` — результат `resolveCard` после проверки карточки и её источника. Поля `metric`, `series` и `descriptor` используются напрямую. Ссылочный `metric` переиспользует `metricTile`, `timeseries` — `timeChart` из «Статистики».
- `state` содержит локализованные подписи актуальности. Контроллер передаёт `kind`, равный `resolved.status`, и интерпретирует ошибки. Пять состояний D-2 сохраняют место карточки.
- `start` и `end` задают окно ряда в секундах сессии. Для `timeseries` нужны конечные числа и `end > start`. При отсутствии диапазона отображается `resolved.fallbackText`.
- `series.timestamps`, `values` и `intervalSec` передаются общему графику с сохранением пропусков. `windowIncomplete` добавляет подпись укороченной истории. При обновлении данных и свежести сохраняется экземпляр графика.
- Происхождение показывается отдельно от актуальности. Для ссылочной карточки добавляются значения `metric.source` и `series.source` через словарь хоста. `save`, `saveEstimated`, `recorded`, `fixture` и `planned` получают собственные подписи.
- Для отклонённой карточки передайте `{ resolved: null, state, fallbackText }`. Неподдерживаемый виджет или оценка ассистента показывает готовый `fallbackText`. У оценки остаётся метка происхождения. Текст и заголовки вставляются через `textContent`.

Контроллер владеет API, проверкой `source.scopeId`, подписками и хранением карточек. Для этого стыка ему нужен `ResolvedCard` с исходными временными рядами. Формат `CardRenderModel` с готовым HTML этому представлению не требуется.

## Строки от хоста

`copy` содержит `reference`, `estimate`, `fallbackTitle`, `incomplete`, таблицу `sources` и функции `time(deltaSeconds)` / `axis(value)`. Ключи источников соответствуют `DataSource` API v0. `presenter` — общий форматтер D-2 с локалью и подписями единиц. Английский пример находится в `fixtures.js`.

## Демонстрация и проверка

Запустите из корня репозитория `python3 -m http.server 8040 --bind 127.0.0.1`. Откройте `http://127.0.0.1:8040/web/ui-kit/cards/`. Параметр `?scale=150` включает масштаб 150 %. Выбор состояния меняет обе карточки в сообщении. Данные витрины явно помечены `Fixture`.

`/web/ui-kit/cards/smoke.html` проверяет нулевое значение, `notApplicable`, источники, локализацию, переходы состояний, пропуски и неполное окно ряда, безопасный fallback, работу в узком контейнере и освобождение графика. Подключение к `show_card` и игровая приёмка выполняются с контроллерами Cf3 и Co2.
