#pragma once

#include "CoreMinimal.h"
#include "IFicsitAIApi.h"
#include "FicsitAIScreenTypes.generated.h"

class IFicsitAIScreenHost;
class UFicsitAIScreenHost;

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
    NoPower,      // терминал без питания (§6.1): модули не открываются
    Inert         // мультиплеерная сессия или вход удалённого игрока (§4.2)
};

USTRUCT(BlueprintType)
struct FICSITAIAPI_API FFicsitAIScreenContext
{
    GENERATED_BODY()

    /** Идентификатор сохранения (§10). Ключ всего состояния мода. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    FString SaveId;

    /** Кто открыл: AI Terminal, AI Assistant (v1.4), тестовый хост, Screen Lab. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    FName HostId;

    /** Пресет раскладки (§5.3). Свободной сетки нет сознательно. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    EFicsitAIScreenLayout Layout = EFicsitAIScreenLayout::Slots3;

    /** Размер области модуля в пикселях и её пропорция. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    FIntPoint SizePx = FIntPoint::ZeroValue;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    float AspectRatio = 16.0f / 9.0f;

    /** true — модуль рисуется в render target меша, значит 16:9 жёстко (§6.6, ADR-030). */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    bool bWorldSurface = false;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    EFicsitAIHostState HostState = EFicsitAIHostState::Ready;

    /** true — модуль получает ввод; false — только отображение. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    bool bHasInputFocus = false;

    /** Публичный API мода (§3.6). Единственный путь модуля к данным и операциям. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    TScriptInterface<IFicsitAIApi> Api;

    /** Хост — для `RequestInputFocus` и `NotifyContentChanged`. Интерфейс, не класс: приведения к терминалу нет. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    TScriptInterface<IFicsitAIScreenHost> Host;
};

USTRUCT(BlueprintType)
struct FICSITAIAPI_API FFicsitAIHotkeyHint
{
    GENERATED_BODY()

    /** Действие Enhanced Input. Букву полоса берёт из текущей привязки, а не из подписи (ADR-027). */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    FName ActionId;

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Screen")
    FText Label;
};
