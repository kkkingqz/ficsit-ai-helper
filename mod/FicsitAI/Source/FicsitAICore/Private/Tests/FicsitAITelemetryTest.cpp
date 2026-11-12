#include "Misc/AutomationTest.h"
#include "GameFacade/Telemetry/Generators/FicsitAIGeneratorCollector.h"
#include "GameFacade/Telemetry/PowerStorage/FicsitAIPowerStorageCollector.h"
#include "GameFacade/Telemetry/CircuitBreakers/FicsitAICircuitBreakerCollector.h"
#include "GameFacade/Telemetry/ProductionLoad/FicsitAIMachineLoadCollector.h"
#include "Buildables/FGBuildableAutomatedWorkBench.h"
#include "Buildables/FGBuildableCheatItemSink.h"
#include "Buildables/FGBuildableCircuitSwitch.h"
#include "Buildables/FGBuildableGeneratorFuel.h"
#include "Buildables/FGBuildableGeneratorGeoThermal.h"
#include "Buildables/FGBuildableGeneratorNuclear.h"
#include "Buildables/FGBuildablePowerStorage.h"
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
        NullItem.ProductionCapacityMW = 123.0f;
        TestFalse(TEXT("Collect(nullptr) возвращает false"), FFicsitAIGeneratorCollector::Collect(nullptr, NullItem));
        TestEqual(TEXT("Неуспешный Collect не перезаписывает OutItem"), NullItem.ProductionCapacityMW, 123.0f);

        AFGBuildableGeneratorFuel* FuelGen = NewObject<AFGBuildableGeneratorFuel>();
        AFGBuildableGeneratorNuclear* NuclearGen = NewObject<AFGBuildableGeneratorNuclear>();
        AFGBuildableGeneratorGeoThermal* GeoGen = NewObject<AFGBuildableGeneratorGeoThermal>();
        TestNotNull(TEXT("Экземпляр FuelGen создан"), FuelGen);
        TestNotNull(TEXT("Экземпляр NuclearGen создан"), NuclearGen);
        TestNotNull(TEXT("Экземпляр GeoGen создан"), GeoGen);

        FGeneratorTelemetryItem ReusedItem;
        // Предварительно загрязняем поля перед первым чтением
        ReusedItem.bIsGeoThermal = true;
        ReusedItem.MinProductionMW = 999.0f;
        ReusedItem.CurrentFuelClass = FName(TEXT("Desc_FakeFuel_C"));
        ReusedItem.FuelAmountRatio = 0.75f;
        ReusedItem.bRequiresSupplemental = true;

        TestTrue(TEXT("Collect FuelGen успешен"), FFicsitAIGeneratorCollector::Collect(FuelGen, ReusedItem));
        TestEqual(TEXT("Тип генератора Fuel распознан"), ReusedItem.GeneratorType, EFicsitAIGeneratorType::Fuel);
        TestTrue(TEXT("Флаг bIsFuelGenerator установлен"), ReusedItem.bIsFuelGenerator);
        TestFalse(TEXT("Старый флаг bIsGeoThermal сброшен"), ReusedItem.bIsGeoThermal);
        TestEqual(TEXT("Старый MinProductionMW сброшен"), ReusedItem.MinProductionMW, 0.0f);

        // Загрязняем топливные поля и переиспользуем тот же DTO на GeoThermal ([P2])
        ReusedItem.bIsFuelGenerator = true;
        ReusedItem.bHasFuel = true;
        ReusedItem.CurrentFuelClass = FName(TEXT("Desc_Coal_C"));
        ReusedItem.FuelAmountRatio = 0.5f;
        ReusedItem.bRequiresSupplemental = true;

        TestTrue(TEXT("Collect GeoGen в тот же DTO успешен"), FFicsitAIGeneratorCollector::Collect(GeoGen, ReusedItem));
        TestEqual(TEXT("Тип генератора GeoThermal распознан"), ReusedItem.GeneratorType, EFicsitAIGeneratorType::GeoThermal);
        TestTrue(TEXT("Флаг bIsGeoThermal установлен"), ReusedItem.bIsGeoThermal);
        TestFalse(TEXT("Флаг bIsFuelGenerator сброшен"), ReusedItem.bIsFuelGenerator);
        TestFalse(TEXT("Флаг bHasFuel сброшен"), ReusedItem.bHasFuel);
        TestEqual(TEXT("Старый CurrentFuelClass сброшен"), ReusedItem.CurrentFuelClass, NAME_None);
        TestEqual(TEXT("Старый FuelAmountRatio сброшен"), ReusedItem.FuelAmountRatio, 0.0f);
        TestFalse(TEXT("Старый bRequiresSupplemental сброшен"), ReusedItem.bRequiresSupplemental);

        FGeneratorTelemetryItem NuclearItem;
        TestTrue(TEXT("Collect NuclearGen успешен"), FFicsitAIGeneratorCollector::Collect(NuclearGen, NuclearItem));
        TestEqual(TEXT("Тип генератора Nuclear распознан"), NuclearItem.GeneratorType, EFicsitAIGeneratorType::Nuclear);
        TestTrue(TEXT("NuclearGen является подклассом FuelGen"), NuclearItem.bIsFuelGenerator);

        // Агрегация на готовых POD-снимках (worker-safe)
        TArray<FGeneratorTelemetryItem> Snapshots;
        {
            FGeneratorTelemetryItem Coal1;
            Coal1.ClassName = FName(TEXT("Build_GeneratorCoal_C"));
            Coal1.bIsProducing = true;
            Coal1.ProductionCapacityMW = 75.0f;
            Coal1.CurrentProductionMW = 75.0f;
            Snapshots.Add(Coal1);

            FGeneratorTelemetryItem Coal2;
            Coal2.ClassName = FName(TEXT("Build_GeneratorCoal_C"));
            Coal2.bIsProducing = false;
            Coal2.ProductionCapacityMW = 75.0f;
            Coal2.CurrentProductionMW = 0.0f;
            Snapshots.Add(Coal2);

            FGeneratorTelemetryItem Geo;
            Geo.ClassName = FName(TEXT("Build_GeneratorGeoThermal_C"));
            Geo.bIsProducing = true;
            Geo.ProductionCapacityMW = 200.0f;
            Geo.CurrentProductionMW = 200.0f;
            Snapshots.Add(Geo);
        }

        FGeneratorsTelemetryAggregate Aggregate;
        FFicsitAIGeneratorCollector::Aggregate(Snapshots, Aggregate);
        TestEqual(TEXT("Всего генераторов в агрегате — 3"), Aggregate.TotalGenerators, 3);
        TestEqual(TEXT("Работающих генераторов — 2"), Aggregate.RunningGenerators, 2);
        TestTrue(TEXT("Суммарная ёмкость генераторов — 350 MW"), FMath::IsNearlyEqual(Aggregate.TotalProductionCapacityMW, 350.0f));
        TestTrue(TEXT("Суммарная фактическая выработка — 275 MW"), FMath::IsNearlyEqual(Aggregate.TotalActualProductionMW, 275.0f));
        TestEqual(TEXT("Число угольных генераторов — 2"), Aggregate.CountByClass.FindRef(FName(TEXT("Build_GeneratorCoal_C"))), 2);
        TestTrue(TEXT("Выработка угольных — 75 MW"), FMath::IsNearlyEqual(Aggregate.ProductionByClassMW.FindRef(FName(TEXT("Build_GeneratorCoal_C"))), 75.0f));
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
        TestNotEqual(TEXT("ClassName батареи не пуст"), Item.ClassName, FName(NAME_None));

        // Сценарий разряда (P-7 §4 / metrics-v0.1.md): 5 MWh при отдаче 100 MW = 180 с
        {
            TArray<FPowerStorageTelemetryItem> DrainSnapshots;
            FPowerStorageTelemetryItem S;
            S.BatteryStatus = EFicsitAIBatteryStatus::PowerOut;
            S.StoredPowerMWh = 5.0f;
            S.CapacityMWh = 100.0f;
            S.PowerOutputMW = 100.0f;
            DrainSnapshots.Add(S);

            FPowerStorageTelemetryAggregate DrainAgg;
            FFicsitAIPowerStorageCollector::Aggregate(DrainSnapshots, DrainAgg);
            TestEqual(TEXT("Разряжающихся батарей — 1"), DrainAgg.DischargingBatteries, 1);
            TestTrue(TEXT("Время разряда задано и равно 180 с"),
                DrainAgg.EstimatedTimeToEmptySeconds.IsSet() && FMath::IsNearlyEqual(DrainAgg.EstimatedTimeToEmptySeconds.GetValue(), 180.0f, 0.01f));
            TestFalse(TEXT("Время до полного заряда неприменимо при разряде"), DrainAgg.EstimatedTimeToFullSeconds.IsSet());
        }

        // Сценарий заряда: 40/100 MWh при заряде 50 MW -> (100-40)*3600/50 = 4320 с
        {
            TArray<FPowerStorageTelemetryItem> ChargeSnapshots;
            FPowerStorageTelemetryItem S;
            S.BatteryStatus = EFicsitAIBatteryStatus::PowerIn;
            S.StoredPowerMWh = 40.0f;
            S.CapacityMWh = 100.0f;
            S.PowerInputMW = 50.0f;
            ChargeSnapshots.Add(S);

            FPowerStorageTelemetryAggregate ChargeAgg;
            FFicsitAIPowerStorageCollector::Aggregate(ChargeSnapshots, ChargeAgg);
            TestEqual(TEXT("Заряжающихся батарей — 1"), ChargeAgg.ChargingBatteries, 1);
            TestFalse(TEXT("Время разряда неприменимо при заряде"), ChargeAgg.EstimatedTimeToEmptySeconds.IsSet());
            TestTrue(TEXT("Время заряда задано и равно 4320 с"),
                ChargeAgg.EstimatedTimeToFullSeconds.IsSet() && FMath::IsNearlyEqual(ChargeAgg.EstimatedTimeToFullSeconds.GetValue(), 4320.0f, 0.01f));
        }

        // Сценарий покоя (нулевой обмен): обе оценки времени неприменимы
        {
            TArray<FPowerStorageTelemetryItem> IdleSnapshots;
            FPowerStorageTelemetryItem S;
            S.BatteryStatus = EFicsitAIBatteryStatus::Idle;
            S.StoredPowerMWh = 50.0f;
            S.CapacityMWh = 100.0f;
            IdleSnapshots.Add(S);

            FPowerStorageTelemetryAggregate IdleAgg;
            FFicsitAIPowerStorageCollector::Aggregate(IdleSnapshots, IdleAgg);
            TestFalse(TEXT("Время разряда неприменимо при покое"), IdleAgg.EstimatedTimeToEmptySeconds.IsSet());
            TestFalse(TEXT("Время заряда неприменимо при покое"), IdleAgg.EstimatedTimeToFullSeconds.IsSet());
        }
    }

    // -------------------------------------------------------------------------
    // 3. Тестирование сборщика рубильников (FFicsitAICircuitBreakerCollector)
    // -------------------------------------------------------------------------
    {
        FCircuitBreakerTelemetryItem NullItem;
        TestFalse(TEXT("CircuitBreaker Collect(nullptr) возвращает false"), FFicsitAICircuitBreakerCollector::Collect(nullptr, NullItem));

        AFGBuildablePriorityPowerSwitch* PrioritySwitch = NewObject<AFGBuildablePriorityPowerSwitch>();
        AFGBuildableCircuitSwitch* StandardSwitch = NewObject<AFGBuildableCircuitSwitch>();

        FCircuitBreakerTelemetryItem SwitchItem;
        TestTrue(TEXT("Collect приоритетного переключателя успешен"), FFicsitAICircuitBreakerCollector::Collect(PrioritySwitch, SwitchItem));
        TestTrue(TEXT("Приоритетный переключатель распознан"), SwitchItem.bIsPrioritySwitch);
        TestEqual(TEXT("Начальный приоритет переключателя равен 0"), SwitchItem.Priority, 0);

        // Повторное чтение стандартного переключателя в тот же DTO сбрасывает bIsPrioritySwitch ([P2])
        SwitchItem.Priority = 7;
        TestTrue(TEXT("Collect стандартного переключателя в тот же DTO успешен"), FFicsitAICircuitBreakerCollector::Collect(StandardSwitch, SwitchItem));
        TestFalse(TEXT("Старый флаг bIsPrioritySwitch сброшен"), SwitchItem.bIsPrioritySwitch);
        TestEqual(TEXT("Старый приоритет сброшен в 0"), SwitchItem.Priority, 0);

        // Агрегация на POD-снимках
        TArray<FCircuitBreakerTelemetryItem> SwitchSnapshots;
        {
            FCircuitBreakerTelemetryItem OnSw;
            OnSw.bIsConnected = true;
            OnSw.bIsSwitchOn = true;
            SwitchSnapshots.Add(OnSw);

            FCircuitBreakerTelemetryItem OffSw;
            OffSw.bIsConnected = true;
            OffSw.bIsSwitchOn = false;
            SwitchSnapshots.Add(OffSw);

            FCircuitBreakerTelemetryItem DiscSw;
            DiscSw.bIsConnected = false;
            DiscSw.bIsSwitchOn = true;
            SwitchSnapshots.Add(DiscSw);
        }

        FCircuitBreakersTelemetryAggregate Aggregate;
        FFicsitAICircuitBreakerCollector::Aggregate(SwitchSnapshots, Aggregate);
        TestEqual(TEXT("Всего переключателей в агрегате — 3"), Aggregate.TotalSwitches, 3);
        TestEqual(TEXT("Включенных подключённых — 1"), Aggregate.OnSwitches, 1);
        TestEqual(TEXT("Выключенных подключённых — 1"), Aggregate.OffSwitches, 1);
        TestEqual(TEXT("Отключённых от цепи — 1"), Aggregate.DisconnectedSwitches, 1);
    }

    // -------------------------------------------------------------------------
    // 4. Тестирование сборщика загрузки машин (FFicsitAIMachineLoadCollector)
    // -------------------------------------------------------------------------
    {
        FMachineLoadTelemetryItem NullItem;
        TestFalse(TEXT("MachineLoad Collect(nullptr) возвращает false"), FFicsitAIMachineLoadCollector::Collect(nullptr, NullItem));

        // Проверка перезаписи грязного DTO ([P2]) и отсутствия ложных буферных флагов при отсутствии рецепта
        AFGBuildableAutomatedWorkBench* Bench = NewObject<AFGBuildableAutomatedWorkBench>();
        AFGBuildableCheatItemSink* NonManufacturerFactory = NewObject<AFGBuildableCheatItemSink>();
        TestNotNull(TEXT("Экземпляр AutomatedWorkBench создан"), Bench);
        TestNotNull(TEXT("Экземпляр CheatItemSink создан"), NonManufacturerFactory);

        FMachineLoadTelemetryItem MachineItem;
        MachineItem.CurrentRecipeClass = FName(TEXT("Recipe_Old_C"));
        MachineItem.bHasIngredientsForCycle = true;
        MachineItem.bHasOutputSpaceForCycle = false;
        MachineItem.bIsProductionPaused = true;

        TestTrue(TEXT("Collect WorkBench в грязный DTO успешен"), FFicsitAIMachineLoadCollector::Collect(Bench, MachineItem));
        TestEqual(TEXT("Старый CurrentRecipeClass сброшен"), MachineItem.CurrentRecipeClass, NAME_None);
        TestFalse(TEXT("Старый bIsProductionPaused сброшен"), MachineItem.bIsProductionPaused);
        TestFalse(TEXT("Признак входа не выставляется без рецепта"), MachineItem.bHasIngredientsForCycle.IsSet());
        TestFalse(TEXT("Признак выхода не выставляется без рецепта"), MachineItem.bHasOutputSpaceForCycle.IsSet());

        MachineItem.CurrentRecipeClass = FName(TEXT("Recipe_Stale_C"));
        MachineItem.bHasIngredientsForCycle = false;
        TestTrue(TEXT("Collect не-производственной фабрики успешен"), FFicsitAIMachineLoadCollector::Collect(NonManufacturerFactory, MachineItem));
        TestEqual(TEXT("Старый рецепт сброшен на фабрике без рецепта"), MachineItem.CurrentRecipeClass, NAME_None);
        TestFalse(TEXT("На не-производственной фабрике буферные признаки не заданы"), MachineItem.bHasIngredientsForCycle.IsSet());
        TestFalse(TEXT("На не-производственной фабрике место выхода не задано"), MachineItem.bHasOutputSpaceForCycle.IsSet());

        // Агрегация снимков загрузки на воркере (без статусов FR-23 и без Items)
        TArray<FMachineLoadTelemetryItem> MachineSnapshots;
        {
            FMachineLoadTelemetryItem M1;
            M1.ClassName = FName(TEXT("Build_SmelterMk1_C"));
            M1.CurrentRecipeClass = FName(TEXT("Recipe_IngotIron_C"));
            M1.bHasPower = true;
            M1.bIsProducing = true;
            M1.bIsConfigured = true;
            M1.Productivity = 1.0f;
            MachineSnapshots.Add(M1);

            FMachineLoadTelemetryItem M2;
            M2.ClassName = FName(TEXT("Build_SmelterMk1_C"));
            M2.CurrentRecipeClass = FName(TEXT("Recipe_IngotIron_C"));
            M2.bHasPower = true;
            M2.bIsProducing = false;
            M2.bIsProductionPaused = true;
            M2.bIsStandby = true;
            M2.bIsConfigured = true;
            M2.Productivity = 0.5f;
            MachineSnapshots.Add(M2);

            FMachineLoadTelemetryItem M3;
            M3.ClassName = FName(TEXT("Build_ConstructorMk1_C"));
            M3.bHasPower = false;
            M3.bIsProducing = false;
            M3.bIsConfigured = false;
            M3.Productivity = 0.0f;
            MachineSnapshots.Add(M3);
        }

        FMachineLoadTelemetryAggregate MachineAgg;
        FFicsitAIMachineLoadCollector::Aggregate(MachineSnapshots, MachineAgg);
        TestEqual(TEXT("Всего машин в агрегате — 3"), MachineAgg.TotalMachines, 3);
        TestEqual(TEXT("Работающих машин — 1"), MachineAgg.ProducingMachines, 1);
        TestEqual(TEXT("На паузе — 1"), MachineAgg.PausedMachines, 1);
        TestEqual(TEXT("Без питания — 1"), MachineAgg.UnpoweredMachines, 1);
        TestEqual(TEXT("Без рецепта — 1"), MachineAgg.UnconfiguredMachines, 1);
        TestTrue(TEXT("Средняя продуктивность равна 0.5"), FMath::IsNearlyEqual(MachineAgg.AverageProductivity, 0.5f, 0.001f));
        TestEqual(TEXT("Плавилен по классу — 2"), MachineAgg.CountByClass.FindRef(FName(TEXT("Build_SmelterMk1_C"))), 2);
        TestEqual(TEXT("Рецептов слитков железа — 2"), MachineAgg.CountByRecipe.FindRef(FName(TEXT("Recipe_IngotIron_C"))), 2);
    }

    return true;
}

#endif
