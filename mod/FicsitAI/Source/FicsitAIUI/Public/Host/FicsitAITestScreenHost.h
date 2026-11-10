#pragma once

#include "CoreMinimal.h"
#include "UObject/NoExportTypes.h"
#include "IFicsitAIScreenHost.h"
#include "IFicsitAIScreenModule.h"
#include "FicsitAITestScreenHost.generated.h"

/**
 * Автономный тестовый хост экранных модулей (AC-14).
 * Живёт в FicsitAIUI, не зависит от FactoryGame/SML.
 * Используется в автотестах и Screen Lab для проверки модулей без игры.
 */
UCLASS(BlueprintType)
class FICSITAIUI_API UFicsitAITestScreenHost : public UObject, public IFicsitAIScreenHost
{
    GENERATED_BODY()

public:
    void InitializeTestHost(const FString& InSaveId, TScriptInterface<IFicsitAIScreenModuleFactory> InFactory);

    virtual const FFicsitAIScreenContext& GetHostContext() const override { return HostContext; }
    virtual EFicsitAIHostState GetHostState() const override { return HostContext.HostState; }
    virtual bool OpenModule(FName ModuleId) override;
    virtual void CloseModule(FName ModuleId) override;
    virtual FName GetActiveModule() const override { return ActiveModuleId; }
    virtual void SetFocusToModule(bool bFocus) override;
    virtual void NotifyContentChanged() override;

    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Test")
    void SetTestHostState(EFicsitAIHostState NewState);

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Test")
    TScriptInterface<IFicsitAIScreenModule> GetActiveModuleInstance() const { return ActiveModuleInstance; }

private:
    UPROPERTY()
    FFicsitAIScreenContext HostContext;

    UPROPERTY()
    FName ActiveModuleId = NAME_None;

    UPROPERTY()
    TScriptInterface<IFicsitAIScreenModule> ActiveModuleInstance;

    UPROPERTY()
    TScriptInterface<IFicsitAIScreenModuleFactory> ModuleFactory;

    // Кэш созданных экземпляров модулей
    UPROPERTY()
    TMap<FName, TScriptInterface<IFicsitAIScreenModule>> LoadedModules;
};
