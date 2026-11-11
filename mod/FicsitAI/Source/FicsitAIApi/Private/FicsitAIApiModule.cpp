#include "FicsitAIApiModule.h"

DEFINE_LOG_CATEGORY_STATIC(LogFicsitAIApi, Log, All);

void FFicsitAIApiModule::StartupModule()
{
    UE_LOG(LogFicsitAIApi, Log, TEXT("FicsitAIApi module started"));
}

void FFicsitAIApiModule::ShutdownModule()
{
    UE_LOG(LogFicsitAIApi, Log, TEXT("FicsitAIApi module shutdown"));
}

IMPLEMENT_MODULE(FFicsitAIApiModule, FicsitAIApi);
