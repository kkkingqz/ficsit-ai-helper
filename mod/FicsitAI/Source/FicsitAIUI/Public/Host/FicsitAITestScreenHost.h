#pragma once

#include "CoreMinimal.h"
#include "UObject/NoExportTypes.h"
#include "IFicsitAIScreenHost.h"
#include "IFicsitAIScreenModule.h"
#include "Surface/FicsitAIScreenSurfaceWidget.h"
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

    // IFicsitAIScreenHost
    virtual FFicsitAIScreenContext GetScreenContext() const override { return HostContext; }
    virtual TArray<FName> GetAvailableModules() const override;
    virtual bool OpenModule(FName ModuleId) override;
    virtual void CloseActiveModule() override;
    virtual FName GetActiveModuleId() const override { return ActiveModuleId; }
    virtual void RequestInputFocus(bool bWanted) override;
    virtual void NotifyContentChanged() override;

    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Test")
    void SetTestHostState(EFicsitAIHostState NewState);

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Test")
    EFicsitAIHostState GetHostState() const { return HostContext.HostState; }

    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Test")
    bool HandleBackAction();

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Test")
    TScriptInterface<IFicsitAIScreenModule> GetActiveModuleInstance() const { return ActiveModuleInstance; }

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Test")
    TScriptInterface<IFicsitAIScreenSurface> GetScreenSurface() const { return ScreenSurface; }

    const TMap<FName, FString>& GetModulePersistentStates() const { return ModulePersistentStates; }
    const TMap<FName, TScriptInterface<IFicsitAIScreenModule>>& GetLoadedModules() const { return LoadedModules; }

private:
    UPROPERTY()
    FFicsitAIScreenContext HostContext;

    UPROPERTY()
    FName ActiveModuleId = NAME_None;

    UPROPERTY()
    TScriptInterface<IFicsitAIScreenModule> ActiveModuleInstance;

    UPROPERTY()
    TScriptInterface<IFicsitAIScreenModuleFactory> ModuleFactory;

    UPROPERTY()
    TScriptInterface<IFicsitAIScreenSurface> ScreenSurface;

    // Кэш созданных экземпляров модулей
    UPROPERTY()
    TMap<FName, TScriptInterface<IFicsitAIScreenModule>> LoadedModules;

    // Сохранённое персистентное состояние модулей (AC-14)
    UPROPERTY()
    TMap<FName, FString> ModulePersistentStates;
};
