#pragma once

#include "CoreMinimal.h"
#include "Containers/ArrayView.h"
#include "GameFacade/Telemetry/FicsitAITelemetryTypes.h"

class AFGBuildableGenerator;

namespace FicsitAI::Telemetry
{

/**
 * Collector responsible for extracting single-actor telemetry from AFGBuildableGenerator
 * on GameThread and aggregating snapshots on a worker thread.
 */
class FICSITAICORE_API FFicsitAIGeneratorCollector
{
public:
    /**
     * Extracts telemetry from a single generator into a clean POD snapshot.
     * Must be called on the GameThread. Performs zero heap allocations.
     * OutItem is only overwritten when this returns true.
     */
    static bool Collect(const AFGBuildableGenerator* Generator, FGeneratorTelemetryItem& OutItem);

    /**
     * Aggregates pre-collected generator snapshots.
     * Pure computation over POD snapshots; safe to call on any worker thread.
     */
    static void Aggregate(TArrayView<const FGeneratorTelemetryItem> Snapshots, FGeneratorsTelemetryAggregate& OutAggregate);
};

} // namespace FicsitAI::Telemetry
