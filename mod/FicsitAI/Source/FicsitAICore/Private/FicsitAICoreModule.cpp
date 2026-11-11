#include "FicsitAICoreModule.h"

DEFINE_LOG_CATEGORY_STATIC(LogFicsitAICore, Log, All);

void FFicsitAICoreModule::StartupModule()
{
    UE_LOG(LogFicsitAICore, Log, TEXT("FicsitAICore module started"));
}

void FFicsitAICoreModule::ShutdownModule()
{
    UE_LOG(LogFicsitAICore, Log, TEXT("FicsitAICore module shutdown"));
}

IMPLEMENT_MODULE(FFicsitAICoreModule, FicsitAICore);
