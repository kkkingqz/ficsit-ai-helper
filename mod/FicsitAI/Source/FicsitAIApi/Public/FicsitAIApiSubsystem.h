#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "IFicsitAIApi.h"
#include "FicsitAIApiSubsystem.generated.h"

class FFicsitAIApiCore;
class IFicsitAIDataSource;

/**
 * API мода в мире: один на игровой мир. Модули получают его через FFicsitAIScreenContext::Api, адаптер — через
 * канал. Источник данных подключает проводка мода (Live в игре, Fixture в Screen Lab и тестах).
 *
 * Без игры и без SML: модуль FicsitAIApi зависит только от движка, чтобы экраны открывались и вне игры (S6).
 */
UCLASS()
class FICSITAIAPI_API UFicsitAIApiSubsystem : public UWorldSubsystem, public IFicsitAIApi
{
    GENERATED_BODY()

public:
    static UFicsitAIApiSubsystem* Get(const UObject* WorldContext);

    // UWorldSubsystem
    virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;

    // IFicsitAIApi
    virtual FString GetApiVersion() const override;
    virtual TSharedRef<FFicsitAIApiClient> Connect(const FFicsitAIApiClientInfo& Info) override;

    /** Подключить источник данных; прежний останавливается, его снимки и ряды забываются. nullptr — без источника. */
    void SetSource(TSharedPtr<IFicsitAIDataSource> Source);

    /** Состояние мода для статуса: SaveId, инертный режим и его причина (§4.2). Меняет проводка мода. */
    void SetModState(const FString& SaveId, bool bInert, const FText& InertReason);

private:
    TSharedPtr<FFicsitAIApiCore> Core;
};
