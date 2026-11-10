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
    virtual TScriptInterface<IFicsitAIScreenModule> CreateModuleWidget(FName ModuleId, UObject* Outer) override;
};
