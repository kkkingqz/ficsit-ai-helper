#include "Misc/AutomationTest.h"
#include "GameFacade/Telemetry/Generators/FicsitAIGeneratorCollector.h"
#include "GameFacade/Telemetry/PowerStorage/FicsitAIPowerStorageCollector.h"
#include "GameFacade/Telemetry/CircuitBreakers/FicsitAICircuitBreakerCollector.h"
#include "GameFacade/Telemetry/ProductionLoad/FicsitAIMachineLoadCollector.h"
#include "Buildables/FGBuildablePowerStorage.h"
#include "Buildables/FGBuildableCircuitSwitch.h"
#include "Buildables/FGBuildablePriorityPowerSwitch.h"

#if WITH_DEV_AUTOMATION_TESTS

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FFicsitAITelemetryTest, "FicsitAI.Core.TelemetryCollectors", EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FFicsitAITelemetryTest::RunTest(const FString& Parameters)
{
    using namespace FicsitAI::Telemetry;

    // -------------------------------------------------------------------------
    // 1. Тестирование сборщика генераторов (FFicsitAIGeneratorCollector)
    // -------------------------------------------------------------------------
    {
        FGeneratorTelemetryItem NullItem;
        TestFalse(TEXT("Collect(nullptr) возвращает false"), FFicsitAIGeneratorCollector::Collect(nullptr, NullItem));

        TArray<const AFGBuildableGenerator*> EmptyBatch;
        FGeneratorsTelemetryAggregate Aggregate;
        FFicsitAIGeneratorCollector::CollectBatch(EmptyBatch, Aggregate);
        TestEqual(TEXT("Число генераторов в пустом агрегате равно 0"), Aggregate.TotalGenerators, 0);
        TestEqual(TEXT("Выработка в пустом агрегате равна 0"), Aggregate.TotalActualProductionMW, 0.0f);
    }

    // -------------------------------------------------------------------------
    // 2. Тестирование сборщика аккумуляторов (FFicsitAIPowerStorageCollector)
    // -------------------------------------------------------------------------
    {
        FPowerStorageTelemetryItem NullItem;
        TestFalse(TEXT("PowerStorage Collect(nullptr) возвращает false"), FFicsitAIPowerStorageCollector::Collect(nullptr, NullItem));

        AFGBuildablePowerStorage* Battery = NewObject<AFGBuildablePowerStorage>();
        TestNotNull(TEXT("Экземпляр батареи создан"), Battery);

        FPowerStorageTelemetryItem Item;
        TestTrue(TEXT("Collect батареи успешен"), FFicsitAIPowerStorageCollector::Collect(Battery, Item));
        TestFalse(TEXT("BuildingId батареи не пуст"), Item.BuildingId.IsEmpty());

        TArray<const AFGBuildablePowerStorage*> BatteryBatch;
        BatteryBatch.Add(Battery);

        FPowerStorageTelemetryAggregate Aggregate;
        FFicsitAIPowerStorageCollector::CollectBatch(BatteryBatch, Aggregate);
        TestEqual(TEXT("Число батарей в агрегате равно 1"), Aggregate.TotalBatteries, 1);
        TestEqual(TEXT("Элементов в агрегате батарей равно 1"), Aggregate.Items.Num(), 1);

        // Проверка формулы P-7 §4 для времени разряда:
        // t_empty = 3600 * E_stored_MWh / P_out_MW
        // Пример: 5 MWh при отдаче 100 MW должно давать 180 с
        const float StoredMWh = 5.0f;
        const float OutputMW = 100.0f;
        const float ExpectedDrainSeconds = 3600.0f * (StoredMWh / OutputMW);
        TestTrue(TEXT("Проверка формулы времени разряда по протоколу P-7 §4 (180 с)"),
            FMath::IsNearlyEqual(ExpectedDrainSeconds, 180.0f, 0.01f));
    }

    // -------------------------------------------------------------------------
    // 3. Тестирование сборщика рубильников (FFicsitAICircuitBreakerCollector)
    // -------------------------------------------------------------------------
    {
        FCircuitBreakerTelemetryItem NullItem;
        TestFalse(TEXT("CircuitBreaker Collect(nullptr) возвращает false"), FFicsitAICircuitBreakerCollector::Collect(nullptr, NullItem));

        AFGBuildableCircuitSwitch* StandardSwitch = NewObject<AFGBuildableCircuitSwitch>();
        TestNotNull(TEXT("Экземпляр стандартного рубильника создан"), StandardSwitch);

        FCircuitBreakerTelemetryItem StandardItem;
        TestTrue(TEXT("Collect стандартного переключателя успешен"), FFicsitAICircuitBreakerCollector::Collect(StandardSwitch, StandardItem));
        TestFalse(TEXT("Стандартный переключатель не является приоритетным"), StandardItem.bIsPrioritySwitch);
        TestEqual(TEXT("Приоритет стандартного переключателя равен 0"), StandardItem.Priority, 0);

        AFGBuildablePriorityPowerSwitch* PrioritySwitch = NewObject<AFGBuildablePriorityPowerSwitch>();
        FCircuitBreakerTelemetryItem PriorityItem;
        TestTrue(TEXT("Collect приоритетного переключателя успешен"), FFicsitAICircuitBreakerCollector::Collect(PrioritySwitch, PriorityItem));
        TestTrue(TEXT("Приоритетный переключатель распознан"), PriorityItem.bIsPrioritySwitch);
        TestEqual(TEXT("Начальный приоритет переключателя равен 0"), PriorityItem.Priority, 0);

        TArray<const AFGBuildableCircuitSwitch*> SwitchBatch;
        SwitchBatch.Add(StandardSwitch);
        SwitchBatch.Add(PrioritySwitch);

        FCircuitBreakersTelemetryAggregate Aggregate;
        FFicsitAICircuitBreakerCollector::CollectBatch(SwitchBatch, Aggregate);
        TestEqual(TEXT("Всего переключателей в агрегате равно 2"), Aggregate.TotalSwitches, 2);
    }

    // -------------------------------------------------------------------------
    // 4. Тестирование сборщика загрузки машин (FFicsitAIMachineLoadCollector)
    // -------------------------------------------------------------------------
    {
        FMachineLoadTelemetryItem NullItem;
        TestFalse(TEXT("MachineLoad Collect(nullptr) возвращает false"), FFicsitAIMachineLoadCollector::Collect(nullptr, NullItem));

        TArray<const AFGBuildableFactory*> EmptyMachineBatch;
        FMachineLoadTelemetryAggregate Aggregate;
        FFicsitAIMachineLoadCollector::CollectBatch(EmptyMachineBatch, Aggregate);
        TestEqual(TEXT("Всего машин в пустом агрегате равно 0"), Aggregate.TotalMachines, 0);
        TestEqual(TEXT("Средняя продуктивность равна 0"), Aggregate.AverageProductivity, 0.0f);
    }

    return true;
}

#endif
