#include "Modules/FicsitAITestNotesModule.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Input/SMultiLineEditableTextBox.h"

TSharedRef<SWidget> UFicsitAITestNotesModule::RebuildWidget()
{
    return SNew(SBorder)
        .BorderBackgroundColor(FLinearColor(0.04f, 0.05f, 0.08f, 1.0f))
        .Padding(FMargin(24.0f))
        [
            SNew(SVerticalBox)
            + SVerticalBox::Slot()
            .AutoHeight()
            .Padding(0.0f, 0.0f, 0.0f, 14.0f)
            [
                SNew(STextBlock)
                .Text(NSLOCTEXT("FicsitAI", "NotesModuleTitleDisplay", "ИНЖЕНЕРНЫЙ БЛОКНОТ — ТЕКУЩИЕ ЗАМЕТКИ"))
                .ColorAndOpacity(FLinearColor(0.95f, 0.65f, 0.15f, 1.0f))
            ]
            + SVerticalBox::Slot()
            .FillHeight(1.0f)
            [
                SNew(SBorder)
                .BorderBackgroundColor(FLinearColor(0.02f, 0.02f, 0.04f, 1.0f))
                .Padding(FMargin(12.0f))
                [
                    SAssignNew(EditableTextBox, SMultiLineEditableTextBox)
                    .Text_Lambda([this]() { return FText::FromString(NoteContent.IsEmpty() ? TEXT("Factory must grow...") : NoteContent); })
                    .OnTextChanged_Lambda([this](const FText& InText) { NoteContent = InText.ToString(); })
                    .AutoWrapText(true)
                ]
            ]
        ];
}

TArray<FFicsitAIHotkeyHint> UFicsitAITestNotesModule::GetHotkeyHints() const
{
    TArray<FFicsitAIHotkeyHint> Hints;

    FFicsitAIHotkeyHint NoteHint;
    NoteHint.ActionId = FName(TEXT("IA_FicsitAI_Notes"));
    NoteHint.Label = NSLOCTEXT("FicsitAI", "NotesHint", "Заметки");
    Hints.Add(NoteHint);

    return Hints;
}

void UFicsitAITestNotesModule::OnAttach(const FFicsitAIScreenContext& Context)
{
    CurrentContext = Context;
    bIsAttached = true;
}

void UFicsitAITestNotesModule::OnContextChanged(const FFicsitAIScreenContext& Context)
{
    CurrentContext = Context;
}

void UFicsitAITestNotesModule::OnDetach()
{
    bIsAttached = false;
    bHasFocus = false;
}

FString UFicsitAITestNotesModule::SavePersistentState() const
{
    return FString::Printf(TEXT("{\"note\":\"%s\"}"), *NoteContent);
}

void UFicsitAITestNotesModule::RestorePersistentState(const FString& State)
{
    if (State.Contains(TEXT("\"note\":\"")))
    {
        int32 StartIdx = State.Find(TEXT("\"note\":\"")) + 8;
        int32 EndIdx = State.Find(TEXT("\""), ESearchCase::IgnoreCase, ESearchDir::FromStart, StartIdx);
        if (EndIdx > StartIdx)
        {
            NoteContent = State.Mid(StartIdx, EndIdx - StartIdx);
        }
    }
}

bool UFicsitAITestNotesModule::HandleBackAction()
{
    if (bHasFocus)
    {
        bHasFocus = false;
        return true; // Сняли фокус, экран не закрывается
    }
    return false; // Нет фокуса, хост может закрыть экран
}
