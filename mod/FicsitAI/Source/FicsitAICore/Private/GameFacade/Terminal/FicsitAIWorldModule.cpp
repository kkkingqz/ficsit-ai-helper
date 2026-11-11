#include "GameFacade/Terminal/FicsitAIWorldModule.h"
#include "GameFacade/Terminal/FicsitAISubsystem.h"
#include "GameFacade/Terminal/FicsitAITerminalSchematic.h"

UFicsitAIWorldModule::UFicsitAIWorldModule()
{
    bRootModule = true;
    ModSubsystems.Add(AFicsitAISubsystem::StaticClass());
    mSchematics.Add(UFicsitAITerminalSchematic::StaticClass());
}
