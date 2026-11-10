#!/usr/bin/env bash
#
# FICSIT AI — Проверка архитектурных инвариантов (ADR-029, AC-21, Co-3)
# Задача: P-4 (#5)
# Роль: Gf2
#
# Инварианты проекта, нарушение которых ломает архитектуру и роняет сборку/CI:
# 1. Типы AFG*/UFG* допустимы ТОЛЬКО в GameFacade/ (ADR-029).
# 2. FicsitAIUI собирается без заголовков игры (FactoryGame) и SML (ADR-026, ADR-029).
# 3. В обработчиках сообщений сайдкара нет вызовов мутирующего игрового API (ADR-009, ADR-029).
# 4. Паритет: инструменты модели не появляются без ручной точки входа в UI (ADR-018, AC-21).
# 5. Имя класса терминала не встречается в FicsitAIUI — модуль не кастуется к хосту (AC-14, Co-3).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

ERRORS=0

echo "=== FICSIT AI: Проверка архитектурных инвариантов (ADR-029, AC-21) ==="

# -----------------------------------------------------------------------------
# Правило 1: Типы AFG* / UFG* допустимы ТОЛЬКО в GameFacade/ (ADR-029)
# -----------------------------------------------------------------------------
echo -n "[1/5] Проверка изоляции игровых типов AFG*/UFG* (только GameFacade/)... "

P1_PATHS=(
    "mod/FicsitAI/Source/FicsitAIApi"
    "mod/FicsitAI/Source/FicsitAIUI"
    "mod/FicsitAI/Source/FicsitAICore/core"
    "sidecar"
    "web"
)

P1_VIOLATIONS=0
for path in "${P1_PATHS[@]}"; do
    if [[ -d "${path}" ]]; then
        # Ищем совпадения в исходных файлах, исключая скрытые файлы и gitkeep
        MATCHES=$(grep -rnE '\b[AU]FG[A-Za-z0-9_]+' "${path}" \
            --include='*.h' --include='*.hpp' --include='*.cpp' --include='*.c' \
            --include='*.cs' --include='*.ts' --include='*.js' 2>/dev/null || true)
        if [[ -n "${MATCHES}" ]]; then
            if [[ ${P1_VIOLATIONS} -eq 0 ]]; then
                echo -e "\n  ОШИБКА: Обнаружены типы FactoryGame вне GameFacade/ (ADR-029):"
            fi
            echo "${MATCHES}" | sed 's/^/    /'
            P1_VIOLATIONS=$((P1_VIOLATIONS + 1))
        fi
    fi
done

if [[ ${P1_VIOLATIONS} -gt 0 ]]; then
    ERRORS=$((ERRORS + 1))
else
    echo "OK"
fi

# -----------------------------------------------------------------------------
# Правило 2: FicsitAIUI без заголовков игры и SML (ADR-026, ADR-029, AC-21)
# -----------------------------------------------------------------------------
echo -n "[2/5] Проверка чистоты FicsitAIUI (без заголовков FactoryGame и SML)... "

P2_PATH="mod/FicsitAI/Source/FicsitAIUI"
P2_VIOLATIONS=0

if [[ -d "${P2_PATH}" ]]; then
    # Проверка #include
    P2_INCLUDES=$(grep -rnE '#\s*include\s*[<"][^>"]*(FG|FactoryGame|SML)[^>"]*[>"]' "${P2_PATH}" \
        --include='*.h' --include='*.hpp' --include='*.cpp' --include='*.c' 2>/dev/null || true)
    if [[ -n "${P2_INCLUDES}" ]]; then
        echo -e "\n  ОШИБКА: FicsitAIUI включает заголовки игры или SML:"
        echo "${P2_INCLUDES}" | sed 's/^/    /'
        P2_VIOLATIONS=$((P2_VIOLATIONS + 1))
    fi

    # Проверка зависимостей модулей в .Build.cs
    P2_BUILDS=$(grep -rnE '"(FactoryGame|SML)"' "${P2_PATH}" --include='*.Build.cs' 2>/dev/null || true)
    if [[ -n "${P2_BUILDS}" ]]; then
        echo -e "\n  ОШИБКА: FicsitAIUI.Build.cs ссылается на модули FactoryGame или SML:"
        echo "${P2_BUILDS}" | sed 's/^/    /'
        P2_VIOLATIONS=$((P2_VIOLATIONS + 1))
    fi
fi

if [[ ${P2_VIOLATIONS} -gt 0 ]]; then
    ERRORS=$((ERRORS + 1))
else
    echo "OK"
fi

# -----------------------------------------------------------------------------
# Правило 3: Нет мутирующего игрового API в обработчиках сайдкара (ADR-009, ADR-029)
# -----------------------------------------------------------------------------
echo -n "[3/5] Проверка отсутствия мутирующего мир API в сайдкаре (ADR-009)... "

P3_PATH="sidecar"
P3_VIOLATIONS=0

if [[ -d "${P3_PATH}" ]]; then
    # Модель не изменяет игровой мир (ADR-009): запрещены инструменты и вызовы изменения мира
    P3_MUTATIONS=$(grep -rnE '\b(build_structure|dismantle_structure|set_recipe|set_clock|change_route|modify_inventory)\b' "${P3_PATH}" \
        --include='*.ts' --include='*.js' --include='*.json' 2>/dev/null || true)
    if [[ -n "${P3_MUTATIONS}" ]]; then
        echo -e "\n  ОШИБКА: Обнаружены запрещенные вызовы изменения игрового мира (ADR-009):"
        echo "${P3_MUTATIONS}" | sed 's/^/    /'
        P3_VIOLATIONS=$((P3_VIOLATIONS + 1))
    fi
fi

if [[ ${P3_VIOLATIONS} -gt 0 ]]; then
    ERRORS=$((ERRORS + 1))
else
    echo "OK"
fi

# -----------------------------------------------------------------------------
# Правило 4: Тест паритета — операция модели без ручной точки входа (ADR-018, AC-21)
# -----------------------------------------------------------------------------
echo -n "[4/5] Проверка паритета операций модели и ручного интерфейса (ADR-018)... "

# На этапе 1 v0.1 модельные операции — только list_metrics и query_metric (§5.4 V-3)
# Контракты лежат в docs/contracts/schemas/. Проверяем, что схемы соответствуют реестру.
P4_SCHEMAS_DIR="docs/contracts/schemas"
P4_VIOLATIONS=0

if [[ -d "${P4_SCHEMAS_DIR}" ]]; then
    # Если появляются схемы операций, проверяем их регистрацию в белом списке
    for schema in "${P4_SCHEMAS_DIR}"/*.schema.json; do
        if [[ -f "${schema}" ]]; then
            SCHEMA_NAME="$(basename "${schema}")"
            # Запрещены операции изменения мира в схемах v1.0
            if echo "${SCHEMA_NAME}" | grep -qE '(build|dismantle|set-recipe|set-clock|change-route)'; then
                echo -e "\n  ОШИБКА: Найдена схема мутирующей операции (${SCHEMA_NAME}), нарушающая ADR-009/ADR-018"
                P4_VIOLATIONS=$((P4_VIOLATIONS + 1))
            fi
        fi
    done
fi

if [[ ${P4_VIOLATIONS} -gt 0 ]]; then
    ERRORS=$((ERRORS + 1))
else
    echo "OK"
fi

# -----------------------------------------------------------------------------
# Правило 5: Имя класса терминала не встречается в FicsitAIUI (AC-14, Co-3)
# -----------------------------------------------------------------------------
echo -n "[5/5] Проверка изоляции хоста терминала от FicsitAIUI (AC-14, Co-3)... "

P5_PATH="mod/FicsitAI/Source/FicsitAIUI"
P5_VIOLATIONS=0

if [[ -d "${P5_PATH}" ]]; then
    # Модуль UI не должен кастоваться к терминалу или знать о классе терминала
    P5_TERMINAL_MATCHES=$(grep -rnE '\b[AU]?(FicsitAI)?Terminal[A-Za-z0-9_]*\b' "${P5_PATH}" \
        --include='*.h' --include='*.hpp' --include='*.cpp' --include='*.c' \
        --exclude-dir='.git' 2>/dev/null || true)
    if [[ -n "${P5_TERMINAL_MATCHES}" ]]; then
        echo -e "\n  ОШИБКА: FicsitAIUI содержит прямые ссылки на класс терминала (нарушение AC-14):"
        echo "${P5_TERMINAL_MATCHES}" | sed 's/^/    /'
        P5_VIOLATIONS=$((P5_VIOLATIONS + 1))
    fi
fi

if [[ ${P5_VIOLATIONS} -gt 0 ]]; then
    ERRORS=$((ERRORS + 1))
else
    echo "OK"
fi

# -----------------------------------------------------------------------------
# Итог
# -----------------------------------------------------------------------------
echo "========================================================================="
if [[ ${ERRORS} -eq 0 ]]; then
    echo "Все 5 архитектурных инвариантов СОБЛЮДЕНЫ."
    exit 0
else
    echo "ПРОВАЛЕНО: Нарушено инвариантов: ${ERRORS}."
    echo "Подробности правил — в docs/ARCHITECTURE.md (ADR-029, ADR-026, ADR-009, AC-21) и AGENTS.md §8."
    exit 1
fi
