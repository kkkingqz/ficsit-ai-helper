#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Templates/ValueOrError.h"
#include "FicsitAIApiTypes.h"

class FFicsitAIApiCore;

/**
 * Подключение одного клиента к API v0: экранного модуля, адаптера модели, внешнего мода.
 *
 * Лимит частоты, права и проверка версии — на клиента отдельно, поэтому каждый модуль держит своё подключение,
 * а не делит общее. Все вызовы — на GameThread; запросы читают последний снимок и не ждут.
 * Подключение переживает API: после закрытия мира запросы отвечают SOURCE_UNAVAILABLE, события не приходят.
 */
class FICSITAIAPI_API FFicsitAIApiClient : public TSharedFromThis<FFicsitAIApiClient>
{
public:
    /** Событие API в канонической форме: имя ("metrics.snapshot") и данные. */
    using FEventHandler = TFunction<void(const FString& Event, const TSharedRef<FJsonObject>& Data)>;

    template <typename T>
    using TResult = TValueOrError<T, FFicsitAIApiError>;

    const FFicsitAIApiClientInfo& GetInfo() const { return Info; }

    /**
     * Подписка на события. Один обработчик на подключение; пустой — отписка. Обработчик может сам отписаться или
     * отключиться: вызов доживёт до конца на своей копии (ревью #71, P2).
     */
    void SetEventHandler(FEventHandler Handler)
    {
        OnEvent = Handler ? MakeShared<FEventHandler>(MoveTemp(Handler)) : TSharedPtr<FEventHandler>();
    }

    /** Отключиться: события больше не приходят, запросы отвечают SOURCE_UNAVAILABLE. */
    void Disconnect();

    TResult<FFicsitAIApiStatus> GetStatus();
    TResult<FFicsitAIMetricPage> ListMetrics(const FFicsitAIListMetricsArgs& Args);
    TResult<FFicsitAIScopePage> ListScopes(const FFicsitAIListScopesArgs& Args);
    TResult<FFicsitAIValue> QueryMetric(const FString& MetricId, const FString& ScopeId = FString());
    TResult<FFicsitAISeries> QuerySeries(const FString& MetricId, EFicsitAISeriesWindow Window, const FString& ScopeId = FString());

    /** Запрос в канонической форме: имя в lowerCamelCase ("queryMetric", регистр важен) и аргументы. Для моста
     *  страниц и канала адаптера — они говорят JSON. Ответ — тело в канонической форме или ошибка контракта.
     *  Допуск тот же, что у типизированных запросов, и до разбора аргументов: ошибочный запрос тоже тратит токен. */
    TResult<TSharedRef<FJsonObject>> Dispatch(const FString& Op, const TSharedRef<FJsonObject>& Args);

    /** Запросы API v0. Unknown — имени нет в контракте. */
    enum class EOp : uint8 { Unknown, GetStatus, ListMetrics, ListScopes, QueryMetric, QuerySeries, ChatSend, ChatCancel, ChatHistory };
    static EOp ParseOp(const FString& Op);

    /** Права вида клиента (раздел «Клиенты»): модели — только list_metrics и query_metric, ряд входит во второй. */
    static bool IsAllowed(EFicsitAIApiClientKind Kind, EOp Op);

private:
    friend class FFicsitAIApiCore;

    FFicsitAIApiClient(const TSharedRef<FFicsitAIApiCore>& InCore, const FFicsitAIApiClientInfo& InInfo, double Now);

    /**
     * Единый допуск запроса, по порядку: API открыт; лимит (токен списывается за любой запрос, и за ошибочный);
     * инертный режим — всё, кроме getStatus; права вида клиента; мажорная версия модели. Ошибка — почему нет.
     */
    TOptional<FFicsitAIApiError> Admit(EOp Op, const FString& OpName);

    /** Событие доходит до этого клиента: модели с несовпавшей мажорной версией данные не рассылаются. */
    bool AcceptsEvent(const FString& Event) const;

    TWeakPtr<FFicsitAIApiCore> Core;
    FFicsitAIApiClientInfo Info;
    /** Один экземпляр обработчика на подключение: его состояние живёт между событиями, а рассылка удерживает
     *  его ссылкой до выхода из вызова, даже если внутри клиент отключился (ревью #71). */
    TSharedPtr<FEventHandler> OnEvent;

    /** Ведро токенов: ёмкость — лимит в секунду, пополнение непрерывное (§7.4). */
    double Tokens = 0.0;
    double LastRefill = 0.0;
};
