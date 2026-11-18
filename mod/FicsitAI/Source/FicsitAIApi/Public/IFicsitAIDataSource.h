#pragma once

// Сменный источник данных API (ADR-025, ARCHITECTURE §8.5).
//
// Источник только публикует снимки: каталог метрик с областями и последние значения. Всё остальное делает API —
// проверку аргументов, страницы, ряды за окно, события, лимиты. Поэтому Live, Fixture, Save и Recording отдают
// экранам одно и то же поведение, а различаются только тем, откуда взяли числа.

#include "CoreMinimal.h"
#include "FicsitAIApiTypes.h"

/** Одно значение метрики в одной области. */
struct FICSITAIAPI_API FFicsitAIMetricSample
{
    /** Пусто для метрик с Scope = Factory, иначе одно из ScopeId в перечне областей метрики. */
    FString ScopeId;
    EFicsitAIValueState State = EFicsitAIValueState::Value;
    double Value = 0.0;
    /** Когда значение снято. Источник повторяет прежнее значение с прежним временем, если не снимал его заново:
     *  так API отличает новое значение от старого и не пишет в ряд одну точку дважды. */
    double SessionTimeSec = 0.0;
};

/** Метрика в снимке: описание, полный перечень областей и значения по ним. */
struct FICSITAIAPI_API FFicsitAIMetricSnapshot
{
    /** AvailableScopes — полный перечень областей; страницы и потолок 50 делает API. bScopesTruncated не читается. */
    FFicsitAIMetricDescriptor Descriptor;
    int32 PrecisionDigits = 1;
    TArray<FFicsitAIMetricSample> Samples;
};

/** Полное состояние источника на момент снимка. Метрика, которой нет в снимке, исчезла из каталога. */
struct FICSITAIAPI_API FFicsitAISnapshot
{
    /** Секунды от начала сессии. Не убывают: по ним считаются окна рядов. */
    double SessionTimeSec = 0.0;
    TArray<FFicsitAIMetricSnapshot> Metrics;
};

/** Куда источник отдаёт снимки. Реализует API; вызывается только на GameThread. */
class FICSITAIAPI_API IFicsitAISnapshotSink
{
public:
    virtual ~IFicsitAISnapshotSink() = default;

    /** Новый снимок. Предыдущий заменяется целиком. */
    virtual void PublishSnapshot(const FFicsitAISnapshot& Snapshot) = 0;

    /** Источник не может отдавать данные (запись кончилась, мир выгружается). Запросы ответят SOURCE_UNAVAILABLE
     *  с этой причиной до следующего снимка. */
    virtual void ReportUnavailable(const FText& Reason) = 0;
};

/** Источник данных. Живёт, пока подключён к API: SetSource вызывает Start, замена или закрытие API — Stop. */
class FICSITAIAPI_API IFicsitAIDataSource
{
public:
    virtual ~IFicsitAIDataSource() = default;

    /** Что это за источник: попадает в каждое значение и в метку свежести. */
    virtual EFicsitAIDataSource GetKind() const = 0;

    /** Начать публиковать снимки в Sink. Sink живёт до Stop. */
    virtual void Start(IFicsitAISnapshotSink& Sink) = 0;

    /** Больше не публиковать. После Stop обращение к Sink недопустимо. */
    virtual void Stop() = 0;
};
