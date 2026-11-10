#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "FicsitAIScreenTypes.h"
#include "IFicsitAIScreenModule.generated.h"

UINTERFACE(MinimalAPI, BlueprintType)
class UFicsitAIScreenModule : public UInterface
{
    GENERATED_BODY()
};

/**
 * Интерфейс экранного модуля (Chat, Dashboard, Notes, Status).
 * Описан в docs/interfaces/screen-host-and-module.md.
 */
class FICSITAIAPI_API IFicsitAIScreenModule
{
    GENERATED_BODY()

public:
    virtual FName GetModuleId() const = 0;
    virtual FText GetDisplayName() const = 0;
    virtual uint8 GetSupportedLayouts() const { return 0xFF; }
    virtual float GetPreferredAspectRatio() const { return 16.0f / 9.0f; }
    virtual TArray<FFicsitAIHotkeyHint> GetHotkeyHints() const { return {}; }

    virtual void OnAttach(const FFicsitAIScreenContext& Context) = 0;
    virtual void OnDetach() = 0;
    virtual void OnContextChanged(const FFicsitAIScreenContext& NewContext) = 0;
    virtual void OnFocusGained() {}
    virtual void OnFocusLost() {}
    virtual bool HandleBackAction() { return false; }
    virtual bool SavePersistentState(FString& OutJson) const { return false; }
    virtual bool RestorePersistentState(const FString& InJson) { return false; }
};

UINTERFACE(MinimalAPI, BlueprintType)
class UFicsitAIScreenModuleFactory : public UInterface
{
    GENERATED_BODY()
};

class FICSITAIAPI_API IFicsitAIScreenModuleFactory
{
    GENERATED_BODY()

public:
    virtual TScriptInterface<IFicsitAIScreenModule> CreateModuleWidget(FName ModuleId, UObject* Outer) = 0;
};
