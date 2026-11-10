#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "FicsitAIScreenTypes.h"
#include "IFicsitAIScreenModule.generated.h"

UINTERFACE(MinimalAPI, BlueprintType)
class UFicsitAIScreenModule : public UInterface { GENERATED_BODY() };

class FICSITAIAPI_API IFicsitAIScreenModule
{
    GENERATED_BODY()
public:
    /** Устойчивый идентификатор: "dashboard", "chat", "notes", … Ключ состояния и назначения экрана. */
    virtual FName GetModuleId() const = 0;

    /** Минимальная версия публичного API, нужная модулю (§5.5). Хост не открывает модуль при несовместимой мажорной. */
    virtual FString GetRequiredApiVersion() const = 0;

    /** Модуль открыт в хосте. Подписки на события API — здесь. */
    virtual void OnAttach(const FFicsitAIScreenContext& Context) = 0;

    /** Контекст изменился: размер, раскладка, фокус ввода, состояние хоста. Пересоздания нет. */
    virtual void OnContextChanged(const FFicsitAIScreenContext& Context) = 0;

    /** Модуль закрыт или хост выключается. Отписки — здесь. */
    virtual void OnDetach() = 0;

    /** Состояние модуля для сохранения в состоянии мода (§10), не в хосте. Пустая строка — нечего хранить. */
    virtual FString SavePersistentState() const { return FString(); }
    virtual void RestorePersistentState(const FString& State) {}

    /** Нужен ли модулю ввод: по нему хост решает, отдавать ли фокус и показывать ли курсор. */
    virtual bool WantsInputFocus() const { return true; }

    /** Локализованное имя для заголовка каркаса (§6.7). Модуль объявляет, хост рисует. */
    virtual FText GetDisplayName() const = 0;

    /** Подсказки клавиш для нижней полосы, в порядке показа. `Esc` добавляет хост. */
    virtual TArray<FFicsitAIHotkeyHint> GetHotkeyHints() const { return {}; }

    /** Хост спрашивает модуль первым на `Esc`. true — модуль обработал (например, отменил поток),
     *  false — хост закрывает экран. Так хост не узнаёт ни про чат, ни про потоки (Gs-4). */
    virtual bool HandleBackAction() { return false; }
};

/** Объявлена в FicsitAIApi, реализована в FicsitAIUI: так Core не зависит от UMG. */
UINTERFACE(MinimalAPI)
class UFicsitAIScreenModuleFactory : public UInterface { GENERATED_BODY() };

class FICSITAIAPI_API IFicsitAIScreenModuleFactory
{
    GENERATED_BODY()
public:
    virtual TArray<FName> GetRegisteredModules() const = 0;
    virtual TScriptInterface<IFicsitAIScreenModule> CreateModule(FName ModuleId, UObject* Outer) = 0;
};
