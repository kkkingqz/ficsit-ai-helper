#include "Modules/FicsitAITestStatusModule.h"

TArray<FFicsitAIHotkeyHint> UFicsitAITestStatusModule::GetHotkeyHints() const
{
    TArray<FFicsitAIHotkeyHint> Hints;

    FFicsitAIHotkeyHint RefreshHint;
    RefreshHint.ActionId = FName(TEXT("RefreshStatus"));
    RefreshHint.DisplayLabel = NSLOCTEXT("FicsitAI", "RefreshStatusHint", "Обновить");
    RefreshHint.PrimaryKey = EKeys::R;
    RefreshHint.bActive = true;
    Hints.Add(RefreshHint);

    return Hints;
}

void UFicsitAITestStatusModule::OnAttach(const FFicsitAIScreenContext& Context)
{
    CurrentContext = Context;
    bIsAttached = true;
}

void UFicsitAITestStatusModule::OnDetach()
{
    bIsAttached = false;
    bHasFocus = false;
}

void UFicsitAITestStatusModule::OnContextChanged(const FFicsitAIScreenContext& NewContext)
{
    CurrentContext = NewContext;
}

void UFicsitAITestStatusModule::OnFocusGained()
{
    bHasFocus = true;
}

void UFicsitAITestStatusModule::OnFocusLost()
{
    bHasFocus = false;
}

bool UFicsitAITestStatusModule::HandleBackAction()
{
    return false;
}

bool UFicsitAITestStatusModule::SavePersistentState(FString& OutJson) const
{
    OutJson = TEXT("{\"status\":\"ok\"}");
    return true;
}

bool UFicsitAITestStatusModule::RestorePersistentState(const FString& InJson)
{
    return true;
}
