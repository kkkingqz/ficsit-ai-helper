#include "GameFacade/Terminal/FicsitAIInputMappingContext.h"
#include "PlayerMappableKeySettings.h"
#include "InputCoreTypes.h"
#include "InputTriggers.h"

UFicsitAIInputMappingContext::UFicsitAIInputMappingContext()
{
    mDisplayName = NSLOCTEXT("FicsitAI", "InputContextName", "FICSIT AI");
    mMenuPriority = 200.0f;

    // 1. Открытие терминала / Взаимодействие (E)
    ActionOpenTerminal = CreateDefaultSubobject<UFicsitAIInputAction>(TEXT("IA_FicsitAI_OpenTerminal"));
    ActionOpenTerminal->ValueType = EInputActionValueType::Boolean;
    ActionOpenTerminal->ActionDescription = NSLOCTEXT("FicsitAI", "ActionOpenTerminalDesc", "Взаимодействие с терминалом FICSIT AI");
    ActionOpenTerminal->bConsumeInput = false;
    ActionOpenTerminal->bConsumesActionAndAxisMappings = false;
    {
        UPlayerMappableKeySettings* Settings = CreateDefaultSubobject<UPlayerMappableKeySettings>(TEXT("Mappable_OpenTerminal"));
        Settings->Name = FName(TEXT("FicsitAI.OpenTerminal"));
        Settings->DisplayName = NSLOCTEXT("FicsitAI", "ActionOpenTerminalName", "Терминал: Открыть");
        Settings->DisplayCategory = mDisplayName;
        Settings->IsPlayerMappable = true;
        ActionOpenTerminal->SetMappableKeySettings(Settings);
    }
    // Триггер одиночного нажатия (UInputTriggerPressed), чтобы удержание не повторяло действие по кадрам (Gs-15 раунд 6)
    UInputTriggerPressed* OpenPressedTrigger = CreateDefaultSubobject<UInputTriggerPressed>(TEXT("Trigger_OpenTerminal_Pressed"));
    ActionOpenTerminal->Triggers.Add(OpenPressedTrigger);

    // 2. Экран Заметки (F)
    ActionNotes = CreateDefaultSubobject<UFicsitAIInputAction>(TEXT("IA_FicsitAI_Notes"));
    ActionNotes->ValueType = EInputActionValueType::Boolean;
    ActionNotes->ActionDescription = NSLOCTEXT("FicsitAI", "ActionNotesDesc", "Переключение на экран заметок FICSIT AI");
    ActionNotes->bConsumeInput = false;
    ActionNotes->bConsumesActionAndAxisMappings = false;
    {
        UPlayerMappableKeySettings* Settings = CreateDefaultSubobject<UPlayerMappableKeySettings>(TEXT("Mappable_Notes"));
        Settings->Name = FName(TEXT("FicsitAI.Notes"));
        Settings->DisplayName = NSLOCTEXT("FicsitAI", "ActionNotesName", "Терминал: Экран заметок");
        Settings->DisplayCategory = mDisplayName;
        Settings->IsPlayerMappable = true;
        ActionNotes->SetMappableKeySettings(Settings);
    }

    // 3. Экран Статус / Статистика (R)
    ActionStatus = CreateDefaultSubobject<UFicsitAIInputAction>(TEXT("IA_FicsitAI_Status"));
    ActionStatus->ValueType = EInputActionValueType::Boolean;
    ActionStatus->ActionDescription = NSLOCTEXT("FicsitAI", "ActionStatusDesc", "Переключение на экран статуса / статистики FICSIT AI");
    ActionStatus->bConsumeInput = false;
    ActionStatus->bConsumesActionAndAxisMappings = false;
    {
        UPlayerMappableKeySettings* Settings = CreateDefaultSubobject<UPlayerMappableKeySettings>(TEXT("Mappable_Status"));
        Settings->Name = FName(TEXT("FicsitAI.Status"));
        Settings->DisplayName = NSLOCTEXT("FicsitAI", "ActionStatusName", "Терминал: Экран статуса");
        Settings->DisplayCategory = mDisplayName;
        Settings->IsPlayerMappable = true;
        ActionStatus->SetMappableKeySettings(Settings);
    }

    // 4. Возврат / Закрытие (Escape)
    ActionBack = CreateDefaultSubobject<UFicsitAIInputAction>(TEXT("IA_FicsitAI_Back"));
    ActionBack->ValueType = EInputActionValueType::Boolean;
    ActionBack->ActionDescription = NSLOCTEXT("FicsitAI", "ActionBackDesc", "Закрытие интерфейса терминала FICSIT AI");
    ActionBack->bConsumeInput = false;
    ActionBack->bConsumesActionAndAxisMappings = false;
    {
        UPlayerMappableKeySettings* Settings = CreateDefaultSubobject<UPlayerMappableKeySettings>(TEXT("Mappable_Back"));
        Settings->Name = FName(TEXT("FicsitAI.Back"));
        Settings->DisplayName = NSLOCTEXT("FicsitAI", "ActionBackName", "Терминал: Закрыть / Назад");
        Settings->DisplayCategory = mDisplayName;
        Settings->IsPlayerMappable = true;
        ActionBack->SetMappableKeySettings(Settings);
    }

    // Добавляем привязки клавиш по умолчанию
    Mappings.Add(FEnhancedActionKeyMapping(ActionOpenTerminal, EKeys::E));
    Mappings.Add(FEnhancedActionKeyMapping(ActionNotes, EKeys::F));
    Mappings.Add(FEnhancedActionKeyMapping(ActionStatus, EKeys::R));
    Mappings.Add(FEnhancedActionKeyMapping(ActionBack, EKeys::Escape));
}
