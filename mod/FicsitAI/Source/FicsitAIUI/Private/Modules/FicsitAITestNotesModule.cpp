#include "Modules/FicsitAITestNotesModule.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Input/SMultiLineEditableTextBox.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"

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
                    .HintText(NSLOCTEXT("FicsitAI", "NotesPlaceholder", "Factory must grow..."))
                    .Text_Lambda([this]() { return FText::FromString(NoteContent); })
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
    TSharedPtr<FJsonObject> JsonObj = MakeShared<FJsonObject>();
    JsonObj->SetStringField(TEXT("note"), NoteContent);
    FString OutputString;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutputString);
    FJsonSerializer::Serialize(JsonObj.ToSharedRef(), Writer);
    return OutputString;
}

void UFicsitAITestNotesModule::RestorePersistentState(const FString& State)
{
    if (State.IsEmpty())
    {
        NoteContent.Empty();
        if (EditableTextBox.IsValid())
        {
            EditableTextBox->SetText(FText::GetEmpty());
        }
        return;
    }

    TSharedPtr<FJsonObject> JsonObj;
    TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(State);
    if (FJsonSerializer::Deserialize(Reader, JsonObj) && JsonObj.IsValid())
    {
        if (JsonObj->HasTypedField<EJson::String>(TEXT("note")))
        {
            NoteContent = JsonObj->GetStringField(TEXT("note"));
        }
        else
        {
            NoteContent.Empty();
        }
    }
    else
    {
        // Fallback для плоского текста
        NoteContent = State;
    }

    if (EditableTextBox.IsValid())
    {
        EditableTextBox->SetText(FText::FromString(NoteContent));
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
