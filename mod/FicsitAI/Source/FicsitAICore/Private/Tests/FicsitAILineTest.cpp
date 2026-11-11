#include "Misc/AutomationTest.h"
#include "GameFacade/Lines/FicsitAILineRegistry.h"
#include "GameFacade/Lines/FicsitAILineTypes.h"

#if WITH_DEV_AUTOMATION_TESTS

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FFicsitAILineTest, "FicsitAI.Core.LinesAndBuildingId", EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FFicsitAILineTest::RunTest(const FString& Parameters)
{
    using namespace FicsitAI::Lines;

    // -------------------------------------------------------------------------
    // 1. Проверка формата buildingId (R-19, ARCHITECTURE §5.7, §8.6)
    // -------------------------------------------------------------------------
    {
        // Идентификаторы построек соответствуют пути объекта в уровне Satisfactory:
        // Persistent_Level:PersistentLevel.<ClassName>_<InstanceId> (line.example.json)
        const FString ExampleBuildingId1 = TEXT("Persistent_Level:PersistentLevel.Build_GeneratorCoal_C_2147290811");
        const FString ExampleBuildingId2 = TEXT("Persistent_Level:PersistentLevel.Build_GeneratorCoal_C_2147290740");

        FBuildingRef Ref1{ ExampleBuildingId1, FName(TEXT("Build_GeneratorCoal_C")) };
        FBuildingRef Ref2{ ExampleBuildingId2, FName(TEXT("Build_GeneratorCoal_C")) };
        FBuildingRef Ref1Duplicate{ ExampleBuildingId1, FName(TEXT("Build_GeneratorCoal_C")) };

        TestTrue(TEXT("Одинаковые buildingId равны"), Ref1 == Ref1Duplicate);
        TestFalse(TEXT("Разные buildingId не равны"), Ref1 == Ref2);
        TestTrue(TEXT("buildingId содержит путь уровня PersistentLevel"), Ref1.BuildingId.Contains(TEXT("PersistentLevel.")));
    }

    // -------------------------------------------------------------------------
    // 2. Тестирование реестра производственных линий (FFicsitAILineRegistry)
    // -------------------------------------------------------------------------
    {
        FFicsitAILineRegistry Registry;

        // Создаем две линии
        FProductionLine LineIron;
        LineIron.LineId = TEXT("line-iron-ingots");
        LineIron.Name = TEXT("Iron Ingot Line #1");
        LineIron.Source = TEXT("manual");

        FBuildingRef Smelter1{ TEXT("Persistent_Level:PersistentLevel.Build_Smelter_C_1"), FName(TEXT("Build_Smelter_C")) };
        FBuildingRef Smelter2{ TEXT("Persistent_Level:PersistentLevel.Build_Smelter_C_2"), FName(TEXT("Build_Smelter_C")) };
        LineIron.Members.Add(Smelter1);
        LineIron.Members.Add(Smelter2);

        TestTrue(TEXT("Регистрация LineIron успешна"), Registry.RegisterLine(LineIron));

        FProductionLine LineCopper;
        LineCopper.LineId = TEXT("line-copper-ingots");
        LineCopper.Name = TEXT("Copper Line");
        TestTrue(TEXT("Регистрация LineCopper успешна"), Registry.RegisterLine(LineCopper));

        // Проверка поиска по ID линии
        FProductionLine FoundLine;
        TestTrue(TEXT("LineIron найдена по ID"), Registry.FindLineById(TEXT("line-iron-ingots"), FoundLine));
        TestEqual(TEXT("В LineIron 2 постройки"), FoundLine.Members.Num(), 2);
        TestEqual(TEXT("Имя линии совпадает"), FoundLine.Name, TEXT("Iron Ingot Line #1"));

        // Проверка обратного поиска: постройка -> линия
        FProductionLine OwnerLine;
        TestTrue(TEXT("Smelter1 привязан к LineIron"), Registry.FindLineForBuilding(Smelter1.BuildingId, OwnerLine));
        TestEqual(TEXT("ID линии для Smelter1 совпадает"), OwnerLine.LineId, TEXT("line-iron-ingots"));

        // Добавление новой постройки в существующую линию
        FBuildingRef Smelter3{ TEXT("Persistent_Level:PersistentLevel.Build_Smelter_C_3"), FName(TEXT("Build_Smelter_C")) };
        TestTrue(TEXT("Добавление Smelter3 в LineIron"), Registry.AddBuildingToLine(TEXT("line-iron-ingots"), Smelter3));

        TestTrue(TEXT("Smelter3 найден в LineIron"), Registry.FindLineForBuilding(Smelter3.BuildingId, OwnerLine));
        TestEqual(TEXT("ID линии для Smelter3 — line-iron-ingots"), OwnerLine.LineId, TEXT("line-iron-ingots"));

        // Перемещение постройки из одной линии в другую
        TestTrue(TEXT("Перемещение Smelter3 в LineCopper"), Registry.AddBuildingToLine(TEXT("line-copper-ingots"), Smelter3));
        TestTrue(TEXT("Smelter3 теперь в LineCopper"), Registry.FindLineForBuilding(Smelter3.BuildingId, OwnerLine));
        TestEqual(TEXT("ID линии для Smelter3 теперь line-copper-ingots"), OwnerLine.LineId, TEXT("line-copper-ingots"));

        // Проверяем, что из LineIron постройка Smelter3 корректно удалилась
        Registry.FindLineById(TEXT("line-iron-ingots"), FoundLine);
        TestEqual(TEXT("В LineIron снова 2 постройки"), FoundLine.Members.Num(), 2);

        // Удаление постройки из линии
        TestTrue(TEXT("Удаление Smelter1 из LineIron"), Registry.RemoveBuildingFromLine(TEXT("line-iron-ingots"), Smelter1.BuildingId));
        TestFalse(TEXT("Smelter1 больше не привязан к линии"), Registry.FindLineForBuilding(Smelter1.BuildingId, OwnerLine));

        // Всего линий
        TestEqual(TEXT("Всего линий в реестре — 2"), Registry.GetAllLines().Num(), 2);

        // Удаление линии
        TestTrue(TEXT("Удаление LineIron"), Registry.UnregisterLine(TEXT("line-iron-ingots")));
        TestFalse(TEXT("LineIron больше не существует"), Registry.FindLineById(TEXT("line-iron-ingots"), FoundLine));
        TestFalse(TEXT("Smelter2 потерял привязку после удаления линии"), Registry.FindLineForBuilding(Smelter2.BuildingId, OwnerLine));
        TestEqual(TEXT("Осталась 1 линия"), Registry.GetAllLines().Num(), 1);
    }

    return true;
}

#endif
