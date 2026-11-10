#include "Modules/FicsitAITestNotesModule.h"

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
