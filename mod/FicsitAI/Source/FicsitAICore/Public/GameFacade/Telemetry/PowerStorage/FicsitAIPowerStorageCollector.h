#pragma once

#include "CoreMinimal.h"
#include "GameFacade/Telemetry/FicsitAITelemetryTypes.h"

class AFGBuildablePowerStorage;

namespace FicsitAI::Telemetry
{

/**
 * Collector responsible for safely extracting telemetry from AFGBuildablePowerStorage actors.
 */
class FICSITAICORE_API FFicsitAIPowerStorageCollector
{
public:
    /**
     * Extracts telemetry from a single power storage building.
     */
    static bool Collect(const AFGBuildablePowerStorage* Battery, FPowerStorageTelemetryItem& OutItem);

    /**
     * Extracts and aggregates telemetry from a batch of power storage buildings.
     */
    static void CollectBatch(const TArray<const AFGBuildablePowerStorage*>& Batteries, FPowerStorageTelemetryAggregate& OutAggregate);
};

} // namespace FicsitAI::Telemetry
