#include "GameFacade/Telemetry/Generators/FicsitAIGeneratorCollector.h"
#include "Buildables/FGBuildableGenerator.h"
#include "Buildables/FGBuildableGeneratorFuel.h"
#include "Buildables/FGBuildableGeneratorGeoThermal.h"
#include "Buildables/FGBuildableGeneratorNuclear.h"
#include "Resources/FGItemDescriptor.h"

namespace FicsitAI::Telemetry
{

bool FFicsitAIGeneratorCollector::Collect(const AFGBuildableGenerator* Generator, FGeneratorTelemetryItem& OutItem)
{
    if (!IsValid(Generator))
    {
        return false;
    }

    OutItem.BuildingId = Generator->GetPathName();
    UClass* GenClass = Generator->GetClass();
    OutItem.ClassName = GenClass ? GenClass->GetFName() : NAME_None;

    OutItem.ProductionCapacityMW = Generator->GetPowerProductionCapacity();
    OutItem.BaseProductionCapacityMW = Generator->GetDefaultPowerProductionCapacity();
    OutItem.LoadPercentage = FMath::Clamp(Generator->GetLoadPercentage(), 0.0f, 1.0f);
    OutItem.CurrentProductionMW = OutItem.ProductionCapacityMW * OutItem.LoadPercentage;

    OutItem.bIsProducing = Generator->IsProducing();
    OutItem.bCanStartProduction = Generator->CanStartPowerProduction();
    OutItem.bHasPower = Generator->HasPower();

    // Check specific generator subclasses
    if (const AFGBuildableGeneratorNuclear* NuclearGen = Cast<AFGBuildableGeneratorNuclear>(Generator))
    {
        OutItem.GeneratorType = EFicsitAIGeneratorType::Nuclear;
        OutItem.bIsFuelGenerator = true;
        OutItem.bHasFuel = NuclearGen->HasFuel();
        if (NuclearGen->GetCurrentFuelClass())
        {
            OutItem.CurrentFuelClass = NuclearGen->GetCurrentFuelClass()->GetFName();
        }
        OutItem.FuelAmountRatio = NuclearGen->GetFuelAmount();

        OutItem.bRequiresSupplemental = NuclearGen->GetRequiresSupplementalResource();
        OutItem.bHasSupplemental = NuclearGen->HasSupplementalResource();
        if (NuclearGen->GetSupplementalResourceClass())
        {
            OutItem.SupplementalResourceClass = NuclearGen->GetSupplementalResourceClass()->GetFName();
        }
        OutItem.SupplementalAmountRatio = NuclearGen->GetSupplementalAmount();
        OutItem.SupplementalConsumptionRate = NuclearGen->GetSupplementalConsumptionRateCurrent();
    }
    else if (const AFGBuildableGeneratorGeoThermal* GeoGen = Cast<AFGBuildableGeneratorGeoThermal>(Generator))
    {
        OutItem.GeneratorType = EFicsitAIGeneratorType::GeoThermal;
        OutItem.bIsGeoThermal = true;
        OutItem.MinProductionMW = GeoGen->GetMinPowerProduction();
        OutItem.MaxProductionMW = GeoGen->GetMaxPowerProduction();
    }
    else if (const AFGBuildableGeneratorFuel* FuelGen = Cast<AFGBuildableGeneratorFuel>(Generator))
    {
        const FString ClassNameStr = OutItem.ClassName.ToString();
        if (ClassNameStr.Contains(TEXT("Biomass")))
        {
            OutItem.GeneratorType = EFicsitAIGeneratorType::Biomass;
        }
        else
        {
            OutItem.GeneratorType = EFicsitAIGeneratorType::Fuel;
        }

        OutItem.bIsFuelGenerator = true;
        OutItem.bHasFuel = FuelGen->HasFuel();
        if (FuelGen->GetCurrentFuelClass())
        {
            OutItem.CurrentFuelClass = FuelGen->GetCurrentFuelClass()->GetFName();
        }
        OutItem.FuelAmountRatio = FuelGen->GetFuelAmount();

        OutItem.bRequiresSupplemental = FuelGen->GetRequiresSupplementalResource();
        OutItem.bHasSupplemental = FuelGen->HasSupplementalResource();
        if (FuelGen->GetSupplementalResourceClass())
        {
            OutItem.SupplementalResourceClass = FuelGen->GetSupplementalResourceClass()->GetFName();
        }
        OutItem.SupplementalAmountRatio = FuelGen->GetSupplementalAmount();
        OutItem.SupplementalConsumptionRate = FuelGen->GetSupplementalConsumptionRateCurrent();
    }
    else
    {
        OutItem.GeneratorType = EFicsitAIGeneratorType::Standard;
    }

    return true;
}

void FFicsitAIGeneratorCollector::CollectBatch(const TArray<const AFGBuildableGenerator*>& Generators, FGeneratorsTelemetryAggregate& OutAggregate)
{
    OutAggregate.TotalGenerators = 0;
    OutAggregate.RunningGenerators = 0;
    OutAggregate.TotalProductionCapacityMW = 0.0f;
    OutAggregate.TotalActualProductionMW = 0.0f;
    OutAggregate.CountByClass.Empty();
    OutAggregate.ProductionByClassMW.Empty();
    OutAggregate.Items.Reset(Generators.Num());

    for (const AFGBuildableGenerator* Generator : Generators)
    {
        FGeneratorTelemetryItem Item;
        if (Collect(Generator, Item))
        {
            OutAggregate.TotalGenerators++;
            if (Item.bIsProducing)
            {
                OutAggregate.RunningGenerators++;
            }

            OutAggregate.TotalProductionCapacityMW += Item.ProductionCapacityMW;
            OutAggregate.TotalActualProductionMW += Item.CurrentProductionMW;

            OutAggregate.CountByClass.FindOrAdd(Item.ClassName, 0)++;
            OutAggregate.ProductionByClassMW.FindOrAdd(Item.ClassName, 0.0f) += Item.CurrentProductionMW;

            OutAggregate.Items.Add(MoveTemp(Item));
        }
    }
}

} // namespace FicsitAI::Telemetry
