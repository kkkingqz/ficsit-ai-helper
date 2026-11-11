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
    virtual FString GetRequiredApiVersion() const override { return TEXT("0.3.0"); }
    virtual FText GetDisplayName() const override { return NSLOCTEXT("FicsitAI", "StatusModuleTitle", "Статус"); }
    virtual TArray<FFicsitAIHotkeyHint> GetHotkeyHints() const override;

    virtual void OnAttach(const FFicsitAIScreenContext& Context) override;
    virtual void OnContextChanged(const FFicsitAIScreenContext& Context) override;
    virtual void OnDetach() override;

    virtual FString SavePersistentState() const override;
    virtual void RestorePersistentState(const FString& State) override;
    virtual bool WantsInputFocus() const override { return false; }
    virtual bool HandleBackAction() override;

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Test")
    bool IsAttached() const { return bIsAttached; }

protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;

private:
    UPROPERTY()
    FFicsitAIScreenContext CurrentContext;

    bool bIsAttached = false;
    bool bHasFocus = false;
};
