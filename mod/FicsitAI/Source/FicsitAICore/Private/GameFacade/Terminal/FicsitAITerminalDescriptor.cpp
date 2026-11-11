#include "GameFacade/Terminal/FicsitAITerminalDescriptor.h"
#include "GameFacade/Terminal/FicsitAITerminal.h"

UFicsitAITerminalDescriptor::UFicsitAITerminalDescriptor()
{
    mBuildableClass = AFicsitAITerminal::StaticClass();
    mDisplayName = NSLOCTEXT("FicsitAI", "TerminalDescriptorTitle", "AI Terminal");
    mDescription = NSLOCTEXT("FicsitAI", "TerminalDescriptorDesc", "FICSIT AI interactive factory management terminal (10 MW).");
}
