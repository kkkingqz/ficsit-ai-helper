#pragma once

#include "CoreMinimal.h"
#include "Subsystem/ModSubsystem.h"
#include "FGSaveInterface.h"
#include "FicsitAISubsystem.generated.h"

DECLARE_LOG_CATEGORY_EXTERN(LogFicsitAISubsystem, Log, All);

/**
 * Подсистема мода FICSIT AI.
 * Хранит постоянное состояние сессии (SaveId), отслеживает режим мультиплеера
 * и предоставляет точку входа для диагностических сценариев (S1, P-8).
 */
UCLASS(Blueprintable)
class FICSITAICORE_API AFicsitAISubsystem : public AModSubsystem, public IFGSaveInterface
{
    GENERATED_BODY()

public:
    AFicsitAISubsystem();

    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;

    // IFGSaveInterface
    virtual void PreSaveGame_Implementation(int32 SaveVersion, int32 GameVersion) override;
    virtual void PostSaveGame_Implementation(int32 SaveVersion, int32 GameVersion) override;
    virtual void PreLoadGame_Implementation(int32 SaveVersion, int32 GameVersion) override;
    virtual void PostLoadGame_Implementation(int32 SaveVersion, int32 GameVersion) override;
    virtual bool NeedTransform_Implementation() override { return false; }
    virtual bool ShouldSave_Implementation() const override { return true; }

    /** Возвращает глобальный экземпляр подсистемы для мира */
    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Subsystem", meta = (WorldContext = "WorldContext"))
    static AFicsitAISubsystem* Get(UObject* WorldContext);

    /** Идентификатор сохранения (ADR-014, AC-07) */
    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Subsystem")
    const FString& GetSaveId() const { return SaveId; }

    /** Проверяет, активен ли инертный режим (мультиплеер) */
    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Subsystem")
    bool IsInertMode() const { return bInertMode; }

    /** Активен ли режим автоматической диагностики */
    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Subsystem")
    bool IsDiagnosticsActive() const { return bDiagnosticsActive; }

    /** Имя диагностического сценария (-FicsitAITestScenario=<имя>) */
    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Subsystem")
    FName GetDiagnosticsScenario() const { return DiagnosticsScenario; }

    /** Сохраняет состояние модуля по составному ключу (SaveId, ModuleId) (ADR-014, AC-14) */
    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Subsystem")
    void SaveModuleState(const FString& InSaveId, FName ModuleId, const FString& State);

    /** Загружает состояние модуля по составному ключу (SaveId, ModuleId) (ADR-014, AC-14) */
    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Subsystem")
    FString GetModuleState(const FString& InSaveId, FName ModuleId) const;

protected:
    UPROPERTY(SaveGame, BlueprintReadOnly, Category = "FICSIT AI|Subsystem")
    FString SaveId;

    /** Постоянное состояние экранных модулей по ключу (SaveId, ModuleId) (ADR-014, AC-14) */
    UPROPERTY(SaveGame)
    TMap<FString, FString> ModuleStatesByKey;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Subsystem")
    bool bInertMode = false;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Subsystem")
    bool bDiagnosticsActive = false;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Subsystem")
    FName DiagnosticsScenario = NAME_None;
};
