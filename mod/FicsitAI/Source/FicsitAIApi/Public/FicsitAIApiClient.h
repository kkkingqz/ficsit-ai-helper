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

    /** Подписка на события. Один обработчик на подключение; пустой — отписка. */
    void SetEventHandler(FEventHandler Handler) { OnEvent = MoveTemp(Handler); }

    /** Отключиться: события больше не приходят, запросы отвечают SOURCE_UNAVAILABLE. */
    void Disconnect();

    TResult<FFicsitAIApiStatus> GetStatus();
    TResult<FFicsitAIMetricPage> ListMetrics(const FFicsitAIListMetricsArgs& Args);
    TResult<FFicsitAIScopePage> ListScopes(const FFicsitAIListScopesArgs& Args);
    TResult<FFicsitAIValue> QueryMetric(const FString& MetricId, const FString& ScopeId = FString());
    TResult<FFicsitAISeries> QuerySeries(const FString& MetricId, EFicsitAISeriesWindow Window, const FString& ScopeId = FString());

    /** Запрос в канонической форме: имя в lowerCamelCase ("queryMetric") и аргументы. Для моста страниц и канала
     *  адаптера — они говорят JSON. Ответ — тело в канонической форме или ошибка контракта. */
    TResult<TSharedRef<FJsonObject>> Dispatch(const FString& Op, const TSharedRef<FJsonObject>& Args);

private:
    friend class FFicsitAIApiCore;

    FFicsitAIApiClient(const TSharedRef<FFicsitAIApiCore>& InCore, const FFicsitAIApiClientInfo& InInfo, double Now);

    /** Запрос пропущен лимитом, инертным режимом и проверкой версии. Ошибка — почему нет. */
    TOptional<FFicsitAIApiError> Admit(bool bStatusOnly);

    TWeakPtr<FFicsitAIApiCore> Core;
    FFicsitAIApiClientInfo Info;
    FEventHandler OnEvent;

    /** Ведро токенов: ёмкость — лимит в секунду, пополнение непрерывное (§7.4). */
    double Tokens = 0.0;
    double LastRefill = 0.0;
};
