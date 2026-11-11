#pragma once

#include "CoreMinimal.h"
#include "Containers/ArrayView.h"
#include "GameFacade/Telemetry/FicsitAITelemetryTypes.h"
#include "Templates/Function.h"
#include "Templates/SubclassOf.h"

class AFGBuildableFactory;
class UFGItemDescriptor;
struct FItemAmount;

namespace FicsitAI::Telemetry
{

/**
 * Collector responsible for extracting compact per-machine state records (§8.2)
 * from AFGBuildableFactory / AFGBuildableManufacturer on GameThread and aggregating
 * snapshots on a worker thread.
 */
class FICSITAICORE_API FFicsitAIMachineLoadCollector
{
public:
    /**
     * Extracts compact state snapshot from a single factory machine.
     * Must be called on the GameThread. OutItem is only overwritten when returning true.
     * Note: FR-23 cause classification belongs in core/ and is intentionally excluded here.
     */
    static bool Collect(const AFGBuildableFactory* Factory, FMachineLoadTelemetryItem& OutItem);

    /**
     * Aggregates pre-collected machine state snapshots.
     * Pure computation over POD snapshots; safe to call on any worker thread.
     */
    static void Aggregate(TArrayView<const FMachineLoadTelemetryItem> Snapshots, FMachineLoadTelemetryAggregate& OutAggregate);

    /**
     * Verifies whether every ingredient in a recipe cycle (aggregating any duplicate item entries)
     * is available in sufficient quantity via the supplied count lookup.
     */
    static bool CheckIngredientsForCycle(
        const TArray<FItemAmount>& Ingredients,
        TFunctionRef<int32(TSubclassOf<UFGItemDescriptor>)> GetAvailableCount);
};

} // namespace FicsitAI::Telemetry
