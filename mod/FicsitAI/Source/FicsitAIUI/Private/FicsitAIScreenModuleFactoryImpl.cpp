#include "FicsitAIScreenModuleFactoryImpl.h"
#include "Modules/FicsitAITestNotesModule.h"
#include "Modules/FicsitAITestStatusModule.h"
#include "Modules/FicsitAITestIncompatibleModule.h"
#include "Web/FicsitAIWebScreenModule.h"

namespace
{
    // Веб-экраны v0.1 (ADR-032): страница из каталога Web/ мода. Его корень — содержимое web/ репозитория,
    // как у dev-сервера фасада, поэтому адреса страниц в браузере и в игре одинаковые.
    struct FWebScreen { const TCHAR* Id; const TCHAR* Page; };
    const FWebScreen WebScreens[] = {
        { TEXT("Statistics"), TEXT("/screens/statistics/index.html") },
        { TEXT("Chat"), TEXT("/screens/chat/index.html") },
    };

    /**
     * Веб-экран регистрируется, только если его страница запустится: браузер есть, страница собрана и не
     * опирается на встроенные скрипты (ревью #69, P1). Иначе E остаётся на рабочем модуле без браузера.
     */
    bool IsWebScreenReady(const FWebScreen& Screen)
    {
        return UFicsitAIWebScreenModule::IsWebAvailable() && UFicsitAIWebScreenModule::IsPageReady(Screen.Page);
    }
}

TArray<FName> UFicsitAIScreenModuleFactoryImpl::GetRegisteredModules() const
{
    TArray<FName> Modules = { FName(TEXT("Notes")), FName(TEXT("Status")), FName(TEXT("Incompatible")) };
    for (const FWebScreen& Screen : WebScreens)
    {
        if (IsWebScreenReady(Screen))
        {
            Modules.Add(FName(Screen.Id));
        }
    }
    return Modules;
}

TScriptInterface<IFicsitAIScreenModule> UFicsitAIScreenModuleFactoryImpl::CreateModule(FName ModuleId, UObject* Outer)
{
    if (ModuleId == FName(TEXT("Notes")))
    {
        UFicsitAITestNotesModule* Widget = NewObject<UFicsitAITestNotesModule>(Outer);
        TScriptInterface<IFicsitAIScreenModule> Result;
        Result.SetObject(Widget);
        Result.SetInterface(Cast<IFicsitAIScreenModule>(Widget));
        return Result;
    }
    else if (ModuleId == FName(TEXT("Status")))
    {
        UFicsitAITestStatusModule* Widget = NewObject<UFicsitAITestStatusModule>(Outer);
        TScriptInterface<IFicsitAIScreenModule> Result;
        Result.SetObject(Widget);
        Result.SetInterface(Cast<IFicsitAIScreenModule>(Widget));
        return Result;
    }
    else if (ModuleId == FName(TEXT("Incompatible")))
    {
        UFicsitAITestIncompatibleModule* Module = NewObject<UFicsitAITestIncompatibleModule>(Outer);
        TScriptInterface<IFicsitAIScreenModule> Result;
        Result.SetObject(Module);
        Result.SetInterface(Cast<IFicsitAIScreenModule>(Module));
        return Result;
    }

    for (const FWebScreen& Screen : WebScreens)
    {
        if (ModuleId == FName(Screen.Id) && IsWebScreenReady(Screen))
        {
            UFicsitAIWebScreenModule* Module = NewObject<UFicsitAIWebScreenModule>(Outer);
            const FText Name = ModuleId == FName(TEXT("Chat"))
                ? NSLOCTEXT("FicsitAI", "ChatModuleTitle", "Chat")
                : NSLOCTEXT("FicsitAI", "StatisticsModuleTitle", "Statistics");
            Module->Configure(ModuleId, Screen.Page, Name);
            TScriptInterface<IFicsitAIScreenModule> Result;
            Result.SetObject(Module);
            Result.SetInterface(Cast<IFicsitAIScreenModule>(Module));
            return Result;
        }
    }
    return nullptr;
}
