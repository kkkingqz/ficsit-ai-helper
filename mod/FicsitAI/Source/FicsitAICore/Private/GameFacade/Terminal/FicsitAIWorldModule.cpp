#include "GameFacade/Terminal/FicsitAIWorldModule.h"
#include "GameFacade/Terminal/FicsitAISubsystem.h"

UFicsitAIWorldModule::UFicsitAIWorldModule()
{
    ModSubsystems.Add(AFicsitAISubsystem::StaticClass());
}
