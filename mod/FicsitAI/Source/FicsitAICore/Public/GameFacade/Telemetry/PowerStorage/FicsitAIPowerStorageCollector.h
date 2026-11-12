#pragma once

#include "CoreMinimal.h"
#include "Containers/ArrayView.h"
#include "GameFacade/Telemetry/FicsitAITelemetryTypes.h"

class AFGBuildablePowerStorage;

namespace FicsitAI::Telemetry
{

/**
 * Collector responsible for extracting single-actor telemetry from AFGBuildablePowerStorage
 * on GameThread and aggregating snapshots on a worker thread.
 */
class FICSITAICORE_API FFicsitAIPowerStorageCollector
{
public:
    /**
     * Extracts telemetry from a single battery unit into a clean POD snapshot.
     * Must be called on the GameThread. Performs zero heap allocations.
     * OutItem is only overwritten when this returns true.
     */
    static bool Collect(const AFGBuildablePowerStorage* Battery, FPowerStorageTelemetryItem& OutItem);

    /**
     * Aggregates pre-collected power storage snapshots.
     * Pure computation over POD snapshots; safe to call on any worker thread.
     */
    static void Aggregate(TArrayView<const FPowerStorageTelemetryItem> Snapshots, FPowerStorageTelemetryAggregate& OutAggregate);
};

} // namespace FicsitAI::Telemetry
