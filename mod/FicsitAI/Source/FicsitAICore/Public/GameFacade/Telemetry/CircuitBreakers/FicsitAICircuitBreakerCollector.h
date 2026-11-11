#pragma once

#include "CoreMinimal.h"
#include "GameFacade/Telemetry/FicsitAITelemetryTypes.h"

class AFGBuildableCircuitSwitch;

namespace FicsitAI::Telemetry
{

/**
 * Collector responsible for extracting telemetry from AFGBuildableCircuitSwitch and AFGBuildablePriorityPowerSwitch.
 */
class FICSITAICORE_API FFicsitAICircuitBreakerCollector
{
public:
    /**
     * Extracts telemetry from a single circuit switch / bridge building.
     */
    static bool Collect(const AFGBuildableCircuitSwitch* Switch, FCircuitBreakerTelemetryItem& OutItem);

    /**
     * Extracts and aggregates telemetry from a batch of circuit switches.
     */
    static void CollectBatch(const TArray<const AFGBuildableCircuitSwitch*>& Switches, FCircuitBreakersTelemetryAggregate& OutAggregate);
};

} // namespace FicsitAI::Telemetry
