#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "IFicsitAIScreenHost.h"
#include "IFicsitAIScreenModule.h"
#include "FicsitAIScreenSurfaceWidget.generated.h"

/**
 * Виджет поверхности экрана (16:9) для отображения экранных модулей.
 * Архитектура: docs/interfaces/screen-host-and-module.md, ADR-026, ADR-030.
 * Живёт в FicsitAIUI, не зависит от FactoryGame/SML.
 */
UCLASS(BlueprintType)
class FICSITAIUI_API UFicsitAIScreenSurfaceWidget : public UUserWidget, public IFicsitAIScreenSurface
{
    GENERATED_BODY()

public:
    virtual void SetModule(TScriptInterface<IFicsitAIScreenModule> Module) override;
    virtual void ClearModule() override;

    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Surface")
    void SetHost(TScriptInterface<IFicsitAIScreenHost> InHost);

    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Surface")
    static UFicsitAIScreenSurfaceWidget* OpenForPlayer(class APlayerController* PC, TScriptInterface<IFicsitAIScreenHost> InHost, EFicsitAIHostState InState, TScriptInterface<IFicsitAIScreenModule> InModule);

    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Surface")
    static void CloseForPlayer(class APlayerController* PC);

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Surface")
    static bool IsOpenForPlayer(class APlayerController* PC);

    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Surface")
    void SetHostState(EFicsitAIHostState NewState);

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Surface")
    EFicsitAIHostState GetHostState() const { return CurrentHostState; }

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Surface")
    TScriptInterface<IFicsitAIScreenModule> GetActiveModule() const { return ActiveModule; }

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Surface")
    FText GetHeaderTitle() const { return HeaderTitle; }

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Surface")
    FText GetStatusMessage() const { return StatusMessage; }

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Surface")
    FText GetFormattedHotkeyHints() const;

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Surface")
    const TArray<FFicsitAIHotkeyHint>& GetHotkeyHints() const { return CurrentHotkeyHints; }

protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
    virtual FReply NativeOnKeyDown(const FGeometry& InGeometry, const FKeyEvent& InKeyEvent) override;
    virtual bool NativeSupportsKeyboardFocus() const override { return true; }

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Surface")
    TScriptInterface<IFicsitAIScreenHost> Host;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Surface")
    TScriptInterface<IFicsitAIScreenModule> ActiveModule;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Surface")
    EFicsitAIHostState CurrentHostState = EFicsitAIHostState::Ready;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Surface")
    FText HeaderTitle;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Surface")
    FText StatusMessage;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Surface")
    TArray<FFicsitAIHotkeyHint> CurrentHotkeyHints;

    TSharedPtr<class SBox> ModuleContentBox;
    TSharedPtr<class STextBlock> StatusTextBlock;
    TSharedPtr<class STextBlock> HeaderTextBlock;
    TSharedPtr<class STextBlock> FooterTextBlock;

    void UpdateLayout();
};
