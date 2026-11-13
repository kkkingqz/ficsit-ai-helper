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
    virtual FString GetRequiredApiVersion() const override { return TEXT("0.3.0"); }
    virtual FText GetDisplayName() const override { return NSLOCTEXT("FicsitAI", "NotesModuleTitle", "Заметки"); }
    virtual TArray<FFicsitAIHotkeyHint> GetHotkeyHints() const override;

    virtual void OnAttach(const FFicsitAIScreenContext& Context) override;
    virtual void OnContextChanged(const FFicsitAIScreenContext& Context) override;
    virtual void OnDetach() override;

    virtual FString SavePersistentState() const override;
    virtual void RestorePersistentState(const FString& State) override;
    virtual bool WantsInputFocus() const override { return true; }
    virtual bool HandleBackAction() override;

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Test")
    const FString& GetNoteContent() const { return NoteContent; }

    UFUNCTION(BlueprintCallable, Category = "FICSIT AI|Test")
    void SetNoteContent(const FString& NewContent) { NoteContent = NewContent; }

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Test")
    bool IsAttached() const { return bIsAttached; }

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Test")
    bool HasInputFocus() const { return bHasFocus; }

    void SetInputFocus(bool bFocus) { bHasFocus = bFocus; }

    UFUNCTION(BlueprintPure, Category = "FICSIT AI|Test")
    const FFicsitAIScreenContext& GetCurrentContext() const { return CurrentContext; }

protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;

private:
    UPROPERTY()
    FFicsitAIScreenContext CurrentContext;

    UPROPERTY()
    FString NoteContent;

    TSharedPtr<class SMultiLineEditableTextBox> EditableTextBox;
    bool bIsAttached = false;
    bool bHasFocus = false;
};
