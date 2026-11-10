#include "Modules/FicsitAITestNotesModule.h"

TArray<FFicsitAIHotkeyHint> UFicsitAITestNotesModule::GetHotkeyHints() const
{
    TArray<FFicsitAIHotkeyHint> Hints;

    FFicsitAIHotkeyHint SaveHint;
    SaveHint.ActionId = FName(TEXT("SaveNote"));
    SaveHint.DisplayLabel = NSLOCTEXT("FicsitAI", "SaveNoteHint", "Сохранить");
    SaveHint.PrimaryKey = EKeys::F;
    SaveHint.bActive = true;
    Hints.Add(SaveHint);

    return Hints;
}

void UFicsitAITestNotesModule::OnAttach(const FFicsitAIScreenContext& Context)
{
    CurrentContext = Context;
    bIsAttached = true;
}

void UFicsitAITestNotesModule::OnDetach()
{
    bIsAttached = false;
    bHasFocus = false;
}

void UFicsitAITestNotesModule::OnContextChanged(const FFicsitAIScreenContext& NewContext)
{
    CurrentContext = NewContext;
}

void UFicsitAITestNotesModule::OnFocusGained()
{
    bHasFocus = true;
}

void UFicsitAITestNotesModule::OnFocusLost()
{
    bHasFocus = false;
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

bool UFicsitAITestNotesModule::SavePersistentState(FString& OutJson) const
{
    OutJson = FString::Printf(TEXT("{\"note\":\"%s\"}"), *NoteContent);
    return true;
}

bool UFicsitAITestNotesModule::RestorePersistentState(const FString& InJson)
{
    // Простой разбор JSON для теста
    if (InJson.Contains(TEXT("\"note\":\"")))
    {
        int32 StartIdx = InJson.Find(TEXT("\"note\":\"")) + 8;
        int32 EndIdx = InJson.Find(TEXT("\""), ESearchCase::IgnoreCase, ESearchDir::FromStart, StartIdx);
        if (EndIdx > StartIdx)
        {
            NoteContent = InJson.Mid(StartIdx, EndIdx - StartIdx);
            return true;
        }
    }
    return false;
}
