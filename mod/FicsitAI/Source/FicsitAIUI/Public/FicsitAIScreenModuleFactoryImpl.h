#pragma once

#include "CoreMinimal.h"
#include "UObject/NoExportTypes.h"
#include "IFicsitAIScreenModule.h"
#include "FicsitAIScreenModuleFactoryImpl.generated.h"

UCLASS(BlueprintType)
class FICSITAIUI_API UFicsitAIScreenModuleFactoryImpl : public UObject, public IFicsitAIScreenModuleFactory
{
    GENERATED_BODY()

public:
    virtual TArray<FName> GetRegisteredModules() const override;
    virtual TScriptInterface<IFicsitAIScreenModule> CreateModule(FName ModuleId, UObject* Outer) override;
};
