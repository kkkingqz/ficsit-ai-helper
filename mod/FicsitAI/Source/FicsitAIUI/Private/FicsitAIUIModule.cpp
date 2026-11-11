#include "FicsitAIUIModule.h"

DEFINE_LOG_CATEGORY_STATIC(LogFicsitAIUI, Log, All);

void FFicsitAIUIModule::StartupModule()
{
    UE_LOG(LogFicsitAIUI, Log, TEXT("FicsitAIUI module started"));
}

void FFicsitAIUIModule::ShutdownModule()
{
    UE_LOG(LogFicsitAIUI, Log, TEXT("FicsitAIUI module shutdown"));
}

IMPLEMENT_MODULE(FFicsitAIUIModule, FicsitAIUI);
