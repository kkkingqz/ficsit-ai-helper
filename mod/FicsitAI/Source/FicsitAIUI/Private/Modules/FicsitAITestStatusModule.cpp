#include "Modules/FicsitAITestStatusModule.h"

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
