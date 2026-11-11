#include "FicsitAIScreenModuleFactoryImpl.h"
#include "Modules/FicsitAITestNotesModule.h"
#include "Modules/FicsitAITestStatusModule.h"
#include "Modules/FicsitAITestIncompatibleModule.h"

TArray<FName> UFicsitAIScreenModuleFactoryImpl::GetRegisteredModules() const
{
    return { FName(TEXT("Notes")), FName(TEXT("Status")), FName(TEXT("Incompatible")) };
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

    return nullptr;
}
