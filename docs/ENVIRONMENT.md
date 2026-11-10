---
title: "FICSIT AI — окружение разработки мода под Linux (ADR-033)"
subtitle: "Пошаговое руководство по развёртыванию SML 3.12, MSVC under Wine и Alpakit"
author: "Gf, разработчик UE / терминал и хост"
date: "10.11.2026"
lang: ru-RU
---

# Окружение разработки мода под Linux

Этот документ — инструкция для команды по подготовке рабочего места для разработки мода **FICSIT AI** на базе Satisfactory Mod Loader (SML) 3.12 для Satisfactory 1.2 (ADR-033).

> [!IMPORTANT]
> **Целевая платформа игроков — Windows, платформа команды — Linux (ADR-033).**  
> Нативного Linux-клиента у Satisfactory нет. Мод под Win64 собирается инструментарием Microsoft Visual C++ (MSVC) под Wine, а игра и тестирование повседневных сборок запускаются под **Proton**. Сборка движка из исходников **запрещена** (ADR-033, KICKOFF): используется готовый архив редактора под Linux от Coffee Stain Studios.

---

## 1. Системные требования и место на диске

- **ОС:** Linux x86_64 (проверено на Ubuntu 26.04 LTS и NixOS).
- **Свободное место:** не менее **40–50 ГБ** (редактор CSS, компилятор MSVC, Windows SDK, starter project и кэши сборки).
- **Wine:** версия 9.x / 10.x / 11.x (Wine 64-bit / WoW64).

---

## 2. Необходимые системные пакеты

Для работы скриптов распаковки, `msvc-wine` и сборки требуются:
- `git` — система контроля версий;
- `msitools` (в частности утилита `msiextract`) — для распаковки `.msi`-пакетов Microsoft;
- `tar` и `zstd` — для распаковки архивов редактора движка;
- `dos2unix` и `patch` — для нормализации окончаний строк и применения патчей Wwise в SML;
- `python3` — для запуска загрузчика `vsdownload.py`;
- `wine` — для исполнения компилятора MSVC под Linux.

### Установка в Ubuntu / Debian
```bash
sudo apt update
sudo apt install -y git msitools tar zstd dos2unix patch python3 wine
```

### Альтернатива через Nix (без sudo и изменения системных пакетов)
Если вы работаете в среде с Nix или без прав суперпользователя:
```bash
nix --extra-experimental-features "nix-command flakes" shell \
  nixpkgs#msitools nixpkgs#wineWow64Packages.stable nixpkgs#dos2unix nixpkgs#patch
```

---

## 3. Установка MSVC и Windows SDK через `msvc-wine`

Unreal Engine при сборке целей `Win64` на Linux вызывает MSVC через Wine. Для этого используется специализированная ветка `ue-patches` проекта `msvc-wine`.

### 3.1 Клонирование репозитория
```bash
git clone --branch ue-patches https://github.com/mircearoata/msvc-wine.git ~/msvc-wine
cd ~/msvc-wine
```

### 3.2 Загрузка MSVC 17.8 и Windows SDK 10.0.22621
Загрузка строго фиксированных версий, совместимых с SML 3.12:
```bash
./vsdownload.py --accept-license \
  --dest "$HOME/msvc" \
  --msvc-version "17.8" \
  --sdk-version "10.0.22621" \
  --channel "release.ltsc.17.8"
```

### 3.3 Установка скриптов-обёрток под Wine
После завершения загрузки и распаковки примените обёртки Wine к каталогу установки:
```bash
./install.sh "$HOME/msvc"
```
Скрипт соберёт вспомогательные утилиты `msvctricks.exe` и `process_sourcedependencies.exe` и настроит структуру компилятора.

### 3.4 Переменная окружения `UE_WINE_MSVC`
UnrealBuildTool (UBT) находит тулчейн MSVC по переменной `UE_WINE_MSVC`.

Добавьте в `~/.profile` или `~/.bashrc` (либо `/etc/environment`):
```bash
export UE_WINE_MSVC="$HOME/msvc"
```
И примените в текущей сессии:
```bash
export UE_WINE_MSVC="$HOME/msvc"
```

> [!NOTE]
> Как только шаг 3 завершён и MSVC встал под Wine, **сообщите Co** (согласно `KICKOFF.md`): от этого зависит проверка модулей `WebSockets` и `HTTP` и транспорт канала в S2.

---

## 4. Загрузка и регистрация редактора Unreal Engine

Редактор Coffee Stain Studios (CSS) для Linux берётся готовым архивом.

> [!WARNING]
> **Не собирайте движок из исходников.** Сборка занимает 2–3 часа и десятки гигабайт, тогда как готовый бинарный архив уже собран разработчиками игры.

### 4.1 Доступ и загрузка архива
Архив распространяется через приватный форк Unreal Engine от разработчиков игры:
`https://github.com/satisfactorymoddingUE/UnrealEngine/releases` (требуется привязка GitHub-аккаунта через `linker.ficsit.app/link`).

Скачайте все части сплит-архива `UnrealEngine-CSS-Editor-Linux.tar.zst.*` (части `Debug` скачивать **не нужно**).

### 4.2 Распаковка
Поместите части архива в выбранный каталог (например, `~/UnrealEngineCSS`) и выполните распаковку:
```bash
mkdir -p ~/UnrealEngineCSS
cd ~/UnrealEngineCSS
cat UnrealEngine-CSS-Editor-Linux.tar.zst.* | zstd -d | tar -xf -
```

### 4.3 Регистрация движка в системе
Чтобы инструменты SML и проекты `.uproject` ассоциировались с установленным редактором:
```bash
~/UnrealEngineCSS/Engine/Binaries/Linux/UnrealVersionSelector -register -unattended
```

---

## 5. Стартовый проект SML 3.12 и Wwise

Рабочая среда разработки модов поставляется единым проектом `SatisfactoryModLoader` (репозиторий выполняет роль как загрузчика модов, так и Starter Project для Unreal Engine).

### 5.1 Клонирование Starter Project
```bash
git clone --branch v3.12.0 --depth 1 \
  https://github.com/satisfactorymodding/SatisfactoryModLoader.git \
  ~/Projects/SatisfactoryModLoader
cd ~/Projects/SatisfactoryModLoader
```

В состав проекта входят:
- `FactoryGame.uproject` (EngineAssociation `5.6.1-CSS`);
- `Mods/SML` и `Mods/SMLEditor`;
- `Mods/Alpakit` — плагин для сборки и упаковки модов;
- `Mods/WwisePatches` — автоматические патчи аудиодвижка Wwise под Linux (`applyPatches.sh`).

### 5.2 Установка `wwise-cli` и интеграция Wwise SDK
Для работы аудиосистемы требуется интеграция Wwise SDK (для SML 3.12 / Satisfactory 1.2 используются SDK `2023.1.14.8770` и интеграция UE `2023.1.14.3555`):

1. Скачайте бинарник `wwise-cli` из релизов:
   ```bash
   gh release download v0.2.4 --repo mircearoata/wwise-cli \
     --pattern "wwise-cli_linux_amd64" --output ~/.local/bin/wwise-cli
   chmod +x ~/.local/bin/wwise-cli
   ```
2. Скачайте Wwise SDK и выполните интеграцию Wwise в проект `FactoryGame.uproject` (требуется бесплатный аккаунт Audiokinetic):
   ```bash
   export WWISE_EMAIL="your_email@example.com"
   export WWISE_PASSWORD="your_password"

   wwise-cli download \
     --sdk-version "2023.1.14.8770" \
     --filter Packages=SDK \
     --filter DeploymentPlatforms=Windows_vc160 \
     --filter DeploymentPlatforms=Windows_vc170 \
     --filter DeploymentPlatforms=Linux
     --filter DeploymentPlatforms=

   wwise-cli integrate-ue \
     --integration-version "2023.1.14.3555" \
     --project "$HOME/Projects/SatisfactoryModLoader/FactoryGame.uproject"
   ```
3. Примените патчи аудиосистемы Coffee Stain Studios:
   ```bash
   bash "$HOME/Projects/SatisfactoryModLoader/Mods/WwisePatches/applyPatches.sh" "$HOME/Projects/SatisfactoryModLoader"
   ```

---

## 6. Настройка среды разработки (IDE) и патчи UBT

### 6.1 Необходимые патчи движка для Linux / IDE
Перед генерацией проектных файлов примените три исправления в движке `UnrealEngineCSS`:
1. **Скрипты сборки UBT:** скопируйте `BuildUBT.sh` и `DotnetDepends.sh` в `~/UnrealEngineCSS/Engine/Build/BatchFiles/` и дайте права на выполнение:
   ```bash
   gh api repos/satisfactorymodding/UnrealEngine/contents/Engine/Build/BatchFiles/BuildUBT.sh?ref=5.6.1-CSS --jq ".content" | base64 -d > ~/UnrealEngineCSS/Engine/Build/BatchFiles/BuildUBT.sh
   gh api repos/satisfactorymodding/UnrealEngine/contents/Engine/Build/BatchFiles/DotnetDepends.sh?ref=5.6.1-CSS --jq ".content" | base64 -d > ~/UnrealEngineCSS/Engine/Build/BatchFiles/DotnetDepends.sh
   chmod +x ~/UnrealEngineCSS/Engine/Build/BatchFiles/BuildUBT.sh ~/UnrealEngineCSS/Engine/Build/BatchFiles/DotnetDepends.sh
   ```
2. **Удаление LiveLinkHub:** удалите несовместимую с Linux утилиту LiveLinkHub:
   ```bash
   rm -rf ~/UnrealEngineCSS/Engine/Source/Programs/LiveLinkHub
   ```
3. **Отключение блокировки PCH в `UEBuildTarget.cs`:** закомментируйте строки 2474–2482 в файле `~/UnrealEngineCSS/Engine/Source/Programs/UnrealBuildTool/Configuration/UEBuildTarget.cs` (блок создания мьютекса `UnrealBuildTool_CreateCompileEnvironmentForProjectFiles` и вызов `CreateSharedPCHInstances`).
4. **Пересборка UBT:**
   ```bash
   cd ~/UnrealEngineCSS/Engine/Build/BatchFiles && ./BuildUBT.sh "" FORCE
   ```

### 6.2 Вариант А: VS Code (рекомендуемый для Linux)
1. Сгенерируйте файл `.code-workspace` с помощью UBT:
   ```bash
   ~/UnrealEngineCSS/Engine/Build/BatchFiles/Linux/GenerateProjectFiles.sh \
     -project="$HOME/Projects/SatisfactoryModLoader/FactoryGame.uproject" \
     -game -engine -vscode
   ```
2. Открывайте в VS Code **только** сгенерированный файл `.code-workspace` (а не каталог).
3. **Патч OmniSharp (.NET):** в настройках workspace добавьте путь к .NET CLI движка:
   ```json
   "omnisharp.dotNetCliPaths": [
     "~/UnrealEngineCSS/Engine/Binaries/ThirdParty/DotNet/8.0.300/linux"
   ]
   ```
4. **IntelliSense:** сгенерируйте базу команд компиляции Clang (`compile_commands.json`), запустив задачу генерации проекта с флагом `-Mode=GenerateClangDatabase`.
5. **Сборка редактора:** `Ctrl + Shift + P` → `Tasks: Run Task` → `FactoryEditor Linux Development Build`.

### Вариант Б: JetBrains Rider
1. Откройте `FactoryGame.uproject`.
2. Выберите конфигурацию: `Development` | `Editor` | `Linux`.

---

## 7. Сборка мода через Alpakit Win64 под Wine

1. В стартовом проекте в меню плагина **Alpakit** выберите целевой мод (`FicsitAI`).
2. Целевая платформа упаковки: **Windows / Win64**.
3. Alpakit и UBT автоматически используют тулчейн `$UE_WINE_MSVC` через Wine для кросс-компиляции C++ модулей в `.dll` и упаковки `.pak` / `.ucas` / `.utoc`.
4. Результат сборки помещается в `Saved/Alpakit/<ModReference>/`.

---

## 8. Проверка мода в игре под Proton

1. Убедитесь, что установлена игра **Satisfactory 1.2** в Steam под Proton.
2. Скопируйте упакованный мод в каталог модов игры:
   ```bash
   ~/.steam/steam/steamapps/common/Satisfactory/FactoryGame/Mods/
   ```
   *(либо используйте Satisfactory Mod Manager — SMM)*.
3. Запустите игру.
4. В главном меню убедитесь, что:
   - В меню модов отображается ваш мод.
   - Игра загружается в сохранение без ошибок и сбоев.

---

## 9. Критерий завершения задачи P-1

Задача P-1 считается закрытой, когда:
- [x] Инструкция составлена и прошла ревью Co (PR #36).
- [x] MSVC 17.8 и SDK 10.0.22621 развёрнуты через `msvc-wine` у Gf (`~/msvc`).
- [ ] Пустой тестовый мод собирается через Alpakit Win64 под Wine.
- [ ] Мод успешно загружается в Satisfactory под Proton **у всех трёх разработчиков мода: Gf, Co и Gs**.
