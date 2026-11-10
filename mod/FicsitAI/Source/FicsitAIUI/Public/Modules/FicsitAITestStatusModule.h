#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "IFicsitAIScreenModule.h"
#include "FicsitAITestStatusModule.generated.h"

/**
 * Второй тестовый экранный модуль «Статус» для Spike S1 (AC-14).
 * Проверяет переключение между модулями в одном хосте.
 */
UCLASS(BlueprintType)
class FICSITAIUI_API UFicsitAITestStatusModule : public UUserWidget, public IFicsitAIScreenModule
{
    GENERATED_BODY()

public:
    virtual FName GetModuleId() const override { return FName(TEXT("Status")); }
    virtual FText GetDisplayName() const override { return NSLOCTEXT("FicsitAI", "StatusModuleTitle", "Статус"); }
    virtual uint8 GetSupportedLayouts() const override { return 0xFF; }
    virtual float GetPreferredAspectRatio() const override { return 16.0f / 9.0f; }

    virtual TArray<FFicsitAIHotkeyHint> GetHotkeyHints() const override;

    virtual void OnAttach(const FFicsitAIScreenContext& Context) override;
    virtual void OnDetach() override;
    virtual void OnContextChanged(const FFicsitAIScreenContext& NewContext) override;
    virtual void OnFocusGained() override;
    virtual void OnFocusLost() override;
    virtual bool HandleBackAction() override;
    virtual bool SavePersistentState(FString& OutJson) const override;
    virtual bool RestorePersistentState(const FString& InJson) override;

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Test")
    bool IsAttached() const { return bIsAttached; }

private:
    UPROPERTY()
    FFicsitAIScreenContext CurrentContext;

    bool bIsAttached = false;
    bool bHasFocus = false;
};
