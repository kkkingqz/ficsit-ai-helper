#pragma once

#include "CoreMinimal.h"
#include "Input/FGInputMappingContext.h"
#include "InputAction.h"
#include "FicsitAIInputMappingContext.generated.h"

/**
 * Расширенное действие ввода FICSIT AI с поддержкой Player Mappable Key Settings.
 */
UCLASS()
class FICSITAICORE_API UFicsitAIInputAction : public UInputAction
{
    GENERATED_BODY()

public:
    void SetMappableKeySettings(class UPlayerMappableKeySettings* InSettings)
    {
        PlayerMappableKeySettings = InSettings;
    }
};

/**
 * Контекст Enhanced Input мода FICSIT AI.
 * Интеграция с меню переназначения клавиш Satisfactory (ARCHITECTURE.md §2.3, §6.7, ADR-027, Spike S1).
 * Определяет действия открытия терминала, переключения модулей и возврата.
 */
UCLASS()
class FICSITAICORE_API UFicsitAIInputMappingContext : public UFGInputMappingContext
{
    GENERATED_BODY()

public:
    UFicsitAIInputMappingContext();

    /** Действие: взаимодействие / открытие терминала (по умолчанию: E) */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "FICSIT AI|Input")
    TObjectPtr<UFicsitAIInputAction> ActionOpenTerminal;

    /** Действие: переключение на экран Заметки (по умолчанию: F) */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "FICSIT AI|Input")
    TObjectPtr<UFicsitAIInputAction> ActionNotes;

    /** Действие: переключение на экран Статус / Статистика (по умолчанию: R) */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "FICSIT AI|Input")
    TObjectPtr<UFicsitAIInputAction> ActionStatus;

    /** Действие: возврат / закрытие интерфейса терминала (по умолчанию: Escape) */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "FICSIT AI|Input")
    TObjectPtr<UFicsitAIInputAction> ActionBack;
};
