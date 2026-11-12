#include "GameFacade/Telemetry/Generators/FicsitAIGeneratorCollector.h"
#include "Buildables/FGBuildableGenerator.h"
#include "Buildables/FGBuildableGeneratorFuel.h"
#include "Buildables/FGBuildableGeneratorGeoThermal.h"
#include "Buildables/FGBuildableGeneratorNuclear.h"
#include "FGPowerCircuit.h"
#include "FGPowerInfoComponent.h"
#include "Misc/StringBuilder.h"
#include "Resources/FGItemDescriptor.h"

namespace FicsitAI::Telemetry
{

static EFicsitAIGeneratorType ClassifyFuelGenerator(const AFGBuildableGeneratorFuel* FuelGen, FName ClassName)
{
    if (FuelGen->IsA<AFGBuildableGeneratorNuclear>())
    {
        return EFicsitAIGeneratorType::Nuclear;
    }

    FNameBuilder ClassNameStr(ClassName);
    if (FCString::Stristr(*ClassNameStr, TEXT("Biomass")) != nullptr)
    {
        return EFicsitAIGeneratorType::Biomass;
    }
    if (FCString::Stristr(*ClassNameStr, TEXT("Coal")) != nullptr)
    {
        return EFicsitAIGeneratorType::Coal;
    }
    return EFicsitAIGeneratorType::Fuel;
}

bool FFicsitAIGeneratorCollector::Collect(const AFGBuildableGenerator* Generator, FGeneratorTelemetryItem& OutItem)
{
    if (!IsInGameThread() || !IsValid(Generator))
    {
        return false;
    }

    FGeneratorTelemetryItem Snapshot;

    const UClass* GenClass = Generator->GetClass();
    Snapshot.ClassName = GenClass ? GenClass->GetFName() : NAME_None;

    Snapshot.ProductionCapacityMW = Generator->GetPowerProductionCapacity();
    Snapshot.BaseProductionCapacityMW = Generator->GetDefaultPowerProductionCapacity();
    Snapshot.LoadPercentage = FMath::Clamp(Generator->GetLoadPercentage(), 0.0f, 1.0f);

    if (const UFGPowerInfoComponent* PowerInfo = Generator->GetPowerInfo())
    {
        Snapshot.BaseProductionMW = PowerInfo->GetBaseProduction();
        Snapshot.DynamicProductionMW = PowerInfo->GetRegulatedDynamicProduction();
        Snapshot.DynamicProductionCapacityMW = PowerInfo->GetDynamicProductionCapacity();
        const UFGPowerCircuit* Circuit = PowerInfo->GetPowerCircuit();
        Snapshot.CircuitId = Circuit ? Circuit->GetCircuitID() : -1;

        const float PowerInfoProd = Snapshot.BaseProductionMW + Snapshot.DynamicProductionMW;
        Snapshot.CurrentProductionMW = (PowerInfoProd > 0.0f)
            ? PowerInfoProd
            : (Snapshot.ProductionCapacityMW * Snapshot.LoadPercentage);
    }
    else
    {
        Snapshot.CurrentProductionMW = Snapshot.ProductionCapacityMW * Snapshot.LoadPercentage;
    }

    Snapshot.bIsProducing = Generator->IsProducing();
    Snapshot.bCanStartProduction = Generator->CanStartPowerProduction();
    Snapshot.bHasPower = Generator->HasPower();

    // AFGBuildableGeneratorNuclear inherits from AFGBuildableGeneratorFuel
    if (const AFGBuildableGeneratorFuel* FuelGen = Cast<AFGBuildableGeneratorFuel>(Generator))
    {
        Snapshot.GeneratorType = ClassifyFuelGenerator(FuelGen, Snapshot.ClassName);
        Snapshot.bIsFuelGenerator = true;
        Snapshot.bHasFuel = FuelGen->HasFuel();
        if (const UClass* FuelClass = FuelGen->GetCurrentFuelClass())
        {
            Snapshot.CurrentFuelClass = FuelClass->GetFName();
        }
        Snapshot.FuelAmountRatio = FuelGen->GetFuelAmount();

        Snapshot.bRequiresSupplemental = FuelGen->GetRequiresSupplementalResource();
        Snapshot.bHasSupplemental = FuelGen->HasSupplementalResource();
        if (const UClass* SuppClass = FuelGen->GetSupplementalResourceClass())
        {
            Snapshot.SupplementalResourceClass = SuppClass->GetFName();
        }
        Snapshot.SupplementalAmountRatio = FuelGen->GetSupplementalAmount();
        Snapshot.SupplementalConsumptionRate = FuelGen->GetSupplementalConsumptionRateCurrent();
    }
    else if (const AFGBuildableGeneratorGeoThermal* GeoGen = Cast<AFGBuildableGeneratorGeoThermal>(Generator))
    {
        Snapshot.GeneratorType = EFicsitAIGeneratorType::GeoThermal;
        Snapshot.bIsGeoThermal = true;
        Snapshot.MinProductionMW = GeoGen->GetMinPowerProduction();
        Snapshot.MaxProductionMW = GeoGen->GetMaxPowerProduction();
    }
    else
    {
        Snapshot.GeneratorType = EFicsitAIGeneratorType::Standard;
    }

    OutItem = MoveTemp(Snapshot);
    return true;
}

void FFicsitAIGeneratorCollector::Aggregate(TArrayView<const FGeneratorTelemetryItem> Snapshots, FGeneratorsTelemetryAggregate& OutAggregate)
{
    OutAggregate = FGeneratorsTelemetryAggregate{};

    for (const FGeneratorTelemetryItem& Item : Snapshots)
    {
        OutAggregate.TotalGenerators++;
        if (Item.bIsProducing)
        {
            OutAggregate.RunningGenerators++;
        }

        OutAggregate.TotalProductionCapacityMW += Item.ProductionCapacityMW;
        OutAggregate.TotalActualProductionMW += Item.CurrentProductionMW;

        if (Item.ClassName != NAME_None)
        {
            OutAggregate.CountByClass.FindOrAdd(Item.ClassName, 0)++;
            OutAggregate.ProductionByClassMW.FindOrAdd(Item.ClassName, 0.0f) += Item.CurrentProductionMW;
        }
    }
}

} // namespace FicsitAI::Telemetry
