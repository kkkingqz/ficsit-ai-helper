# @ficsitai/screen-cards

Модуль виджетов карточек в чате с ИИ для терминала FICSIT AI (**V-14**, задача [#31](https://github.com/kkkingqz/ficsit-ai-helper/issues/31), **AC-18**, **ARCHITECTURE.md §7.6**).

## Возможности

1. **Валидация схемы контракта `chat-card.schema.json`:**
   - Проверка `schemaVersion: 1`.
   - Поддерживаемые типы виджетов: `metric` и `timeseries` (из экрана «Статистика»).
   - Валидация структуры `source` (`kind: 'metric'`, ID по шаблону `^[a-z][a-z0-9_.]{0,63}$`).
   - Соблюдение инварианта `oneOf`: строго одно из полей `source` (ссылочная карточка) или `data` (оценка ассистента).
   - Лимиты на опции (не более 8 свойств допустимых примитивных типов).

2. **Отказоустойчивость и текстовый fallback (AC-18):**
   - Невалидная карточка (нарушение схемы, неподдерживаемый виджет, отсутствующая метрика) отклоняется валидатором без падения чата.
   - Формируется понятный человеку `fallbackText` для отображения в ленте чата обычным текстовым сообщением.

3. **Связь с фасадом живой телеметрии `@ficsitai/screens-api`:**
   - Сверка `source.id` с каталогом метрик мода (`listMetrics`).
   - Получение текущего значения через `queryMetric` с учётом единиц и точности.
   - Получение временного ряда через `querySeries` (с поддержкой окон 5, 15, 60 мин).
   - Оценка актуальности по формуле $\Delta t \le \max(3 \cdot sampleIntervalSec, 10\text{ с})$.

4. **Рендеринг в модель и DOM-разметку:**
   - Формирование бейджей (`Телеметрия`, `Оценка ассистента`, `Устарело`, `Ошибка`).
   - Отрисовка sparkline SVG для временных рядов с расчётом минимума, максимума и среднего.
   - Экранирование HTML для предотвращения XSS-инъекций.

## Использование

```typescript
import { createApi } from '@ficsitai/screens-api';
import { processShowCard } from '@ficsitai/screen-cards';

const api = createApi();

// Вызов инструмента show_card моделью:
const result = await processShowCard(
  {
    schemaVersion: 1,
    type: 'metric',
    title: 'Потребление энергии',
    source: { kind: 'metric', id: 'power.consumption' },
  },
  api
);

if (result.ok && result.model) {
  // Вставка HTML карточки в поток чата
  container.insertAdjacentHTML('beforeend', result.model.html);
} else {
  // Вывод безопасного текстового fallback
  chatHistory.appendMessage({ text: result.fallbackText });
}
```

## Тестирование и проверка

```bash
npm run typecheck
npm test
npm run build
```
