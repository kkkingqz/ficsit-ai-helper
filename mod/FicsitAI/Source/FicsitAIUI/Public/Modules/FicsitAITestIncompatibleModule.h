#pragma once

#include "CoreMinimal.h"
#include "UObject/NoExportTypes.h"
#include "IFicsitAIScreenModule.h"
#include "FicsitAITestIncompatibleModule.generated.h"

/**
 * Тестовый экранный модуль с несовместимой мажорной версией API (2.0.0 vs 0.3.0).
 * Используется для проверки отказа в открытии до вызова OnAttach (§5.5, Gs-15.4).
 */
UCLASS(BlueprintType)
class FICSITAIUI_API UFicsitAITestIncompatibleModule : public UObject, public IFicsitAIScreenModule
{
    GENERATED_BODY()

public:
    virtual FName GetModuleId() const override { return FName(TEXT("Incompatible")); }
    virtual FString GetRequiredApiVersion() const override { return TEXT("2.0.0"); }
    virtual FText GetDisplayName() const override { return NSLOCTEXT("FicsitAI", "IncompatibleTitle", "Несовместимый"); }

    virtual void OnAttach(const FFicsitAIScreenContext& Context) override { bAttached = true; }
    virtual void OnContextChanged(const FFicsitAIScreenContext& Context) override {}
    virtual void OnDetach() override { bAttached = false; }

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Test")
    bool IsAttached() const { return bAttached; }

private:
    bool bAttached = false;
};
