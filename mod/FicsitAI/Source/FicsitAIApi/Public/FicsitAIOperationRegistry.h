#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Templates/ValueOrError.h"
#include "FicsitAIApiTypes.h"
#include "FicsitAIJsonSchema.h"

class FFicsitAIApiClient;

/** Ручная точка входа операции (§7.5, правило 1): экранный модуль и действие игрока в нём. */
struct FICSITAIAPI_API FFicsitAIManualEntry
{
    FName ModuleId;
    FString Action;
};

/**
 * Операция OperationRegistry (ARCHITECTURE §3.2, §7.1, ADR-018; V-3).
 * Одна операция — два входа: ручной путь в UI и инструмент модели, с одной схемой аргументов и одним Validator.
 */
struct FICSITAIAPI_API FFicsitAIOperation
{
    /** Имя инструмента модели: "list_metrics". */
    FString Id;
    /** Запрос API v0, который операция выполняет: "listMetrics". */
    FString ApiOp;
    /** Описание для модели. Генерируется из реестра, адаптер своих не держит (§7.5, правило 2). */
    FString Description;
    /** JSON Schema аргументов — копия docs/contracts/schemas/<op>-request.schema.json. */
    FString InputSchemaText;
    /** $id схемы результата: результат проверяет CI по примерам контракта. */
    FString ResultSchemaId;
    /** Ручной путь. Без него операция не выставляется модели — регистрация отказывает. */
    TOptional<FFicsitAIManualEntry> ManualEntry;
    /** Выставлена модели как инструмент. */
    bool bExposedToModel = false;
};

/** Описание инструмента для канала к адаптеру (mod-adapter-channel.md, рукопожатие, поле tools). */
struct FICSITAIAPI_API FFicsitAIToolDefinition
{
    FString Name;
    FString Description;
    TSharedPtr<FJsonObject> InputSchema;
};

/**
 * Реестр операций мода. Единственный источник описаний инструментов модели, и каждый вызов модели проходит его
 * Validator до API. Права, лимит и инертность — у подключения клиента (FFicsitAIApiClient), реестр их не дублирует.
 */
class FICSITAIAPI_API FFicsitAIOperationRegistry
{
public:
    template <typename T>
    using TResult = TValueOrError<T, FFicsitAIApiError>;

    /** Реестр v0: list_metrics и query_metric. Собирается один раз; ошибка регистрации — Fatal в журнале. */
    static const FFicsitAIOperationRegistry& V0();

    /**
     * Зарегистрировать операцию. Ошибка — почему нет:
     * - пустой или повторный Id, запрос API не из контракта;
     * - схема аргументов не компилируется (незнакомое ключевое слово — тоже);
     * - операция выставлена модели без ручной точки входа (ADR-018) или запрос API модели не разрешён;
     * - у выставленной операции нет описания.
     */
    TOptional<FString> Register(const FFicsitAIOperation& Operation);

    const FFicsitAIOperation* Find(const FString& Id) const;
    TArray<FString> GetIds() const;

    /** Инструменты модели — только выставленные операции. InputSchema — схема аргументов без $schema и $id. */
    TArray<FFicsitAIToolDefinition> GetModelTools() const;

    /**
     * Вызвать операцию через подключение клиента. Порядок: допуск подключения (лимит, инертность, права, версия) →
     * Validator схемы → разбор и выполнение запроса API. Незнакомая операция, как и невыставленная для модели, —
     * UNKNOWN_OP после допуска: токен тратится и здесь.
     */
    TResult<TSharedRef<FJsonObject>> Invoke(const FString& Id, const TSharedRef<FJsonObject>& Args, FFicsitAIApiClient& Client) const;

    /**
     * Ручной путь экрана: запрос API по его имени ("queryMetric"). Если запрос выполняет операция реестра, аргументы
     * проходят тот же Validator, что у инструмента модели (§7.5, правило 1); остальные запросы — как в Dispatch.
     * Через этот путь ходит мост веб-экранов.
     */
    TResult<TSharedRef<FJsonObject>> DispatchApi(const FString& ApiOp, const TSharedRef<FJsonObject>& Args, FFicsitAIApiClient& Client) const;

private:
    struct FEntry
    {
        FFicsitAIOperation Operation;
        FFicsitAIJsonSchema Schema;
    };
    TArray<FEntry> Entries;

    const FEntry* FindEntry(const FString& Id) const;
};
