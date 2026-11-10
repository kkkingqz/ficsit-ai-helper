#pragma once

#include "CoreMinimal.h"
#include "SBCLocalization.h"

class UFGItemDescriptor;

struct FSBCIngredientDefinition
{
	FString ItemId;
	double Amount = 0.0;
};

struct FSBCItemDefinition
{
	FString Id;
	FString NameKo;
	FString NameEn;
	FString LocalizedName;
	FString Unit = TEXT("items");
	bool bRawResource = false;
	TSubclassOf<UFGItemDescriptor> DescriptorClass;
};

struct FSBCBuildingDefinition
{
	FString Id;
	FString NameKo;
	FString NameEn;
	FString LocalizedName;
	double BasePowerMW = 0.0;
	double PowerExponent = 1.321929;
	double BoostPowerExponent = 2.0;
	int32 SloopSlots = 0;
	double VariableMinMW = 0.0;
	double VariableMaxMW = 0.0;
};

struct FSBCRecipeDefinition
{
	FString Id;
	FString NameKo;
	FString NameEn;
	FString LocalizedName;
	FString OutputItemId;
	double OutputAmount = 0.0;
	double DurationSeconds = 0.0;
	FString BuildingId;
	TArray<FSBCIngredientDefinition> Ingredients;
	TArray<FSBCIngredientDefinition> Byproducts;
	bool bDefault = false;
	bool bAlternate = false;
	FString Kind = TEXT("manufacturing");
	double GenerationMinMW = 0.0;
	double GenerationMaxMW = 0.0;
	double GridBoostFraction = 0.0;
	int32 SiteLimit = 0;
};

class FSBCProductionData
{
public:
	bool SynchronizeRuntimeRecipes(UObject* WorldContext, FString& OutError);
	bool IsLoaded() const { return bLoaded; }
	const FSBCItemDefinition* FindItem(const FString& ItemId) const;
	const FSBCBuildingDefinition* FindBuilding(const FString& BuildingId) const;
	const FSBCRecipeDefinition* FindRecipe(const FString& RecipeId) const;
	const TArray<FString>* FindRecipesForItem(const FString& ItemId) const;
	const TMap<FString, FSBCItemDefinition>& GetItems() const { return Items; }
	const TMap<FString, FSBCRecipeDefinition>& GetRecipes() const { return Recipes; }
	int32 GetBuildingCount() const { return Buildings.Num(); }
	int32 GetRecipeCount() const { return Recipes.Num(); }
	int32 GetRuntimeRecipeCount() const { return RuntimeRecipeCount; }

private:
	bool bLoaded = false;
	int32 RuntimeRecipeCount = 0;
	TSet<FString> RuntimeRecipeIds;
	TMap<FString, FSBCItemDefinition> Items;
	TMap<FString, FSBCBuildingDefinition> Buildings;
	TMap<FString, FSBCRecipeDefinition> Recipes;
	TMap<FString, TArray<FString>> RecipesByOutput;
};
