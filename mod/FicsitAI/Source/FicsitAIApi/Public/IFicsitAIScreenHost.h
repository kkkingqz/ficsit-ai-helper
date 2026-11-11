#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "FicsitAIScreenTypes.h"
#include "IFicsitAIScreenHost.generated.h"

class IFicsitAIScreenModule;

UINTERFACE(MinimalAPI, BlueprintType)
class UFicsitAIScreenHost : public UInterface { GENERATED_BODY() };

class FICSITAIAPI_API IFicsitAIScreenHost
{
    GENERATED_BODY()
public:
    virtual FFicsitAIScreenContext GetScreenContext() const = 0;

    /** Какие модули этот хост может открыть. Пункты будущих версий здесь не появляются (§6.7). */
    virtual TArray<FName> GetAvailableModules() const = 0;

    /** Открыть модуль. false — несовместимая версия API, нет такого модуля или HostState != Ready. */
    virtual bool OpenModule(FName ModuleId) = 0;
    virtual void CloseActiveModule() = 0;
    virtual FName GetActiveModuleId() const = 0;

    /** Модуль просит фокус ввода (поле чата) или отдаёт его. Решение за хостом. */
    virtual void RequestInputFocus(bool bWanted) = 0;

    /** Содержимое изменилось — хосту пора обновить экран в мире по renderRevision (§6.6, §10.1). */
    virtual void NotifyContentChanged() = 0;
};

/** Поверхность, в которую встраивается виджет модуля. Объявлена в Api, реализована контейнером в FicsitAIUI:
 *  так хост в Core передаёт модуль на экран, не зная типов UMG. */
UINTERFACE(MinimalAPI)
class UFicsitAIScreenSurface : public UInterface { GENERATED_BODY() };

class FICSITAIAPI_API IFicsitAIScreenSurface
{
    GENERATED_BODY()
public:
    virtual void SetModule(TScriptInterface<IFicsitAIScreenModule> Module) = 0;
    virtual void ClearModule() = 0;
};
