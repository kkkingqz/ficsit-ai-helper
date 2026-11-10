#include "FicsitAIScreenModuleFactoryImpl.h"
#include "Modules/FicsitAITestNotesModule.h"
#include "Modules/FicsitAITestStatusModule.h"

TArray<FName> UFicsitAIScreenModuleFactoryImpl::GetRegisteredModules() const
{
    return { FName(TEXT("Notes")), FName(TEXT("Status")) };
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

    return nullptr;
}
