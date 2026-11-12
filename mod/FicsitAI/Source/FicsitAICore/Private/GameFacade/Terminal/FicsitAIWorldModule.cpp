#include "GameFacade/Terminal/FicsitAIWorldModule.h"
#include "GameFacade/Terminal/FicsitAISubsystem.h"
#include "GameFacade/Terminal/FicsitAITerminalSchematic.h"
#include "../../Wiring/FicsitAICatalogOwner.h"

UFicsitAIWorldModule::UFicsitAIWorldModule()
{
    bRootModule = true;
    ModSubsystems.Add(AFicsitAISubsystem::StaticClass());
    // Проводка каталога (Co-44): владелец снимка читает каталог после начала игры.
    ModSubsystems.Add(AFicsitAICatalogOwner::StaticClass());
    mSchematics.Add(UFicsitAITerminalSchematic::StaticClass());
}
