#pragma once

#include "CoreMinimal.h"
#include "Containers/ArrayView.h"
#include "GameFacade/Telemetry/FicsitAITelemetryTypes.h"

class AFGBuildableCircuitSwitch;

namespace FicsitAI::Telemetry
{

/**
 * Collector responsible for extracting single-actor telemetry from AFGBuildableCircuitSwitch
 * (including priority power switches) on GameThread and aggregating snapshots on a worker thread.
 */
class FICSITAICORE_API FFicsitAICircuitBreakerCollector
{
public:
    /**
     * Extracts telemetry from a single circuit switch into a clean POD snapshot.
     * Must be called on the GameThread. Performs zero heap allocations.
     * OutItem is only overwritten when this returns true.
     */
    static bool Collect(const AFGBuildableCircuitSwitch* Switch, FCircuitBreakerTelemetryItem& OutItem);

    /**
     * Aggregates pre-collected circuit breaker snapshots.
     * Pure computation over POD snapshots; safe to call on any worker thread.
     */
    static void Aggregate(TArrayView<const FCircuitBreakerTelemetryItem> Snapshots, FCircuitBreakersTelemetryAggregate& OutAggregate);
};

} // namespace FicsitAI::Telemetry
