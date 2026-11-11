#include "Modules/FicsitAITestStatusModule.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"

TSharedRef<SWidget> UFicsitAITestStatusModule::RebuildWidget()
{
    return SNew(SBorder)
        .BorderBackgroundColor(FLinearColor(0.04f, 0.06f, 0.08f, 1.0f))
        .Padding(FMargin(24.0f))
        [
            SNew(SVerticalBox)
            + SVerticalBox::Slot()
            .AutoHeight()
            .Padding(0.0f, 0.0f, 0.0f, 16.0f)
            [
                SNew(STextBlock)
                .Text(NSLOCTEXT("FicsitAI", "StatusModuleTitleDisplay", "СИСТЕМНЫЙ СТАТУС ТЕРМИНАЛА FICSIT AI"))
                .ColorAndOpacity(FLinearColor(0.2f, 0.85f, 0.5f, 1.0f))
            ]
            + SVerticalBox::Slot()
            .AutoHeight()
            .Padding(0.0f, 6.0f)
            [
                SNew(STextBlock)
                .Text(NSLOCTEXT("FicsitAI", "StatusPower", "• Электропитание: 10 МВт [ПОДКЛЮЧЕНО / СТАБИЛЬНО]"))
                .ColorAndOpacity(FLinearColor::White)
            ]
            + SVerticalBox::Slot()
            .AutoHeight()
            .Padding(0.0f, 6.0f)
            [
                SNew(STextBlock)
                .Text(NSLOCTEXT("FicsitAI", "StatusApi", "• Версия интерфейса API: FicsitAIApi v0.3.0"))
                .ColorAndOpacity(FLinearColor::White)
            ]
            + SVerticalBox::Slot()
            .AutoHeight()
            .Padding(0.0f, 6.0f)
            [
                SNew(STextBlock)
                .Text(NSLOCTEXT("FicsitAI", "StatusScreen", "• Разрешение экрана: 1920x1080 (пропорция 16:9)"))
                .ColorAndOpacity(FLinearColor::White)
            ]
            + SVerticalBox::Slot()
            .AutoHeight()
            .Padding(0.0f, 6.0f)
            [
                SNew(STextBlock)
                .Text(NSLOCTEXT("FicsitAI", "StatusSession", "• Сетевой режим: Standalone / Authority (Singleplayer)"))
                .ColorAndOpacity(FLinearColor::White)
            ]
        ];
}

TArray<FFicsitAIHotkeyHint> UFicsitAITestStatusModule::GetHotkeyHints() const
{
    TArray<FFicsitAIHotkeyHint> Hints;

    FFicsitAIHotkeyHint RefreshHint;
    RefreshHint.ActionId = FName(TEXT("IA_FicsitAI_Status"));
    RefreshHint.Label = NSLOCTEXT("FicsitAI", "RefreshStatusHint", "Статус");
    Hints.Add(RefreshHint);

    return Hints;
}

void UFicsitAITestStatusModule::OnAttach(const FFicsitAIScreenContext& Context)
{
    CurrentContext = Context;
    bIsAttached = true;
}

void UFicsitAITestStatusModule::OnContextChanged(const FFicsitAIScreenContext& Context)
{
    CurrentContext = Context;
}

void UFicsitAITestStatusModule::OnDetach()
{
    bIsAttached = false;
    bHasFocus = false;
}

FString UFicsitAITestStatusModule::SavePersistentState() const
{
    return TEXT("{\"status\":\"ok\"}");
}

void UFicsitAITestStatusModule::RestorePersistentState(const FString& State)
{
}

bool UFicsitAITestStatusModule::HandleBackAction()
{
    return false;
}
