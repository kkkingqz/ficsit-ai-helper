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

        // Создаем две линии (согласно line.schema.json и line.example.json)
        FProductionLine LineIron;
        LineIron.LineId = TEXT("line_iron_ingots");
        LineIron.SaveId = TEXT("5f0c9a52-3d1e-4b8a-9c47-2e6d8f1a7b30");
        LineIron.Name = TEXT("Iron Ingot Line #1");
        LineIron.Source = TEXT("manual");

        FBuildingRef Smelter1{ TEXT("Persistent_Level:PersistentLevel.Build_Smelter_C_1"), FName(TEXT("Build_Smelter_C")) };
        FBuildingRef Smelter2{ TEXT("Persistent_Level:PersistentLevel.Build_Smelter_C_2"), FName(TEXT("Build_Smelter_C")) };
        LineIron.Members.Add(Smelter1);
        LineIron.Members.Add(Smelter2);

        TestTrue(TEXT("Регистрация LineIron успешна"), Registry.RegisterLine(LineIron));

        FProductionLine LineCopper;
        LineCopper.LineId = TEXT("line_copper_ingots");
        LineCopper.SaveId = TEXT("5f0c9a52-3d1e-4b8a-9c47-2e6d8f1a7b30");
        LineCopper.Name = TEXT("Copper Line");
        TestTrue(TEXT("Регистрация LineCopper успешна"), Registry.RegisterLine(LineCopper));

        // Проверка поиска по ID линии
        FProductionLine FoundLine;
        TestTrue(TEXT("LineIron найдена по ID"), Registry.FindLineById(TEXT("line_iron_ingots"), FoundLine));
        TestEqual(TEXT("В LineIron 2 постройки"), FoundLine.Members.Num(), 2);
        TestEqual(TEXT("Имя линии совпадает"), FoundLine.Name, TEXT("Iron Ingot Line #1"));
        TestEqual(TEXT("SaveId линии совпадает"), FoundLine.SaveId, TEXT("5f0c9a52-3d1e-4b8a-9c47-2e6d8f1a7b30"));

        // Проверка обратного поиска: постройка -> линия
        FProductionLine OwnerLine;
        TestTrue(TEXT("Smelter1 привязан к LineIron"), Registry.FindLineForBuilding(Smelter1.BuildingId, OwnerLine));
        TestEqual(TEXT("ID линии для Smelter1 совпадает"), OwnerLine.LineId, TEXT("line_iron_ingots"));

        // Добавление новой постройки в существующую линию
        FBuildingRef Smelter3{ TEXT("Persistent_Level:PersistentLevel.Build_Smelter_C_3"), FName(TEXT("Build_Smelter_C")) };
        TestTrue(TEXT("Добавление Smelter3 в LineIron"), Registry.AddBuildingToLine(TEXT("line_iron_ingots"), Smelter3));

        TestTrue(TEXT("Smelter3 найден в LineIron"), Registry.FindLineForBuilding(Smelter3.BuildingId, OwnerLine));
        TestEqual(TEXT("ID линии для Smelter3 — line_iron_ingots"), OwnerLine.LineId, TEXT("line_iron_ingots"));

        // Перемещение постройки из одной линии в другую
        TestTrue(TEXT("Перемещение Smelter3 в LineCopper"), Registry.AddBuildingToLine(TEXT("line_copper_ingots"), Smelter3));
        TestTrue(TEXT("Smelter3 теперь в LineCopper"), Registry.FindLineForBuilding(Smelter3.BuildingId, OwnerLine));
        TestEqual(TEXT("ID линии для Smelter3 теперь line_copper_ingots"), OwnerLine.LineId, TEXT("line_copper_ingots"));

        // Проверяем, что из LineIron постройка Smelter3 корректно удалилась
        Registry.FindLineById(TEXT("line_iron_ingots"), FoundLine);
        TestEqual(TEXT("В LineIron снова 2 постройки"), FoundLine.Members.Num(), 2);

        // Удаление постройки из линии
        TestTrue(TEXT("Удаление Smelter1 из LineIron"), Registry.RemoveBuildingFromLine(TEXT("line_iron_ingots"), Smelter1.BuildingId));
        TestFalse(TEXT("Smelter1 больше не привязан к линии"), Registry.FindLineForBuilding(Smelter1.BuildingId, OwnerLine));

        // Всего линий
        TestEqual(TEXT("Всего линий в реестре — 2"), Registry.GetAllLines().Num(), 2);

        // Удаление линии
        TestTrue(TEXT("Удаление LineIron"), Registry.UnregisterLine(TEXT("line_iron_ingots")));
        TestFalse(TEXT("LineIron больше не существует"), Registry.FindLineById(TEXT("line_iron_ingots"), FoundLine));
        TestFalse(TEXT("Smelter2 потерял привязку после удаления линии"), Registry.FindLineForBuilding(Smelter2.BuildingId, OwnerLine));
        TestEqual(TEXT("Осталась 1 линия"), Registry.GetAllLines().Num(), 1);
    }

    // -------------------------------------------------------------------------
    // 3. Проверка консистентности индексов при двойном RegisterLine и удалении
    // -------------------------------------------------------------------------
    {
        FFicsitAILineRegistry Registry;

        const FBuildingRef S1{ TEXT("Persistent_Level:PersistentLevel.Build_Smelter_C_10"), FName(TEXT("Build_Smelter_C")) };
        const FBuildingRef S2{ TEXT("Persistent_Level:PersistentLevel.Build_Smelter_C_11"), FName(TEXT("Build_Smelter_C")) };
        const FBuildingRef S3{ TEXT("Persistent_Level:PersistentLevel.Build_Smelter_C_12"), FName(TEXT("Build_Smelter_C")) };

        FProductionLine LineA;
        LineA.LineId = TEXT("line_a");
        LineA.Name = TEXT("Line A");
        LineA.Members = { S1, S2 };
        TestTrue(TEXT("Регистрация LineA"), Registry.RegisterLine(LineA));

        // Регистрируем LineB с уже принадлежащей LineA постройкой S1
        FProductionLine LineB;
        LineB.LineId = TEXT("line_b");
        LineB.Name = TEXT("Line B");
        LineB.Members = { S1, S3 };
        TestTrue(TEXT("Регистрация LineB с переносом S1"), Registry.RegisterLine(LineB));

        FProductionLine ReadA;
        TestTrue(TEXT("LineA найдена"), Registry.FindLineById(TEXT("line_a"), ReadA));
        TestEqual(TEXT("После переноса S1 в LineA осталась только 1 постройка"), ReadA.Members.Num(), 1);
        if (ReadA.Members.Num() == 1)
        {
            TestEqual(TEXT("В LineA остался именно S2"), ReadA.Members[0].BuildingId, S2.BuildingId);
        }

        FProductionLine Owner;
        TestTrue(TEXT("Поиск по S1 возвращает LineB"), Registry.FindLineForBuilding(S1.BuildingId, Owner));
        TestEqual(TEXT("Владелец S1 — line_b"), Owner.LineId, TEXT("line_b"));

        // Удаление LineA не должно затрагивать S1 в LineB
        TestTrue(TEXT("Удаление LineA"), Registry.UnregisterLine(TEXT("line_a")));
        TestTrue(TEXT("S1 по-прежнему привязан к LineB после удаления LineA"), Registry.FindLineForBuilding(S1.BuildingId, Owner));
        TestEqual(TEXT("Владелец S1 после удаления LineA — line_b"), Owner.LineId, TEXT("line_b"));
        TestFalse(TEXT("S2 отвязан после удаления LineA"), Registry.FindLineForBuilding(S2.BuildingId, Owner));

        // Повторная регистрация LineB с заменой S1 -> S2 (и дубликатом в входе)
        FProductionLine LineBUpdated;
        LineBUpdated.LineId = TEXT("line_b");
        LineBUpdated.Name = TEXT("Line B Updated");
        LineBUpdated.Members = { S2, S3, S2 };
        TestTrue(TEXT("Обновление LineB через RegisterLine"), Registry.RegisterLine(LineBUpdated));
        TestFalse(TEXT("S1 отвязан после обновления состава LineB"), Registry.FindLineForBuilding(S1.BuildingId, Owner));
        TestTrue(TEXT("S2 привязан к LineB"), Registry.FindLineForBuilding(S2.BuildingId, Owner));
        TestEqual(TEXT("Владелец S2 — line_b"), Owner.LineId, TEXT("line_b"));

        FProductionLine ReadB;
        TestTrue(TEXT("LineB найдена"), Registry.FindLineById(TEXT("line_b"), ReadB));
        TestEqual(TEXT("Дубликат S2 отфильтрован (ровно 2 постройки)"), ReadB.Members.Num(), 2);
    }

    return true;
}

#endif
