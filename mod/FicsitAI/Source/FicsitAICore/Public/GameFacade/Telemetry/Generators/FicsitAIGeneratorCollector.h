#pragma once

#include "CoreMinimal.h"
#include "GameFacade/Telemetry/FicsitAITelemetryTypes.h"

class AFGBuildableGenerator;

namespace FicsitAI::Telemetry
{

/**
 * Collector responsible for safely extracting telemetry from AFGBuildableGenerator actors.
 */
class FICSITAICORE_API FFicsitAIGeneratorCollector
{
public:
    /**
     * Extracts telemetry from a single generator into an item snapshot.
     * Returns true if successfully read, false if generator is invalid.
     */
    static bool Collect(const AFGBuildableGenerator* Generator, FGeneratorTelemetryItem& OutItem);

    /**
     * Extracts and aggregates telemetry from a batch of generators.
     */
    static void CollectBatch(const TArray<const AFGBuildableGenerator*>& Generators, FGeneratorsTelemetryAggregate& OutAggregate);
};

} // namespace FicsitAI::Telemetry
