#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "FicsitAIScreenTypes.h"
#include "IFicsitAIScreenHost.generated.h"

UINTERFACE(MinimalAPI, BlueprintType)
class UFicsitAIScreenHost : public UInterface
{
    GENERATED_BODY()
};

/**
 * Интерфейс хоста экранных модулей (терминал, AI Assistant, тестовый хост).
 * Описан в docs/interfaces/screen-host-and-module.md.
 */
class FICSITAIAPI_API IFicsitAIScreenHost
{
    GENERATED_BODY()

public:
    virtual const FFicsitAIScreenContext& GetHostContext() const = 0;
    virtual EFicsitAIHostState GetHostState() const = 0;
    virtual bool OpenModule(FName ModuleId) = 0;
    virtual void CloseModule(FName ModuleId) = 0;
    virtual FName GetActiveModule() const = 0;
    virtual void SetFocusToModule(bool bFocus) = 0;
    virtual void NotifyContentChanged() = 0;
};
