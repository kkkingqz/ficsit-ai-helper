#include "GameFacade/Terminal/FicsitAITerminalSchematic.h"
#include "GameFacade/Terminal/FicsitAITerminalRecipe.h"

UFicsitAIUnlockTerminalRecipe::UFicsitAIUnlockTerminalRecipe()
{
    mRecipes.Add(UFicsitAITerminalRecipe::StaticClass());
}

UFicsitAITerminalSchematic::UFicsitAITerminalSchematic()
{
    mType = ESchematicType::EST_Custom;
    mDisplayName = NSLOCTEXT("FicsitAI", "SchematicTitle", "AI Terminal");
    mDescription = NSLOCTEXT("FicsitAI", "SchematicDesc", "Unlocks the FICSIT AI interactive factory management terminal (10 MW).");
    mTechTier = 1;

    UFicsitAIUnlockTerminalRecipe* RecipeUnlock = CreateDefaultSubobject<UFicsitAIUnlockTerminalRecipe>(TEXT("UnlockTerminalRecipe"));
    mUnlocks.Add(RecipeUnlock);
}
