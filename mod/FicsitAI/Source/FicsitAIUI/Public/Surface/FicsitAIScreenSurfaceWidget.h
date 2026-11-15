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

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Surface")
    TScriptInterface<IFicsitAIScreenHost> GetHost() const { return Host; }

    /** Проверяет, добавлен ли виджет поверхности в Viewport игрока */
    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Surface")
    bool IsSurfaceInViewport() const;

    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Surface")
    static UFicsitAIScreenSurfaceWidget* OpenForPlayer(class APlayerController* PC, TScriptInterface<IFicsitAIScreenHost> InHost, EFicsitAIHostState InState, TScriptInterface<IFicsitAIScreenModule> InModule);

    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Surface")
    static void CloseForPlayer(class APlayerController* PC);

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Surface")
    static bool IsOpenForPlayer(class APlayerController* PC);

    /** Получить активный виджет поверхности экрана игрока (nullptr, если закрыт) */
    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Surface")
    static UFicsitAIScreenSurfaceWidget* GetActivePlayerSurfaceWidget();

    DECLARE_DELEGATE(FOnCloseRequested);
    FOnCloseRequested OnCloseRequested;

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

    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Surface")
    void SetActionKeyBindings(const TMap<FName, FKey>& InBindings);

    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Surface")
    void SetActionKeyBinding(FName ActionId, FKey Key);

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Surface")
    FKey GetKeyForAction(FName ActionId) const;

    void RefreshModuleContent();

    /** Режим поверхности в мире (§6.6, ADR-030): скрывает полосу подсказок клавиш */
    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Surface")
    void SetWorldSurfaceMode(bool bInWorldSurface);

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Surface")
    bool IsWorldSurfaceMode() const { return bWorldSurfaceMode; }

    /** Отрисовать текущую композицию в offscreen Render Target (S8 3.4 / S1 / S4). Возвращает true при успешном рендере. */
    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Surface")
    bool RenderToTarget(class UTextureRenderTarget2D* Target, const FIntPoint& TargetSizePx, float DeltaTime = 0.0f);

    /** Создать offscreen-виджет поверхности экрана в мире с корректным PlayerContext/Initialize */
    static UFicsitAIScreenSurfaceWidget* CreateForWorldSurface(UObject* Outer);

    /** Создать offscreen Render Target заданного размера 16:9 (nullptr в -NullRHI / без Slate) */
    static class UTextureRenderTarget2D* CreateWorldRenderTarget(UObject* Outer, const FIntPoint& SizePx);

    /** Получить фактический размер области модуля в пикселях раскладки (ModuleContentBox) */
    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Surface")
    FIntPoint GetModuleAreaSizePx() const;

    /** Получить соотношение сторон области модуля (ModuleContentBox) */
    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Surface")
    float GetModuleAreaAspectRatio() const;

    /** Задать размер виртуального полотна интерфейса (по умолчанию 1920x1080) */
    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Surface")
    void SetCanvasSize(const FVector2D& InCanvasSize);

    /** Выполнить реальную раскладку Slate в виртуальном окне заданного размера (для автотестов и offscreen-рендера) */
    void LayoutInVirtualWindow(const FVector2D& LayoutSize);

    /** Обновить геометрию области модуля из раскладки Slate */
    void UpdateModuleContentAreaGeometry();

    /** Освободить ресурсы поверхности в мире (окно, renderer, модуль) для разрыва Slate <-> UMG GC-циклов (P1) */
    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Surface")
    void ReleaseWorldSurfaceResources();

    virtual void BeginDestroy() override;

protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
    virtual void NativeTick(const FGeometry& MyGeometry, float InDeltaTime) override;
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

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Surface")
    bool bWorldSurfaceMode = false;

    UPROPERTY()
    TMap<FName, FKey> ActionKeyBindings;

    TSharedPtr<class SBorder> OuterBorder;
    TSharedPtr<class SBorder> HeaderBorder;
    TSharedPtr<class SBox> CanvasBox;
    TSharedPtr<class SBox> ModuleContentBox;
    TSharedPtr<class STextBlock> StatusTextBlock;
    TSharedPtr<class STextBlock> HeaderTextBlock;
    TSharedPtr<class STextBlock> FooterTextBlock;
    TSharedPtr<class SBorder> FooterBorder;
    TSharedPtr<class SVirtualWindow> WorldVirtualWindow;

    FVector2D CanvasSize = FVector2D(1920.0f, 1080.0f);
    FIntPoint CachedModuleAreaSizePx = FIntPoint::ZeroValue;
    float CachedModuleAreaAspectRatio = 0.0f;

    class FWidgetRenderer* WorldWidgetRenderer = nullptr;

    void UpdateLayout();
};
