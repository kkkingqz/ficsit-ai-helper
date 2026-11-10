#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "IFicsitAIScreenModule.h"
#include "FicsitAITestNotesModule.generated.h"

/**
 * Тестовый экранный модуль «Заметки» для Spike S1 (AC-14).
 * Проверяет открытие, сохранение контекста, переключение и хоткеи.
 */
UCLASS(BlueprintType)
class FICSITAIUI_API UFicsitAITestNotesModule : public UUserWidget, public IFicsitAIScreenModule
{
    GENERATED_BODY()

public:
    virtual FName GetModuleId() const override { return FName(TEXT("Notes")); }
    virtual FText GetDisplayName() const override { return NSLOCTEXT("FicsitAI", "NotesModuleTitle", "Заметки"); }
    virtual uint8 GetSupportedLayouts() const override { return 0xFF; }
    virtual float GetPreferredAspectRatio() const override { return 16.0f / 9.0f; }

    virtual TArray<FFicsitAIHotkeyHint> GetHotkeyHints() const override;

    virtual void OnAttach(const FFicsitAIScreenContext& Context) override;
    virtual void OnDetach() override;
    virtual void OnContextChanged(const FFicsitAIScreenContext& NewContext) override;
    virtual void OnFocusGained() override;
    virtual void OnFocusLost() override;
    virtual bool HandleBackAction() override;
    virtual bool SavePersistentState(FString& OutJson) const override;
    virtual bool RestorePersistentState(const FString& InJson) override;

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Test")
    const FString& GetNoteContent() const { return NoteContent; }

    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Test")
    void SetNoteContent(const FString& NewContent) { NoteContent = NewContent; }

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Test")
    bool IsAttached() const { return bIsAttached; }

private:
    UPROPERTY()
    FFicsitAIScreenContext CurrentContext;

    UPROPERTY()
    FString NoteContent;

    bool bIsAttached = false;
    bool bHasFocus = false;
};
