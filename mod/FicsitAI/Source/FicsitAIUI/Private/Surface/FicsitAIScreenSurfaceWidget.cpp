#include "Surface/FicsitAIScreenSurfaceWidget.h"

void UFicsitAIScreenSurfaceWidget::SetModule(TScriptInterface<IFicsitAIScreenModule> Module)
{
    ActiveModule = Module;
    UpdateLayout();
}

void UFicsitAIScreenSurfaceWidget::ClearModule()
{
    ActiveModule = nullptr;
    UpdateLayout();
}

void UFicsitAIScreenSurfaceWidget::SetHostState(EFicsitAIHostState NewState)
{
    CurrentHostState = NewState;
    UpdateLayout();
}

void UFicsitAIScreenSurfaceWidget::UpdateLayout()
{
    CurrentHotkeyHints.Empty();

    if (CurrentHostState == EFicsitAIHostState::NoPower)
    {
        HeaderTitle = NSLOCTEXT("FicsitAI", "NoPowerHeader", "ТЕРМИНАЛ FICSIT AI");
        StatusMessage = NSLOCTEXT("FicsitAI", "NoPowerMessage", "ПИТАНИЕ ОТКЛЮЧЕНО (ТРЕБУЕТСЯ 10 МВт)");
        return;
    }

    if (CurrentHostState == EFicsitAIHostState::Inert)
    {
        HeaderTitle = NSLOCTEXT("FicsitAI", "InertHeader", "ТЕРМИНАЛ FICSIT AI");
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
        HeaderTitle = NSLOCTEXT("FicsitAI", "IdleHeader", "FICSIT AI — ТЕРМИНАЛ ГОТОВ");
    }

    // Всегда добавляем Esc в подсказки хоста
    FFicsitAIHotkeyHint BackHint;
    BackHint.ActionId = FName(TEXT("IA_FicsitAI_Back"));
    BackHint.Label = NSLOCTEXT("FicsitAI", "BackHint", "Назад / Закрыть");
    CurrentHotkeyHints.Add(BackHint);
}
