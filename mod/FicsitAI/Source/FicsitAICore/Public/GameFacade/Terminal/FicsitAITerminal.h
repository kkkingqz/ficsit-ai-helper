#pragma once

#include "CoreMinimal.h"
#include "Buildables/FGBuildable.h"
#include "IFicsitAIScreenHost.h"
#include "IFicsitAIScreenModule.h"
#include "FGPowerInfoComponent.h"
#include "FGPowerConnectionComponent.h"
#include "FicsitAITerminal.generated.h"

DECLARE_LOG_CATEGORY_EXTERN(LogFicsitAITerminal, Log, All);

/**
 * Строительный объект AI Terminal (хост экранных модулей).
 * Архитектура: ARCHITECTURE.md §3.1, §6.1, Spike S1.
 * Потребление: 10 MW (ADR-001, AC-01).
 * Пропорция экрана: 16:9 (ADR-030).
 */
UCLASS(Blueprintable)
class FICSITAICORE_API AFicsitAITerminal : public AFGBuildable, public IFicsitAIScreenHost
{
    GENERATED_BODY()

public:
    AFicsitAITerminal();

    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
    virtual void Tick(float DeltaSeconds) override;

    /** Инициализация хост-контекста и фабрики модулей (вызывается в BeginPlay или явно в тестах) */
    void InitializeHost();

    /** Обновление состояния питания и готовности терминала */
    void UpdateHostState();

    /** Потребляемая терминалом мощность в МВт (ADR-001, AC-01, P-7 §1.1) */
    float GetTargetConsumption() const { return TargetPowerConsumption; }

    /** Переопределение наличия питания (для автотестов и симуляции) */
    void SetPowerOverride(TOptional<bool> InOverride) { bPowerOverride = InOverride; }

    /** Установить подсистему мода вручную (для тестов) */
    void SetCustomSubsystem(class AFicsitAISubsystem* InSubsystem) { CustomSubsystem = InSubsystem; }

    class AFicsitAISubsystem* GetSubsystem() const;

    // IFGSaveInterface
    virtual void PreSaveGame_Implementation(int32 SaveVersion, int32 GameVersion) override;

    // IFGUseableInterface (интеракция с игроком по E)
    virtual void OnUse_Implementation(class AFGCharacterPlayer* byCharacter, const FUseState& state) override;
    virtual bool IsUseable_Implementation() const override;
    virtual void UpdateUseState_Implementation(class AFGCharacterPlayer* byCharacter, const FVector& atLocation, class UPrimitiveComponent* componentHit, FUseState& out_useState) override;

    // IFicsitAIScreenHost
    virtual FFicsitAIScreenContext GetScreenContext() const override { return HostContext; }
    virtual TArray<FName> GetAvailableModules() const override;
    virtual bool OpenModule(FName ModuleId) override;
    virtual void CloseActiveModule() override;
    virtual FName GetActiveModuleId() const override { return ActiveModuleId; }
    virtual void RequestInputFocus(bool bWanted) override;
    virtual void NotifyContentChanged() override;

    /** Немедленная запись текущего состояния открытого модуля в подсистему (Gs-15.5) */
    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Terminal")
    void FlushActiveModuleState();

    /** Обработка действия «Назад» (Esc / геймпад) по соглашению Gs-4 и D-1 */
    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Terminal")
    bool HandleBackAction();

    /** Проверяет наличие питания (10 MW) на силовой цепи */
    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Terminal")
    bool HasPower() const;

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Terminal")
    EFicsitAIHostState GetHostState() const { return HostContext.HostState; }

    /** Устанавливает модуль-фабрику для инстанцирования виджетов UI */
    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Terminal")
    void SetModuleFactory(TScriptInterface<IFicsitAIScreenModuleFactory> InFactory);

    /** Устанавливает поверхность экрана */
    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Terminal")
    void SetScreenSurface(TScriptInterface<IFicsitAIScreenSurface> InSurface);

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Terminal")
    TScriptInterface<IFicsitAIScreenSurface> GetScreenSurface() const { return ScreenSurface; }

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Terminal")
    TScriptInterface<IFicsitAIScreenModule> GetActiveModuleInstance() const { return ActiveModuleInstance; }

    /** Компонент информации о питании (10 MW) */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Power")
    TObjectPtr<UFGPowerInfoComponent> PowerInfoComponent;

    /** Компонент подключения силового кабеля */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Power")
    TObjectPtr<UFGPowerConnectionComponent> PowerConnectionComponent;

    /** Меш-заготовка терминала с экраном 16:9 */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UStaticMeshComponent> TerminalMeshComponent;

    /** Плоский меш экрана 16:9 на корпусе терминала (ADR-030, P-7 §1.1) */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UStaticMeshComponent> ScreenMeshComponent;

protected:
    UPROPERTY(ReplicatedUsing = OnRep_HostContext)
    FFicsitAIScreenContext HostContext;

    UPROPERTY(Replicated)
    FName ActiveModuleId = NAME_None;

    UPROPERTY()
    TScriptInterface<IFicsitAIScreenModule> ActiveModuleInstance;

    UPROPERTY()
    TScriptInterface<IFicsitAIScreenModuleFactory> ModuleFactory;

    UPROPERTY()
    TObjectPtr<class AFicsitAISubsystem> CustomSubsystem;

    UPROPERTY()
    TScriptInterface<IFicsitAIScreenSurface> ScreenSurface;

    UPROPERTY()
    TMap<FName, TScriptInterface<IFicsitAIScreenModule>> CachedModules;

    UPROPERTY(EditDefaultsOnly, Category = "Power")
    float TargetPowerConsumption = 10.0f;

    TOptional<bool> bPowerOverride;

    UFUNCTION()
    void OnRep_HostContext();

    void TeardownActiveModule();
};
