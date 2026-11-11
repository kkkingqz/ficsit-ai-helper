#pragma once

#include "CoreMinimal.h"
#include "GameFacade/Telemetry/FicsitAITelemetryTypes.h"

class AFGBuildableFactory;

namespace FicsitAI::Telemetry
{

/**
 * Collector responsible for safely extracting machine load and diagnostics from AFGBuildableFactory / AFGBuildableManufacturer.
 */
class FICSITAICORE_API FFicsitAIMachineLoadCollector
{
public:
    /**
     * Extracts telemetry and diagnostic state from a single factory machine.
     */
    static bool Collect(const AFGBuildableFactory* Factory, FMachineLoadTelemetryItem& OutItem);

    /**
     * Extracts and aggregates telemetry from a batch of factory machines.
     */
    static void CollectBatch(const TArray<const AFGBuildableFactory*>& Factories, FMachineLoadTelemetryAggregate& OutAggregate);
};

} // namespace FicsitAI::Telemetry
