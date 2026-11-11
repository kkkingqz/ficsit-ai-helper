#!/usr/bin/env bash
# Запуск сайдкара локально без Docker: sf-mcp, ff-server и адаптер — только на петле.
#
# P-3 (#4). Это ещё не лаунчер поставки (S5-lite): здесь нет портативного Node,
# архива и первого запуска с вопросами. Это воспроизводимый запуск на машине
# разработки, из которого лаунчер потом вырастет.
#
#   foreman-local.sh start|stop|status|urls|migrate|set-key|models
#
# Окружение:
#   FOREMAN_SRC   клон Foreman на зафиксированном коммите (по умолчанию ~/Projects/foreman-src)
#   FICSITAI_DATA данные сайдкара: база, саквояж саveов, токен, логи, pid
#                 (по умолчанию ~/.local/share/ficsitai/foreman)
#   FICSITAI_LLM  gemini (по умолчанию, решение King 10.11.2026), anthropic или openai
#   LLM_MODEL     модель чата; для gemini по умолчанию gemini-3.5-flash-lite
#   LLM_API_KEY   ключ провайдера; если не задан, берётся из <FICSITAI_DATA>/llm.key
#                 (кладётся командой set-key, права 600). Без ключа поднимается всё,
#                 кроме ответа в чате
set -euo pipefail

FOREMAN_SRC="${FOREMAN_SRC:-$HOME/Projects/foreman-src}"
FICSITAI_DATA="${FICSITAI_DATA:-$HOME/.local/share/ficsitai/foreman}"
ADAPTER_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../adapter" && pwd)"

SF_MCP_PORT="${SF_MCP_PORT:-8723}"
FF_SERVER_PORT="${FF_SERVER_PORT:-8724}"
ADAPTER_PORT="${ADAPTER_PORT:-8730}"
NORMALIZER_PORT="${NORMALIZER_PORT:-8731}"
HOST_LOOPBACK=127.0.0.1

RUN_DIR="$FICSITAI_DATA/run"
LOG_DIR="$FICSITAI_DATA/logs"
TOKEN_FILE="$FICSITAI_DATA/adapter.token"

# Node 22: берём системный, если он есть, иначе разовый nix shell (профиль не меняем).
node_prefix() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
    if [ "$major" -ge 22 ]; then return 0; fi
  fi
  if command -v nix >/dev/null 2>&1; then
    printf '%s' "nix shell nixpkgs#nodejs_22 --command"
    return 0
  fi
  echo "нужен Node 22 или nix; поставь Node 22 или задай PATH" >&2
  exit 1
}

run_node() { # run_node <рабочий каталог> <команда…>
  local dir="$1"; shift
  local prefix; prefix="$(node_prefix)"
  # shellcheck disable=SC2086
  (cd "$dir" && exec ${prefix} "$@")
}

# Записанный pid — не признак работы: $! даёт голову цепочки обёрток (nix, npm),
# а node живёт внучатым процессом и умирает отдельно. 10.11.2026 адаптер лежал
# полтора часа, пока status показывал «работает» по живому pid обёртки. Признак
# работы — слушатель на порту, он же и есть работа службы.
wait_for_port() { # wait_for_port <порт> <секунд>
  local port="$1" deadline; deadline=$(( $(date +%s) + ${2:-40} ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    [ -n "$(listeners_on "$port")" ] && return 0
    sleep 0.5
  done
  return 1
}

start_bg() { # start_bg <имя> <порт> <рабочий каталог> <команда…>
  local name="$1" port="$2" dir="$3"; shift 3
  local prefix; prefix="$(node_prefix)"
  mkdir -p "$RUN_DIR" "$LOG_DIR"
  if [ -n "$(listeners_on "$port")" ]; then
    echo "$name уже слушает порт $port (pid $(listeners_on "$port" | tr "\n" " "))"
    return 0
  fi
  # shellcheck disable=SC2086
  # </dev/null и отдельная сессия: иначе процесс держит открытым конвейер вызывающего,
  # и запуск из скрипта с пайпом (например, в tail) не возвращает управление.
  (cd "$dir" && setsid nohup ${prefix} "$@" >>"$LOG_DIR/$name.log" 2>&1 </dev/null & echo $! >"$RUN_DIR/$name.pid")
  local pid; pid="$(cat "$RUN_DIR/$name.pid")"
  # Запоминаем группу процессов, а не только pid: npm и nix порождают цепочку
  # обёрток, и node живёт внучатым процессом. Убийство одного pid его не трогает,
  # а порт остаётся занятым — на этом уже попались (P-3, 10.11.2026).
  ps -o pgid= -p "$pid" 2>/dev/null | tr -d " " >"$RUN_DIR/$name.pgid" || true
  if ! wait_for_port "$port" 40; then
    echo "$name не поднялся за 40 с: порт $port никто не слушает. Последние строки $LOG_DIR/$name.log:" >&2
    tail -5 "$LOG_DIR/$name.log" >&2 || true
    return 1
  fi
  echo "$name запущен (pid $pid, группа $(cat "$RUN_DIR/$name.pgid" 2>/dev/null)), слушает $port, лог $LOG_DIR/$name.log"
}

ensure_token() {
  mkdir -p "$FICSITAI_DATA"
  if [ ! -s "$TOKEN_FILE" ]; then
    # Токен адаптера: 32 байта энтропии в hex. Файл только для владельца.
    (umask 077; od -An -tx1 -N32 /dev/urandom | tr -d ' \n' >"$TOKEN_FILE")
    echo "сгенерирован токен адаптера: $TOKEN_FILE"
  fi
  chmod 600 "$TOKEN_FILE"
  ADAPTER_TOKEN="$(cat "$TOKEN_FILE")"
  export ADAPTER_TOKEN
}

KEY_FILE_DEFAULT_MODEL_CHAT="gemini-3.5-flash-lite"
KEY_FILE_DEFAULT_MODEL_SUMMARY="gemini-3.5-flash-lite"
GEMINI_OPENAI_BASE="https://generativelanguage.googleapis.com/v1beta/openai"

llm_env() {
  local key_file="$FICSITAI_DATA/llm.key"
  if [ -z "${LLM_API_KEY:-}" ] && [ -s "$key_file" ]; then
    LLM_API_KEY="$(cat "$key_file")"
    export LLM_API_KEY
  fi

  case "${FICSITAI_LLM:-gemini}" in
    gemini)
      # Gemini подключается через OpenAI-совместимый эндпоинт Google: своего
      # провайдера у Foreman для него нет, и это ровно тот случай, под который
      # там сделан LLM_BASE_URL.
      export LLM_PROVIDER=openai
      export LLM_UPSTREAM_BASE_URL="${LLM_UPSTREAM_BASE_URL:-$GEMINI_OPENAI_BASE}"
      export LLM_MODEL="${LLM_MODEL:-$KEY_FILE_DEFAULT_MODEL_CHAT}"
      export LLM_SUMMARY_MODEL="${LLM_SUMMARY_MODEL:-$KEY_FILE_DEFAULT_MODEL_SUMMARY}"
      ;;
    anthropic|openai)
      export LLM_PROVIDER="$FICSITAI_LLM"
      ;;
    *)
      echo "FICSITAI_LLM: ожидается gemini, anthropic или openai" >&2
      exit 1
      ;;
  esac

  # Нормализатор ответов провайдера (ADR-034) живёт в процессе адаптера:
  # Foreman ходит к нему, а он — к провайдеру. Выключается FICSITAI_NORMALIZER=off,
  # и тогда Foreman обращается к провайдеру напрямую, теряя вызовы инструментов.
  if [ "${FICSITAI_NORMALIZER:-on}" = "on" ] && [ -n "${LLM_UPSTREAM_BASE_URL:-}" ]; then
    export NORMALIZER_PORT
    export LLM_BASE_URL="http://$HOST_LOOPBACK:$NORMALIZER_PORT"
  elif [ -n "${LLM_UPSTREAM_BASE_URL:-}" ]; then
    export LLM_BASE_URL="${LLM_UPSTREAM_BASE_URL}"
    unset LLM_UPSTREAM_BASE_URL
    echo "предупреждение: нормализатор выключен — вызовы инструментов у Gemini потеряются (ADR-034)" >&2
  fi

  if [ -z "${LLM_API_KEY:-}" ]; then
    echo "предупреждение: ключа LLM нет ($key_file) — поднимется всё, кроме ответа в чате." >&2
    echo "                положить ключ: $(basename "${BASH_SOURCE[0]}") set-key" >&2
  fi
}

cmd_set_key() {
  mkdir -p "$FICSITAI_DATA"
  local key_file="$FICSITAI_DATA/llm.key" key=""
  echo "Ключ LLM-провайдера (ввод не отображается, в историю команд не попадает)."
  echo "Для Gemini ключ берётся в Google AI Studio: https://aistudio.google.com/apikey"
  printf 'Ключ: '
  IFS= read -rs key
  echo
  [ -n "$key" ] || { echo "пусто — ничего не записал" >&2; exit 1; }
  (umask 077; printf '%s' "$key" >"$key_file")
  chmod 600 "$key_file"
  echo "записан $key_file (права 600)"
}

cmd_models() {
  llm_env
  [ -n "${LLM_API_KEY:-}" ] || { echo "нет ключа: сначала set-key" >&2; exit 1; }
  # Список моделей — чтобы имя в LLM_MODEL не угадывать, а брать из ответа API.
  curl -sS "https://generativelanguage.googleapis.com/v1beta/models" \
    -H "x-goog-api-key: $LLM_API_KEY" |
    grep -o '"name": *"models/[^"]*"' | sed 's/.*models\///; s/"$//' | sort
}

common_env() {
  ensure_token
  mkdir -p "$FICSITAI_DATA/saves"
  export SAVE_DATA_DIR="$FICSITAI_DATA/saves"
  export DATABASE_URL="file:$FICSITAI_DATA/foreman.db"
  # sf-mcp по умолчанию слушает 0.0.0.0 и в режиме stdio не слушает вовсе.
  export MCP_TRANSPORT=http
  export MCP_HTTP_HOST="$HOST_LOOPBACK"
  export MCP_HTTP_PORT="$SF_MCP_PORT"
  # ff-server по умолчанию слушает 0.0.0.0.
  export HOST="$HOST_LOOPBACK"
  export PORT="$FF_SERVER_PORT"
  # Единственный MCP_URL Foreman — наш адаптер, а не sf-mcp напрямую (S2).
  export MCP_URL="http://$HOST_LOOPBACK:$ADAPTER_PORT/mcp?token=$ADAPTER_TOKEN"
  export ADAPTER_HOST="$HOST_LOOPBACK"
  export ADAPTER_PORT
  export SF_MCP_URL="http://$HOST_LOOPBACK:$SF_MCP_PORT/mcp"
  export FOREMAN_BASE_URL="http://$HOST_LOOPBACK:$FF_SERVER_PORT"
  llm_env
}

cmd_migrate() {
  common_env
  echo "применяю схему к $DATABASE_URL"
  run_node "$FOREMAN_SRC" npm run db:deploy -w @foreman/ff-server
}

cmd_start() {
  common_env
  [ -d "$FOREMAN_SRC" ] || { echo "нет клона Foreman: $FOREMAN_SRC (коммит — foreman.pin.json)" >&2; exit 1; }
  [ -d "$ADAPTER_SRC/node_modules" ] || run_node "$ADAPTER_SRC" npm install --no-audit --no-fund
  # Занятый порт — повод остановиться, а не поднимать второй экземпляр поверх.
  for port in "$SF_MCP_PORT" "$FF_SERVER_PORT" "$ADAPTER_PORT" "$NORMALIZER_PORT"; do
    if [ -n "$(listeners_on "$port")" ]; then
      echo "порт $port уже занят (pid $(listeners_on "$port" | tr "\n" " ")) — сначала stop" >&2
      exit 1
    fi
  done
  start_bg sf-mcp "$SF_MCP_PORT" "$FOREMAN_SRC" npm run start:mcp
  start_bg ff-server "$FF_SERVER_PORT" "$FOREMAN_SRC" npm run start:server
  # Адаптер поднимается собранным, а не под tsx watch: наблюдатель переподнимает
  # процесс на каждую правку файла, и при нескольких поколениях они дрались за
  # порт 8730 — выжившее поколение отвечало со старой конфигурацией (10.11.2026).
  # Режим разработки включается осознанно: ADAPTER_MODE=dev.
  if [ "${ADAPTER_MODE:-build}" = "dev" ]; then
    start_bg adapter "$ADAPTER_PORT" "$ADAPTER_SRC" npm run dev
  else
    run_node "$ADAPTER_SRC" npm run build > /dev/null
    start_bg adapter "$ADAPTER_PORT" "$ADAPTER_SRC" npm run start
  fi
  echo
  cmd_urls
}

cmd_stop() {
  for name in adapter ff-server sf-mcp; do
    local pid_file="$RUN_DIR/$name.pid" pgid_file="$RUN_DIR/$name.pgid"
    if [ -f "$pgid_file" ] && [ -s "$pgid_file" ]; then
      local pgid; pgid="$(cat "$pgid_file")"
      if kill -0 "-$pgid" 2>/dev/null; then
        kill -TERM -- "-$pgid" 2>/dev/null || true
        echo "$name остановлен (группа $pgid)"
      fi
    elif [ -f "$pid_file" ]; then
      local pid; pid="$(cat "$pid_file")"
      kill -0 "$pid" 2>/dev/null && { kill "$pid" 2>/dev/null || true; echo "$name остановлен (pid $pid)"; }
    fi
    rm -f "$pid_file" "$pgid_file"
  done
  # Контрольный проход по портам: если что-то осталось висеть, порт занят и
  # следующий start поднимется мимо — молча и с чужой конфигурацией.
  local leftover=0
  for port in "$SF_MCP_PORT" "$FF_SERVER_PORT" "$ADAPTER_PORT" "$NORMALIZER_PORT"; do
    local pids; pids="$(listeners_on "$port")"
    for pid in $pids; do
      kill -TERM "$pid" 2>/dev/null && { echo "добит слушатель порта $port (pid $pid)"; leftover=1; }
    done
  done
  [ "$leftover" = 0 ] || sleep 1
  return 0
}

listeners_on() { # listeners_on <порт> → pid процессов, слушающих этот порт
  # grep без совпадений даёт код 1, поэтому глушим: иначе stop возвращал 1 на
  # штатном «никто не висит», и вызов из скрипта с set -e падал на ровном месте.
  ss -ltnpH "sport = :$1" 2>/dev/null | grep -o "pid=[0-9]*" | cut -d= -f2 | sort -u || true
}

status_of() { # status_of <имя> <порт> → 0, если служба слушает
  local name="$1" port="$2" pid_file="$RUN_DIR/$1.pid" listening recorded=""
  listening="$(listeners_on "$port" | tr "\n" " ")"
  [ -f "$pid_file" ] && recorded="$(cat "$pid_file")"
  if [ -n "$listening" ]; then
    printf '%-10s работает (порт %s, pid %s)\n' "$name" "$port" "${listening% }"
    return 0
  fi
  if [ -n "$recorded" ] && kill -0 "$recorded" 2>/dev/null; then
    printf '%-10s НЕ РАБОТАЕТ: pid %s жив, но порт %s никто не слушает — смотри %s\n' \
      "$name" "$recorded" "$port" "$LOG_DIR/$name.log"
    return 1
  fi
  printf '%-10s не запущен\n' "$name"
  return 1
}

cmd_status() {
  local bad=0
  status_of sf-mcp "$SF_MCP_PORT" || bad=1
  status_of ff-server "$FF_SERVER_PORT" || bad=1
  status_of adapter "$ADAPTER_PORT" || bad=1
  if [ "${FICSITAI_NORMALIZER:-on}" != "off" ]; then
    if [ -n "$(listeners_on "$NORMALIZER_PORT")" ]; then
      printf '%-10s работает (порт %s, в процессе адаптера)\n' "нормализатор" "$NORMALIZER_PORT"
    else
      printf '%-10s не слушает порт %s\n' "нормализатор" "$NORMALIZER_PORT"
      bad=1
    fi
  fi
  echo
  echo "слушатели (должны быть только 127.0.0.1):"
  ss -ltnp 2>/dev/null | awk -v p1="$SF_MCP_PORT" -v p2="$FF_SERVER_PORT" -v p3="$ADAPTER_PORT" -v p4="$NORMALIZER_PORT" \
    'NR==1 || $4 ~ ":"p1"$" || $4 ~ ":"p2"$" || $4 ~ ":"p3"$" || $4 ~ ":"p4"$"'
  # Ненулевой код, когда что-то лежит: иначе проверка в чек-листе Gf2 зелёная
  # при мёртвой службе.
  return "$bad"
}

cmd_urls() {
  ensure_token
  echo "sf-mcp     http://$HOST_LOOPBACK:$SF_MCP_PORT/health   (MCP: /mcp, без аутентификации — только петля)"
  echo "ff-server  http://$HOST_LOOPBACK:$FF_SERVER_PORT"
  echo "адаптер    http://$HOST_LOOPBACK:$ADAPTER_PORT/health"
  echo "нормализ.  http://$HOST_LOOPBACK:$NORMALIZER_PORT → провайдер (ADR-034, в процессе адаптера)"
  echo "MCP_URL    http://$HOST_LOOPBACK:$ADAPTER_PORT/mcp?token=<в $TOKEN_FILE>"
  llm_env
  echo "LLM        ${FICSITAI_LLM:-gemini} → провайдер $LLM_PROVIDER, модель ${LLM_MODEL:-по умолчанию у Foreman}${LLM_API_KEY:+, ключ на месте}"
}

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  urls) cmd_urls ;;
  migrate) cmd_migrate ;;
  set-key) cmd_set_key ;;
  models) cmd_models ;;
  *) sed -n '1,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
