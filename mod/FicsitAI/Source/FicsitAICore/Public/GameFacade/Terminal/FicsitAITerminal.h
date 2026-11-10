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
    virtual void Tick(float DeltaSeconds) override;

    // IFGUseableInterface (интеракция с игроком по E)
    virtual void OnUse_Implementation(class AFGCharacterPlayer* byCharacter, const FUseState& state) override;
    virtual bool IsUseable_Implementation() const override;
    virtual void UpdateUseState_Implementation(class AFGCharacterPlayer* byCharacter, const FVector& atLocation, class UPrimitiveComponent* componentHit, FUseState& out_useState) override;

    // IFicsitAIScreenHost
    virtual const FFicsitAIScreenContext& GetHostContext() const override { return HostContext; }
    virtual EFicsitAIHostState GetHostState() const override;
    virtual bool OpenModule(FName ModuleId) override;
    virtual void CloseModule(FName ModuleId) override;
    virtual FName GetActiveModule() const override { return ActiveModuleId; }
    virtual void SetFocusToModule(bool bFocus) override;
    virtual void NotifyContentChanged() override;

    /** Проверяет наличие питания (10 MW) на силовой цепи */
    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Terminal")
    bool HasPower() const;

    /** Устанавливает модуль-фабрику для инстанцирования виджетов UI */
    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Terminal")
    void SetModuleFactory(TScriptInterface<IFicsitAIScreenModuleFactory> InFactory);

    /** Компонент информации о питании (10 MW) */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Power")
    TObjectPtr<UFGPowerInfoComponent> PowerInfoComponent;

    /** Компонент подключения силового кабеля */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Power")
    TObjectPtr<UFGPowerConnectionComponent> PowerConnectionComponent;

    /** Меш-заготовка терминала с экраном 16:9 */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UStaticMeshComponent> TerminalMeshComponent;

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
    TMap<FName, TScriptInterface<IFicsitAIScreenModule>> CachedModules;

    UFUNCTION()
    void OnRep_HostContext();

    void UpdateHostState();
};
