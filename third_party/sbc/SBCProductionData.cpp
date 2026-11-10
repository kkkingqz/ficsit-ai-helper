#include "SBCProductionData.h"

#include "Buildables/FGBuildable.h"
#include "Buildables/FGBuildableFactory.h"
#include "FGRecipe.h"
#include "FGRecipeManager.h"
#include "Resources/FGBuildingDescriptor.h"
#include "Resources/FGItemDescriptor.h"

namespace
{
	FString Localized(const FString& RuntimeName, const FString& Korean, const FString& English, ESBCLanguage Language)
	{
		if (!RuntimeName.IsEmpty()) return RuntimeName;
		return Language == ESBCLanguage::Korean ? Korean : (English.IsEmpty() ? Korean : English);
	}

	double NormalizeItemAmount(const FItemAmount& ItemAmount)
	{
		if (!ItemAmount.ItemClass)
		{
			return 0.0;
		}
		const EResourceForm Form = UFGItemDescriptor::GetForm(ItemAmount.ItemClass);
		return Form == EResourceForm::RF_LIQUID || Form == EResourceForm::RF_GAS
			? static_cast<double>(ItemAmount.Amount) / 1000.0
			: static_cast<double>(ItemAmount.Amount);
	}

	FString UnitForItem(TSubclassOf<UFGItemDescriptor> ItemClass)
	{
		if (!ItemClass)
		{
			return TEXT("items");
		}
		const EResourceForm Form = UFGItemDescriptor::GetForm(ItemClass);
		return Form == EResourceForm::RF_LIQUID || Form == EResourceForm::RF_GAS ? TEXT("m3") : TEXT("items");
	}
}

bool FSBCProductionData::SynchronizeRuntimeRecipes(UObject* WorldContext, FString& OutError)
{
	OutError.Reset();
	AFGRecipeManager* RecipeManager = AFGRecipeManager::Get(WorldContext);
	if (!RecipeManager)
	{
		OutError = TEXT("Recipe manager is not available yet.");
		return false;
	}

	const ESBCLanguage Language = SBCLocalization::GetCurrentLanguage();
	for (TPair<FString, FSBCItemDefinition>& Pair : Items)
	{
		Pair.Value.LocalizedName = Localized(FString(), Pair.Value.NameKo, Pair.Value.NameEn, Language);
	}
	for (TPair<FString, FSBCBuildingDefinition>& Pair : Buildings)
	{
		Pair.Value.LocalizedName = Localized(FString(), Pair.Value.NameKo, Pair.Value.NameEn, Language);
	}
	for (TPair<FString, FSBCRecipeDefinition>& Pair : Recipes)
	{
		Pair.Value.LocalizedName = Localized(FString(), Pair.Value.NameKo, Pair.Value.NameEn, Language);
	}
	auto UpdateItem = [this](TSubclassOf<UFGItemDescriptor> ItemClass)
	{
		if (!ItemClass) return;
		const FString ItemId = ItemClass->GetName();
		const FString DisplayName = UFGItemDescriptor::GetItemName(ItemClass).ToString();
		if (FSBCItemDefinition* Existing = Items.Find(ItemId))
		{
			Existing->LocalizedName = DisplayName;
			Existing->DescriptorClass = ItemClass;
			return;
		}
		FSBCItemDefinition Item;
		Item.Id = ItemId;
		Item.NameKo = DisplayName;
		Item.NameEn = DisplayName;
		Item.LocalizedName = DisplayName;
		Item.Unit = UnitForItem(ItemClass);
		Item.DescriptorClass = ItemClass;
		Items.Add(Item.Id, MoveTemp(Item));
	};
	auto UpdateBuilding = [this, RecipeManager](TSubclassOf<AFGBuildableFactory> FactoryClass)
	{
		if (!FactoryClass) return;
		const FString BuildingId = FactoryClass->GetName();
		FString DisplayName = BuildingId;
		if (TSubclassOf<UFGBuildingDescriptor> Descriptor = RecipeManager->FindBuildingDescriptorByClass(FactoryClass))
		{
			DisplayName = UFGItemDescriptor::GetItemName(Descriptor).ToString();
		}
		if (FSBCBuildingDefinition* Existing = Buildings.Find(BuildingId))
		{
			Existing->LocalizedName = DisplayName;
			return;
		}
		FSBCBuildingDefinition Building;
		Building.Id = BuildingId;
		Building.NameKo = DisplayName;
		Building.NameEn = DisplayName;
		Building.LocalizedName = DisplayName;
		if (const AFGBuildableFactory* FactoryCDO = FactoryClass->GetDefaultObject<AFGBuildableFactory>())
		{
			Building.BasePowerMW = FactoryCDO->GetDefaultProducingPowerConsumption();
		}
		Buildings.Add(Building.Id, MoveTemp(Building));
	};

	for (const TSubclassOf<AFGBuildable>& BuildableClass : RecipeManager->GetAvailableBuildingsOfType<AFGBuildable>())
	{
		if (BuildableClass && BuildableClass->IsChildOf(AFGBuildableFactory::StaticClass()))
		{
			UpdateBuilding(TSubclassOf<AFGBuildableFactory>(BuildableClass.Get()));
		}
	}

	for (const TSubclassOf<UFGRecipe>& RecipeClass : RecipeManager->GetAllRecipes())
	{
		if (!RecipeClass)
		{
			continue;
		}
		const FString RecipeId = RecipeClass->GetName();
		const TArray<FItemAmount> Products = UFGRecipe::GetProducts(RecipeClass);
		const TArray<FItemAmount> Ingredients = UFGRecipe::GetIngredients(WorldContext, RecipeClass);
		const float Duration = UFGRecipe::GetManufacturingDuration(RecipeClass);
		for (const FItemAmount& Product : Products) UpdateItem(Product.ItemClass);
		for (const FItemAmount& Ingredient : Ingredients) UpdateItem(Ingredient.ItemClass);

		TArray<TSubclassOf<UObject>> Producers = UFGRecipe::GetProducedIn(RecipeClass);
		TSubclassOf<AFGBuildableFactory> FactoryClass;
		for (const TSubclassOf<UObject>& Producer : Producers)
		{
			if (Producer && Producer->IsChildOf(AFGBuildableFactory::StaticClass()))
			{
				FactoryClass = TSubclassOf<AFGBuildableFactory>(Producer.Get());
				break;
			}
		}
		UpdateBuilding(FactoryClass);
		if (FSBCRecipeDefinition* Existing = Recipes.Find(RecipeId))
		{
			Existing->LocalizedName = UFGRecipe::GetRecipeName(RecipeClass).ToString();
			continue;
		}
		if (Products.IsEmpty() || !Products[0].ItemClass || Duration <= 0.0f)
		{
			continue;
		}
		if (!FactoryClass)
		{
			continue;
		}

		const FString BuildingId = FactoryClass->GetName();
		FSBCRecipeDefinition Recipe;
		Recipe.Id = RecipeId;
		Recipe.NameKo = UFGRecipe::GetRecipeName(RecipeClass).ToString();
		Recipe.NameEn = Recipe.NameKo;
		Recipe.LocalizedName = Recipe.NameKo;
		Recipe.OutputItemId = Products[0].ItemClass->GetName();
		Recipe.OutputAmount = NormalizeItemAmount(Products[0]);
		Recipe.DurationSeconds = Duration;
		Recipe.BuildingId = BuildingId;
		Recipe.bAlternate = Recipe.Id.Contains(TEXT("Alternate"), ESearchCase::IgnoreCase);
		Recipe.bDefault = !Recipe.bAlternate && !RecipesByOutput.Contains(Recipe.OutputItemId);
		for (const FItemAmount& Ingredient : Ingredients)
		{
			if (Ingredient.ItemClass)
			{
				Recipe.Ingredients.Add({Ingredient.ItemClass->GetName(), NormalizeItemAmount(Ingredient)});
			}
		}
		for (int32 ProductIndex = 1; ProductIndex < Products.Num(); ++ProductIndex)
		{
			if (Products[ProductIndex].ItemClass)
			{
				Recipe.Byproducts.Add({Products[ProductIndex].ItemClass->GetName(), NormalizeItemAmount(Products[ProductIndex])});
			}
		}
		RecipesByOutput.FindOrAdd(Recipe.OutputItemId).Add(Recipe.Id);
		RuntimeRecipeIds.Add(Recipe.Id);
		Recipes.Add(Recipe.Id, MoveTemp(Recipe));
	}

	for (TPair<FString, FSBCItemDefinition>& Pair : Items)
	{
		if (Pair.Value.LocalizedName.IsEmpty())
		{
			Pair.Value.LocalizedName = Localized(FString(), Pair.Value.NameKo, Pair.Value.NameEn, Language);
		}
	}
	for (TPair<FString, FSBCBuildingDefinition>& Pair : Buildings)
	{
		if (Pair.Value.LocalizedName.IsEmpty())
		{
			Pair.Value.LocalizedName = Localized(FString(), Pair.Value.NameKo, Pair.Value.NameEn, Language);
		}
	}
	for (TPair<FString, FSBCRecipeDefinition>& Pair : Recipes)
	{
		FSBCRecipeDefinition& Recipe = Pair.Value;
		if (Recipe.Kind != TEXT("manufacturing"))
		{
			const FSBCBuildingDefinition* Building = Buildings.Find(Recipe.BuildingId);
			const FSBCItemDefinition* Fuel = Recipe.Ingredients.IsEmpty() ? nullptr : Items.Find(Recipe.Ingredients[0].ItemId);
			if (Building)
			{
				Recipe.LocalizedName = Fuel
					? FString::Printf(TEXT("%s · %s"), *Building->LocalizedName, *Fuel->LocalizedName)
					: Building->LocalizedName;
			}
		}
		if (Recipe.LocalizedName.IsEmpty())
		{
			Recipe.LocalizedName = Localized(FString(), Recipe.NameKo, Recipe.NameEn, Language);
		}
	}

	for (TPair<FString, FSBCItemDefinition>& Pair : Items)
	{
		if (!RecipesByOutput.Contains(Pair.Key))
		{
			Pair.Value.bRawResource = true;
		}
	}
	bLoaded = Items.Num() > 0 && Buildings.Num() > 0 && Recipes.Num() > 0;
	RuntimeRecipeCount = RuntimeRecipeIds.Num();
	return true;
}

const FSBCItemDefinition* FSBCProductionData::FindItem(const FString& ItemId) const { return Items.Find(ItemId); }
const FSBCBuildingDefinition* FSBCProductionData::FindBuilding(const FString& BuildingId) const { return Buildings.Find(BuildingId); }
const FSBCRecipeDefinition* FSBCProductionData::FindRecipe(const FString& RecipeId) const { return Recipes.Find(RecipeId); }
const TArray<FString>* FSBCProductionData::FindRecipesForItem(const FString& ItemId) const { return RecipesByOutput.Find(ItemId); }
