#include "Surface/FicsitAIScreenSurfaceWidget.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SScaleBox.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SVirtualWindow.h"
#include "Rendering/SlateDrawBuffer.h"
#include "GameFramework/PlayerController.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Slate/WidgetRenderer.h"
#include "Framework/Application/SlateApplication.h"
#include "RenderDeferredCleanup.h"

static TWeakObjectPtr<UFicsitAIScreenSurfaceWidget> ActivePlayerSurfaceWidget = nullptr;

UFicsitAIScreenSurfaceWidget* UFicsitAIScreenSurfaceWidget::OpenForPlayer(APlayerController* PC, TScriptInterface<IFicsitAIScreenHost> InHost, EFicsitAIHostState InState, TScriptInterface<IFicsitAIScreenModule> InModule)
{
    if (!PC || !PC->IsLocalController())
    {
        return nullptr;
    }

    UFicsitAIScreenSurfaceWidget* Widget = ActivePlayerSurfaceWidget.Get();
    if (!Widget || Widget->GetOwningPlayer() != PC)
    {
        Widget = CreateWidget<UFicsitAIScreenSurfaceWidget>(PC, UFicsitAIScreenSurfaceWidget::StaticClass());
        ActivePlayerSurfaceWidget = Widget;
    }

    if (Widget)
    {
        Widget->SetHost(InHost);
        Widget->SetWorldSurfaceMode(false);
        Widget->SetHostState(InState);
        if (InModule)
        {
            Widget->SetModule(InModule);
        }
        else
        {
            Widget->ClearModule();
        }

        if (!Widget->IsInViewport())
        {
            Widget->AddToViewport(100);
        }

        FInputModeGameAndUI InputMode;
        InputMode.SetWidgetToFocus(Widget->TakeWidget());
        InputMode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
        PC->SetInputMode(InputMode);
        PC->bShowMouseCursor = true;
    }

    return Widget;
}

void UFicsitAIScreenSurfaceWidget::CloseForPlayer(APlayerController* PC)
{
    UFicsitAIScreenSurfaceWidget* Widget = ActivePlayerSurfaceWidget.Get();
    if (!Widget || (PC && Widget->GetOwningPlayer() != PC))
    {
        return;
    }

    Widget->ClearModule();
    Widget->RemoveFromParent();
    ActivePlayerSurfaceWidget.Reset();
    if (PC && PC->IsLocalController())
    {
        PC->SetInputMode(FInputModeGameOnly());
        PC->bShowMouseCursor = false;
    }
}

UFicsitAIScreenSurfaceWidget* UFicsitAIScreenSurfaceWidget::GetActivePlayerSurfaceWidget()
{
    return ActivePlayerSurfaceWidget.Get();
}

bool UFicsitAIScreenSurfaceWidget::IsOpenForPlayer(APlayerController* PC)
{
    const UFicsitAIScreenSurfaceWidget* Widget = ActivePlayerSurfaceWidget.Get();
    return PC && Widget && Widget->GetOwningPlayer() == PC && Widget->IsInViewport();
}

bool UFicsitAIScreenSurfaceWidget::IsSurfaceInViewport() const
{
    return IsInViewport();
}

void UFicsitAIScreenSurfaceWidget::SetHost(TScriptInterface<IFicsitAIScreenHost> InHost)
{
    Host = InHost;
}

void UFicsitAIScreenSurfaceWidget::SetWorldSurfaceMode(bool bInWorldSurface)
{
    if (bWorldSurfaceMode != bInWorldSurface)
    {
        bWorldSurfaceMode = bInWorldSurface;
        CanvasSize = bWorldSurfaceMode ? FVector2D(1280.0f, 720.0f) : FVector2D(1920.0f, 1080.0f);
        UpdateLayout();
        UpdateModuleContentAreaGeometry();
        RefreshModuleContent();
    }
}

UFicsitAIScreenSurfaceWidget* UFicsitAIScreenSurfaceWidget::CreateForWorldSurface(UObject* Outer)
{
    UWorld* World = Outer ? Outer->GetWorld() : nullptr;
    UFicsitAIScreenSurfaceWidget* Widget = nullptr;
    if (World && World->IsGameWorld() && !World->bIsTearingDown)
    {
        Widget = CreateWidget<UFicsitAIScreenSurfaceWidget>(World, UFicsitAIScreenSurfaceWidget::StaticClass());
    }
    if (!Widget)
    {
        Widget = NewObject<UFicsitAIScreenSurfaceWidget>(Outer ? Outer : GetTransientPackage());
        if (Widget)
        {
            Widget->Initialize();
        }
    }
    if (Widget)
    {
        Widget->SetWorldSurfaceMode(true);
        Widget->SetCanvasSize(FVector2D(1280.0f, 720.0f));
        Widget->UpdateModuleContentAreaGeometry();
    }
    return Widget;
}

bool UFicsitAIScreenSurfaceWidget::RenderToTarget(UTextureRenderTarget2D* Target, const FIntPoint& TargetSizePx, float DeltaTime)
{
    if (!Target || TargetSizePx.X <= 0 || TargetSizePx.Y <= 0 || GUsingNullRHI || !FSlateApplication::IsInitialized())
    {
        return false;
    }

    FSlateRenderer* SlateRenderer = FSlateApplication::Get().GetRenderer();
    if (!SlateRenderer)
    {
        return false;
    }

    Initialize();

    FTextureRenderTargetResource* TargetResource = Target->GameThread_GetRenderTargetResource();
    if (!TargetResource)
    {
        Target->UpdateResourceImmediate(true);
        TargetResource = Target->GameThread_GetRenderTargetResource();
        if (!TargetResource)
        {
            return false;
        }
    }

    const FVector2D DrawSize(static_cast<float>(TargetSizePx.X), static_cast<float>(TargetSizePx.Y));
    const TSharedRef<SWidget> RootSlate = TakeWidget();
    if (!WorldVirtualWindow.IsValid())
    {
        WorldVirtualWindow = SNew(SVirtualWindow).Size(DrawSize);
        WorldVirtualWindow->SetContent(RootSlate);
    }
    WorldVirtualWindow->Resize(DrawSize);

    if (!WorldWidgetRenderer)
    {
        WorldWidgetRenderer = new FWidgetRenderer(false, true);
    }

    WorldWidgetRenderer->DrawWindow(
        TargetResource,
        WorldVirtualWindow->GetHittestGrid(),
        WorldVirtualWindow.ToSharedRef(),
        1.0f,
        DrawSize,
        DeltaTime,
        false
    );
    return true;
}

UTextureRenderTarget2D* UFicsitAIScreenSurfaceWidget::CreateWorldRenderTarget(UObject* Outer, const FIntPoint& SizePx)
{
    if (SizePx.X <= 0 || SizePx.Y <= 0 || GUsingNullRHI || !FSlateApplication::IsInitialized())
    {
        return nullptr;
    }

    FSlateRenderer* SlateRenderer = FSlateApplication::Get().GetRenderer();
    if (!SlateRenderer)
    {
        return nullptr;
    }

    const EPixelFormat RequestedFormat = SlateRenderer->GetSlateRecommendedColorFormat();
    UTextureRenderTarget2D* Target = NewObject<UTextureRenderTarget2D>(Outer ? Outer : GetTransientPackage());
    if (!Target)
    {
        return nullptr;
    }

    Target->Filter = TF_Bilinear;
    Target->ClearColor = FLinearColor(0.0f, 0.0f, 0.0f, 1.0f);
    Target->SRGB = true;
    Target->TargetGamma = 1.0f;
    Target->InitCustomFormat(SizePx.X, SizePx.Y, RequestedFormat, true);
    Target->UpdateResourceImmediate(true);
    return Target;
}

void UFicsitAIScreenSurfaceWidget::ReleaseWorldSurfaceResources()
{
    ClearModule();
    Host = nullptr;

    if (WorldVirtualWindow.IsValid())
    {
        WorldVirtualWindow->SetContent(SNullWidget::NullWidget);
        WorldVirtualWindow.Reset();
    }
    if (WorldWidgetRenderer)
    {
        BeginCleanup(WorldWidgetRenderer);
        WorldWidgetRenderer = nullptr;
    }
}

void UFicsitAIScreenSurfaceWidget::BeginDestroy()
{
    ReleaseWorldSurfaceResources();
    Super::BeginDestroy();
}

void UFicsitAIScreenSurfaceWidget::SetActionKeyBindings(const TMap<FName, FKey>& InBindings)
{
    ActionKeyBindings = InBindings;
    UpdateLayout();
}

void UFicsitAIScreenSurfaceWidget::SetActionKeyBinding(FName ActionId, FKey Key)
{
    ActionKeyBindings.Add(ActionId, Key);
    UpdateLayout();
}

FKey UFicsitAIScreenSurfaceWidget::GetKeyForAction(FName ActionId) const
{
    if (const FKey* Found = ActionKeyBindings.Find(ActionId))
    {
        return *Found;
    }

    if (ActionId == FName(TEXT("IA_FicsitAI_Back")))
    {
        return EKeys::Escape;
    }
    if (ActionId == FName(TEXT("IA_FicsitAI_OpenTerminal")))
    {
        return EKeys::E;
    }
    if (ActionId == FName(TEXT("IA_FicsitAI_Notes")))
    {
        return EKeys::F;
    }
    if (ActionId == FName(TEXT("IA_FicsitAI_Status")))
    {
        return EKeys::R;
    }

    return EKeys::Invalid;
}

void UFicsitAIScreenSurfaceWidget::RefreshModuleContent()
{
    if (!ModuleContentBox.IsValid())
    {
        return;
    }

    if (CurrentHostState != EFicsitAIHostState::Ready)
    {
        ModuleContentBox->SetContent(
            SAssignNew(StatusTextBlock, STextBlock)
            .Text_UObject(this, &UFicsitAIScreenSurfaceWidget::GetStatusMessage)
            .Font(FCoreStyle::GetDefaultFontStyle("Bold", 20))
            .ColorAndOpacity(FLinearColor(0.95f, 0.3f, 0.2f, 1.0f))
        );
        return;
    }

    if (ActiveModule)
    {
        if (UUserWidget* ModuleWidget = Cast<UUserWidget>(ActiveModule.GetObject()))
        {
            if (GetPlayerContext().IsValid())
            {
                ModuleWidget->SetPlayerContext(GetPlayerContext());
            }
            ModuleWidget->Initialize();
            ModuleContentBox->SetContent(ModuleWidget->TakeWidget());
            return;
        }
    }

    ModuleContentBox->SetContent(
        SAssignNew(StatusTextBlock, STextBlock)
        .Text_UObject(this, &UFicsitAIScreenSurfaceWidget::GetStatusMessage)
        .Font(FCoreStyle::GetDefaultFontStyle("Regular", 16))
        .ColorAndOpacity(FLinearColor(0.7f, 0.7f, 0.7f, 1.0f))
    );
}

void UFicsitAIScreenSurfaceWidget::SetModule(TScriptInterface<IFicsitAIScreenModule> Module)
{
    ActiveModule = Module;
    UpdateLayout();
    RefreshModuleContent();
}

void UFicsitAIScreenSurfaceWidget::ClearModule()
{
    ActiveModule = nullptr;
    UpdateLayout();
    RefreshModuleContent();
}

void UFicsitAIScreenSurfaceWidget::SetHostState(EFicsitAIHostState NewState)
{
    CurrentHostState = NewState;
    UpdateLayout();
    RefreshModuleContent();
}

void UFicsitAIScreenSurfaceWidget::UpdateLayout()
{
    CurrentHotkeyHints.Empty();

    if (OuterBorder.IsValid())
    {
        OuterBorder->SetPadding(bWorldSurfaceMode ? FMargin(0.0f) : FMargin(20.0f));
    }
    if (HeaderBorder.IsValid())
    {
        // На экране в мире (§6.6, Co3-2) верхняя полоса статуса отображается обязательно
        HeaderBorder->SetVisibility(EVisibility::Visible);
    }
    if (FooterBorder.IsValid())
    {
        // На экране в мире (§6.6, Co3-2) нижняя полоса подсказок клавиш не отображается
        FooterBorder->SetVisibility(bWorldSurfaceMode ? EVisibility::Collapsed : EVisibility::Visible);
    }

    if (CurrentHostState == EFicsitAIHostState::NoPower)
    {
        HeaderTitle = NSLOCTEXT("FicsitAI", "NoPowerHeader", "FICSIT AI — ЭКРАН");
        StatusMessage = NSLOCTEXT("FicsitAI", "NoPowerMessage", "ПИТАНИЕ ОТКЛЮЧЕНО (ТРЕБУЕТСЯ 10 МВт)");
        return;
    }

    if (CurrentHostState == EFicsitAIHostState::Inert)
    {
        HeaderTitle = NSLOCTEXT("FicsitAI", "InertHeader", "FICSIT AI — ЭКРАН");
        StatusMessage = NSLOCTEXT("FicsitAI", "InertMessage", "ИНЕРТНЫЙ РЕЖИМ (МУЛЬТИПЛЕЕРНАЯ СЕССИЯ АКТИВНА)");
        return;
    }

    StatusMessage = FText::GetEmpty();

    if (ActiveModule)
    {
        HeaderTitle = ActiveModule->GetDisplayName();
        CurrentHotkeyHints = ActiveModule->GetHotkeyHints();
    }
    else
    {
        HeaderTitle = NSLOCTEXT("FicsitAI", "IdleHeader", "FICSIT AI — ЭКРАН ГОТОВ");
    }

    // Всегда добавляем Esc в подсказки
    FFicsitAIHotkeyHint BackHint;
    BackHint.ActionId = FName(TEXT("IA_FicsitAI_Back"));
    BackHint.Label = NSLOCTEXT("FicsitAI", "BackHint", "Назад / Закрыть");
    CurrentHotkeyHints.Add(BackHint);
}

FText UFicsitAIScreenSurfaceWidget::GetFormattedHotkeyHints() const
{
    auto FormatKey = [](const FKey& Key, const FName& ActionId) -> FString
    {
        if (Key == EKeys::Escape)
        {
            return TEXT("Esc");
        }
        if (Key.IsValid())
        {
            return Key.GetDisplayName(false).ToString();
        }
        return ActionId.ToString();
    };

    FString Result;
    for (int32 i = 0; i < CurrentHotkeyHints.Num(); ++i)
    {
        if (i > 0)
        {
            Result += TEXT("  |  ");
        }
        const FName ActionId = CurrentHotkeyHints[i].ActionId;
        const FKey MappedKey = GetKeyForAction(ActionId);
        const FString KeyName = FormatKey(MappedKey, ActionId);
        Result += FString::Printf(TEXT("[%s] %s"), *KeyName, *CurrentHotkeyHints[i].Label.ToString());
    }
    if (Result.IsEmpty())
    {
        const FString KeyOpen = FormatKey(GetKeyForAction(FName(TEXT("IA_FicsitAI_OpenTerminal"))), FName(TEXT("IA_FicsitAI_OpenTerminal")));
        const FString KeyNotes = FormatKey(GetKeyForAction(FName(TEXT("IA_FicsitAI_Notes"))), FName(TEXT("IA_FicsitAI_Notes")));
        const FString KeyStatus = FormatKey(GetKeyForAction(FName(TEXT("IA_FicsitAI_Status"))), FName(TEXT("IA_FicsitAI_Status")));
        const FString KeyBack = FormatKey(GetKeyForAction(FName(TEXT("IA_FicsitAI_Back"))), FName(TEXT("IA_FicsitAI_Back")));
        Result = FString::Printf(TEXT("[%s] Закрыть | [%s] Заметки | [%s] Статус | [%s] Назад"), *KeyOpen, *KeyNotes, *KeyStatus, *KeyBack);
    }
    return FText::FromString(Result);
}

TSharedRef<SWidget> UFicsitAIScreenSurfaceWidget::RebuildWidget()
{
    TSharedRef<SWidget> Widget = SNew(SScaleBox)
        .Stretch(EStretch::ScaleToFit)
        [
            SAssignNew(CanvasBox, SBox)
            .WidthOverride_Lambda([this]() { return CanvasSize.X; })
            .HeightOverride_Lambda([this]() { return CanvasSize.Y; })
            [
                SAssignNew(OuterBorder, SBorder)
                .BorderBackgroundColor(FLinearColor(0.02f, 0.02f, 0.03f, 0.95f))
                .Padding_Lambda([this]() { return bWorldSurfaceMode ? FMargin(0.0f) : FMargin(20.0f); })
                [
                    SNew(SVerticalBox)
                    // Верхняя полоса (Header: отображается как на меше терминала по §6.6 Co3-2, так и в интерактивном режиме)
                    + SVerticalBox::Slot()
                    .AutoHeight()
                    .Padding(TAttribute<FMargin>::CreateLambda([this]() { return FMargin(0.0f, 0.0f, 0.0f, 10.0f); }))
                    [
                        SAssignNew(HeaderBorder, SBorder)
                        .BorderBackgroundColor(FLinearColor(0.08f, 0.08f, 0.12f, 1.0f))
                        .Padding(FMargin(16.0f, 0.0f))
                        [
                            SNew(SBox)
                            .HeightOverride(38.0f)
                            .VAlign(VAlign_Center)
                            [
                                SAssignNew(HeaderTextBlock, STextBlock)
                                .Text_UObject(this, &UFicsitAIScreenSurfaceWidget::GetHeaderTitle)
                                .ColorAndOpacity(FLinearColor::White)
                            ]
                        ]
                    ]
                    // Основная область модуля (16:9 на меше терминала)
                    + SVerticalBox::Slot()
                    .FillHeight(1.0f)
                    .Padding(TAttribute<FMargin>::CreateLambda([this]() { return bWorldSurfaceMode ? FMargin(0.0f) : FMargin(0.0f, 10.0f); }))
                    [
                        SAssignNew(ModuleContentBox, SBox)
                        .HAlign(HAlign_Fill)
                        .VAlign(VAlign_Fill)
                        [
                            SAssignNew(StatusTextBlock, STextBlock)
                            .Text_UObject(this, &UFicsitAIScreenSurfaceWidget::GetStatusMessage)
                            .ColorAndOpacity(FLinearColor(0.9f, 0.3f, 0.2f, 1.0f))
                        ]
                    ]
                    // Нижняя полоса клавиш (Footer, 36px; скрывается в bWorldSurfaceMode)
                    + SVerticalBox::Slot()
                    .AutoHeight()
                    .Padding(TAttribute<FMargin>::CreateLambda([this]() { return bWorldSurfaceMode ? FMargin(0.0f) : FMargin(0.0f, 10.0f, 0.0f, 0.0f); }))
                    [
                        SAssignNew(FooterBorder, SBorder)
                        .BorderBackgroundColor(FLinearColor(0.05f, 0.05f, 0.08f, 1.0f))
                        .Padding(FMargin(16.0f, 0.0f))
                        [
                            SNew(SBox)
                            .HeightOverride(26.0f)
                            .VAlign(VAlign_Center)
                            [
                                SAssignNew(FooterTextBlock, STextBlock)
                                .Text_UObject(this, &UFicsitAIScreenSurfaceWidget::GetFormattedHotkeyHints)
                                .ColorAndOpacity(FLinearColor(0.7f, 0.7f, 0.7f, 1.0f))
                            ]
                        ]
                    ]
                ]
            ]
        ];

    UpdateLayout();
    RefreshModuleContent();
    UpdateModuleContentAreaGeometry();
    return Widget;
}

void UFicsitAIScreenSurfaceWidget::SetCanvasSize(const FVector2D& InCanvasSize)
{
    if (InCanvasSize.X > 0.0f && InCanvasSize.Y > 0.0f)
    {
        CanvasSize = InCanvasSize;
        if (CanvasBox.IsValid())
        {
            CanvasBox->SetWidthOverride(CanvasSize.X);
            CanvasBox->SetHeightOverride(CanvasSize.Y);
        }
        UpdateModuleContentAreaGeometry();
    }
}

void UFicsitAIScreenSurfaceWidget::LayoutInVirtualWindow(const FVector2D& LayoutSize)
{
    SetCanvasSize(LayoutSize);
    const TSharedRef<SWidget> RootSlate = TakeWidget();
    TSharedRef<SVirtualWindow> TempVirtualWindow = SNew(SVirtualWindow).Size(LayoutSize);
    TempVirtualWindow->SetContent(RootSlate);

    // SScaleBox кэширует LastPaintGeometry с предыдущего кадра отрисовки (см. SScaleBox.cpp:244);
    // для корректного расчёта масштаба при динамической смене размера окна требуется 2 прохода layout & paint
    for (int32 Pass = 0; Pass < 2; ++Pass)
    {
        TempVirtualWindow->SlatePrepass(1.0f);

        FSlateDrawBuffer DrawBuffer;
        if (DrawBuffer.Lock())
        {
            FSlateWindowElementList& WindowElementList = DrawBuffer.AddWindowElementList(TempVirtualWindow);
            TempVirtualWindow->PaintWindow(FApp::GetCurrentTime(), 0.0f, WindowElementList, FWidgetStyle(), true);
            DrawBuffer.Unlock();
        }
    }

    UpdateModuleContentAreaGeometry();

    // Отсоединяем содержимое окна, чтобы не удерживать SObjectWidget / UUserWidget
    TempVirtualWindow->SetContent(SNullWidget::NullWidget);
}

void UFicsitAIScreenSurfaceWidget::UpdateModuleContentAreaGeometry()
{
    FIntPoint NewSize = FIntPoint::ZeroValue;

    if (ModuleContentBox.IsValid())
    {
        // Приоритет - фактическая геометрия после раскладки и отрисовки (PaintSpace / AllottedGeometry)
        // GetAbsoluteSize() возвращает пиксели целевой поверхности с учётом SScaleBox и DPI масштаба
        const FVector2D PaintAbsSize = ModuleContentBox->GetPaintSpaceGeometry().GetAbsoluteSize();
        if (PaintAbsSize.X > 1.0f && PaintAbsSize.Y > 1.0f)
        {
            NewSize = FIntPoint(FMath::RoundToInt(PaintAbsSize.X), FMath::RoundToInt(PaintAbsSize.Y));
        }
        else
        {
            const FVector2D TickAbsSize = ModuleContentBox->GetTickSpaceGeometry().GetAbsoluteSize();
            if (TickAbsSize.X > 1.0f && TickAbsSize.Y > 1.0f)
            {
                NewSize = FIntPoint(FMath::RoundToInt(TickAbsSize.X), FMath::RoundToInt(TickAbsSize.Y));
            }
        }
    }

    if (NewSize.X <= 0 || NewSize.Y <= 0)
    {
        if (bWorldSurfaceMode)
        {
            // На меше терминала (1280x720) верхняя полоса статуса занимает 48px (38px + 10px отступ),
            // нижняя полоса клавиш свернута (0px), внешняя рамка 0px (§6.6 по Co3-2)
            const int32 ContentWidth = FMath::RoundToInt(CanvasSize.X);
            const int32 ContentHeight = FMath::RoundToInt(CanvasSize.Y) - 48;
            NewSize = FIntPoint(ContentWidth, ContentHeight);
        }
        else
        {
            // В интерактивном режиме учитываем рамку, заголовок и полосу подсказок
            const int32 ContentWidth = FMath::Max(100, FMath::RoundToInt(CanvasSize.X) - 40);
            const int32 NonContentHeight = 40 + 48 + 20 + 36;
            const int32 ContentHeight = FMath::Max(100, FMath::RoundToInt(CanvasSize.Y) - NonContentHeight);
            NewSize = FIntPoint(ContentWidth, ContentHeight);
        }
    }

    const float NewAspect = (NewSize.Y > 0) ? (static_cast<float>(NewSize.X) / static_cast<float>(NewSize.Y)) : (16.0f / 9.0f);

    if (NewSize != CachedModuleAreaSizePx || !FMath::IsNearlyEqual(NewAspect, CachedModuleAreaAspectRatio, 0.001f))
    {
        CachedModuleAreaSizePx = NewSize;
        CachedModuleAreaAspectRatio = NewAspect;

        if (ActiveModule && Host)
        {
            FFicsitAIScreenContext Context = Host->GetScreenContext();
            Context.SizePx = CachedModuleAreaSizePx;
            Context.AspectRatio = CachedModuleAreaAspectRatio;
            Context.bWorldSurface = bWorldSurfaceMode;
            ActiveModule->OnContextChanged(Context);
        }
    }
}

void UFicsitAIScreenSurfaceWidget::NativeTick(const FGeometry& MyGeometry, float InDeltaTime)
{
    Super::NativeTick(MyGeometry, InDeltaTime);
    UpdateModuleContentAreaGeometry();
}

FIntPoint UFicsitAIScreenSurfaceWidget::GetModuleAreaSizePx() const
{
    if (CachedModuleAreaSizePx.X > 0 && CachedModuleAreaSizePx.Y > 0)
    {
        return CachedModuleAreaSizePx;
    }
    if (bWorldSurfaceMode)
    {
        const int32 ContentWidth = FMath::RoundToInt(CanvasSize.X);
        const int32 ContentHeight = FMath::RoundToInt(CanvasSize.Y) - 48;
        return FIntPoint(ContentWidth, ContentHeight);
    }
    const int32 ContentWidth = FMath::Max(100, FMath::RoundToInt(CanvasSize.X) - 40);
    const int32 NonContentHeight = 40 + 48 + 20 + 36;
    const int32 ContentHeight = FMath::Max(100, FMath::RoundToInt(CanvasSize.Y) - NonContentHeight);
    return FIntPoint(ContentWidth, ContentHeight);
}

float UFicsitAIScreenSurfaceWidget::GetModuleAreaAspectRatio() const
{
    if (CachedModuleAreaAspectRatio > 0.01f)
    {
        return CachedModuleAreaAspectRatio;
    }
    const FIntPoint Size = GetModuleAreaSizePx();
    return (Size.Y > 0) ? (static_cast<float>(Size.X) / static_cast<float>(Size.Y)) : (16.0f / 9.0f);
}

FReply UFicsitAIScreenSurfaceWidget::NativeOnKeyDown(const FGeometry& InGeometry, const FKeyEvent& InKeyEvent)
{
    const FKey Key = InKeyEvent.GetKey();

    const FKey BackKey = GetKeyForAction(FName(TEXT("IA_FicsitAI_Back")));
    const FKey OpenKey = GetKeyForAction(FName(TEXT("IA_FicsitAI_OpenTerminal")));
    const FKey NotesKey = GetKeyForAction(FName(TEXT("IA_FicsitAI_Notes")));
    const FKey StatusKey = GetKeyForAction(FName(TEXT("IA_FicsitAI_Status")));

    const bool bCloseKey = Key == EKeys::Escape
        || (BackKey.IsValid() && Key == BackKey) || (OpenKey.IsValid() && Key == OpenKey);
    const bool bNotesKey = NotesKey.IsValid() && Key == NotesKey;
    const bool bStatusKey = StatusKey.IsValid() && Key == StatusKey;
    if (InKeyEvent.IsRepeat() && (bCloseKey || bNotesKey || bStatusKey))
    {
        return FReply::Handled();
    }

    if (bCloseKey)
    {
        if (ActiveModule && ActiveModule->HandleBackAction())
        {
            return FReply::Handled();
        }
        if (OnCloseRequested.IsBound())
        {
            OnCloseRequested.Execute();
            return FReply::Handled();
        }
        if (Host)
        {
            Host->CloseActiveModule();
        }
        else
        {
            CloseForPlayer(GetOwningPlayer());
        }
        return FReply::Handled();
    }
    else if (bNotesKey)
    {
        if (Host)
        {
            Host->OpenModule(FName(TEXT("Notes")));
            return FReply::Handled();
        }
    }
    else if (bStatusKey)
    {
        if (Host)
        {
            Host->OpenModule(FName(TEXT("Status")));
            return FReply::Handled();
        }
    }

    return Super::NativeOnKeyDown(InGeometry, InKeyEvent);
}
