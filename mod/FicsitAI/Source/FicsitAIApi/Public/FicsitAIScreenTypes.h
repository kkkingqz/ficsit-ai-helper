#pragma once

#include "CoreMinimal.h"
#include "InputCoreTypes.h"
#include "FicsitAIScreenTypes.generated.h"

UENUM(BlueprintType)
enum class EFicsitAIScreenLayout : uint8
{
    Slots1,       // один слот main
    Slots2,       // main + side
    Slots3,       // main + side + foot
    HudCompact    // v1.4, HUD при AI Assistant
};

UENUM(BlueprintType)
enum class EFicsitAIHostState : uint8
{
    Ready,        // хост работает
    NoPower,      // терминал без питания: модули не открываются
    Inert         // мультиплеерная сессия или вход удалённого игрока
};

USTRUCT(BlueprintType)
struct FICSITAIAPI_API FFicsitAIScreenContext
{
    GENERATED_BODY()

    /** Идентификатор сохранения (ADR-014, §10). Ключ состояния мода. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    FString SaveId;

    /** Кто открыл: AI Terminal, AI Assistant (v1.4), тестовый хост, Screen Lab. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    FName HostId;

    /** Пресет раскладки. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    EFicsitAIScreenLayout Layout = EFicsitAIScreenLayout::Slots3;

    /** Размер области модуля в пикселях и её пропорция. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    FIntPoint SizePx = FIntPoint::ZeroValue;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    float AspectRatio = 16.0f / 9.0f;

    /** true — модуль рисуется в render target меша, значит 16:9 жёстко (ADR-030). */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    bool bWorldSurface = false;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    EFicsitAIHostState HostState = EFicsitAIHostState::Ready;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    bool bHasInputFocus = false;
};

USTRUCT(BlueprintType)
struct FICSITAIAPI_API FFicsitAIHotkeyHint
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    FName ActionId;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    FText DisplayLabel;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    FKey PrimaryKey;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    bool bActive = true;
};
