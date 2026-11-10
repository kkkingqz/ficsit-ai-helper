#include "Surface/FicsitAIScreenSurfaceWidget.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/SBoxPanel.h"
#include "GameFramework/PlayerController.h"

static TWeakObjectPtr<UFicsitAIScreenSurfaceWidget> ActivePlayerSurfaceWidget = nullptr;

UFicsitAIScreenSurfaceWidget* UFicsitAIScreenSurfaceWidget::OpenForPlayer(APlayerController* PC, TScriptInterface<IFicsitAIScreenHost> InHost, EFicsitAIHostState InState, TScriptInterface<IFicsitAIScreenModule> InModule)
{
    if (!PC || !PC->IsLocalController())
    {
        return nullptr;
    }

    UFicsitAIScreenSurfaceWidget* Widget = ActivePlayerSurfaceWidget.Get();
    if (!Widget || !Widget->IsValidLowLevelFast())
    {
        Widget = CreateWidget<UFicsitAIScreenSurfaceWidget>(PC, UFicsitAIScreenSurfaceWidget::StaticClass());
        ActivePlayerSurfaceWidget = Widget;
    }

    if (Widget)
    {
        Widget->SetHost(InHost);
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
    if (ActivePlayerSurfaceWidget.IsValid())
    {
        UFicsitAIScreenSurfaceWidget* Widget = ActivePlayerSurfaceWidget.Get();
        if (Widget && Widget->IsInViewport())
        {
            Widget->RemoveFromParent();
        }
        ActivePlayerSurfaceWidget = nullptr;
    }

    if (PC && PC->IsLocalController())
    {
        PC->SetInputMode(FInputModeGameOnly());
        PC->bShowMouseCursor = false;
    }
}

bool UFicsitAIScreenSurfaceWidget::IsOpenForPlayer(APlayerController* PC)
{
    if (!ActivePlayerSurfaceWidget.IsValid())
    {
        return false;
    }
    UFicsitAIScreenSurfaceWidget* Widget = ActivePlayerSurfaceWidget.Get();
    return Widget && Widget->IsInViewport();
}

void UFicsitAIScreenSurfaceWidget::SetHost(TScriptInterface<IFicsitAIScreenHost> InHost)
{
    Host = InHost;
}

void UFicsitAIScreenSurfaceWidget::SetModule(TScriptInterface<IFicsitAIScreenModule> Module)
{
    ActiveModule = Module;
    UpdateLayout();

    if (ModuleContentBox.IsValid())
    {
        if (ActiveModule)
        {
            if (UUserWidget* ModuleWidget = Cast<UUserWidget>(ActiveModule.GetObject()))
            {
                ModuleContentBox->SetContent(ModuleWidget->TakeWidget());
            }
        }
        else
        {
            ModuleContentBox->SetContent(
                SAssignNew(StatusTextBlock, STextBlock)
                .Text_UObject(this, &UFicsitAIScreenSurfaceWidget::GetStatusMessage)
                .ColorAndOpacity(FLinearColor(0.9f, 0.3f, 0.2f, 1.0f))
            );
        }
    }
}

void UFicsitAIScreenSurfaceWidget::ClearModule()
{
    ActiveModule = nullptr;
    UpdateLayout();

    if (ModuleContentBox.IsValid())
    {
        ModuleContentBox->SetContent(
            SAssignNew(StatusTextBlock, STextBlock)
            .Text_UObject(this, &UFicsitAIScreenSurfaceWidget::GetStatusMessage)
            .ColorAndOpacity(FLinearColor(0.9f, 0.3f, 0.2f, 1.0f))
        );
    }
}

void UFicsitAIScreenSurfaceWidget::SetHostState(EFicsitAIHostState NewState)
{
    CurrentHostState = NewState;
    UpdateLayout();

    if (CurrentHostState != EFicsitAIHostState::Ready && ModuleContentBox.IsValid())
    {
        ModuleContentBox->SetContent(
            SAssignNew(StatusTextBlock, STextBlock)
            .Text_UObject(this, &UFicsitAIScreenSurfaceWidget::GetStatusMessage)
            .ColorAndOpacity(FLinearColor(0.9f, 0.3f, 0.2f, 1.0f))
        );
    }
}

void UFicsitAIScreenSurfaceWidget::UpdateLayout()
{
    CurrentHotkeyHints.Empty();

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
    FString Result;
    for (int32 i = 0; i < CurrentHotkeyHints.Num(); ++i)
    {
        if (i > 0)
        {
            Result += TEXT("  |  ");
        }
        Result += FString::Printf(TEXT("[%s] %s"), *CurrentHotkeyHints[i].ActionId.ToString(), *CurrentHotkeyHints[i].Label.ToString());
    }
    if (Result.IsEmpty())
    {
        Result = TEXT("[E] Закрыть | [F] Заметки | [R] Статус | [Esc] Назад");
    }
    return FText::FromString(Result);
}

TSharedRef<SWidget> UFicsitAIScreenSurfaceWidget::RebuildWidget()
{
    TSharedRef<SWidget> Widget = SNew(SBorder)
        .BorderBackgroundColor(FLinearColor(0.02f, 0.02f, 0.03f, 0.95f))
        .Padding(FMargin(20.0f))
        [
            SNew(SBox)
            .WidthOverride(1920.0f)
            .HeightOverride(1080.0f)
            [
                SNew(SVerticalBox)
                // Верхняя полоса (Header, 64px)
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(FMargin(0.0f, 0.0f, 0.0f, 10.0f))
                [
                    SNew(SBorder)
                    .BorderBackgroundColor(FLinearColor(0.08f, 0.08f, 0.12f, 1.0f))
                    .Padding(FMargin(16.0f, 12.0f))
                    [
                        SAssignNew(HeaderTextBlock, STextBlock)
                        .Text_UObject(this, &UFicsitAIScreenSurfaceWidget::GetHeaderTitle)
                        .ColorAndOpacity(FLinearColor::White)
                    ]
                ]
                // Основная область модуля (16:9)
                + SVerticalBox::Slot()
                .FillHeight(1.0f)
                .Padding(FMargin(0.0f, 10.0f))
                [
                    SAssignNew(ModuleContentBox, SBox)
                    .HAlign(HAlign_Center)
                    .VAlign(VAlign_Center)
                    [
                        SAssignNew(StatusTextBlock, STextBlock)
                        .Text_UObject(this, &UFicsitAIScreenSurfaceWidget::GetStatusMessage)
                        .ColorAndOpacity(FLinearColor(0.9f, 0.3f, 0.2f, 1.0f))
                    ]
                ]
                // Нижняя полоса клавиш (Footer, 56px)
                + SVerticalBox::Slot()
                .AutoHeight()
                .Padding(FMargin(0.0f, 10.0f, 0.0f, 0.0f))
                [
                    SNew(SBorder)
                    .BorderBackgroundColor(FLinearColor(0.05f, 0.05f, 0.08f, 1.0f))
                    .Padding(FMargin(16.0f, 8.0f))
                    [
                        SAssignNew(FooterTextBlock, STextBlock)
                        .Text_UObject(this, &UFicsitAIScreenSurfaceWidget::GetFormattedHotkeyHints)
                        .ColorAndOpacity(FLinearColor(0.7f, 0.7f, 0.7f, 1.0f))
                    ]
                ]
            ]
        ];

    UpdateLayout();
    return Widget;
}

FReply UFicsitAIScreenSurfaceWidget::NativeOnKeyDown(const FGeometry& InGeometry, const FKeyEvent& InKeyEvent)
{
    const FKey Key = InKeyEvent.GetKey();

    if (Key == EKeys::Escape || Key == EKeys::E)
    {
        if (ActiveModule && ActiveModule->HandleBackAction())
        {
            return FReply::Handled();
        }
        if (Host)
        {
            Host->CloseActiveModule();
            return FReply::Handled();
        }
        else
        {
            CloseForPlayer(GetOwningPlayer());
            return FReply::Handled();
        }
    }
    else if (Key == EKeys::F)
    {
        if (Host)
        {
            Host->OpenModule(FName(TEXT("Notes")));
            return FReply::Handled();
        }
    }
    else if (Key == EKeys::R)
    {
        if (Host)
        {
            Host->OpenModule(FName(TEXT("Status")));
            return FReply::Handled();
        }
    }

    return Super::NativeOnKeyDown(InGeometry, InKeyEvent);
}
