#include "FicsitAICoreModule.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Containers/Ticker.h"

DEFINE_LOG_CATEGORY_STATIC(LogFicsitAICore, Log, All);

static FTSTicker::FDelegateHandle GDiagSaveLoaderHandle;

void FFicsitAICoreModule::StartupModule()
{
    UE_LOG(LogFicsitAICore, Log, TEXT("FicsitAICore module started"));

    FString ScenarioStr;
    FString SaveName;
    if (FParse::Value(FCommandLine::Get(), TEXT("-FicsitAITestScenario="), ScenarioStr) &&
        FParse::Value(FCommandLine::Get(), TEXT("-FicsitAISave="), SaveName) &&
        !SaveName.IsEmpty())
    {
        UE_LOG(LogFicsitAICore, Display, TEXT("[DiagBoot] Armed auto-load save '%s' for scenario '%s'"), *SaveName, *ScenarioStr);
        GDiagSaveLoaderHandle = FTSTicker::GetCoreTicker().AddTicker(
            FTickerDelegate::CreateLambda([SaveName, Elapsed = 0.0f, bTriggered = false](float DeltaTime) mutable -> bool
            {
                if (bTriggered || !GEngine)
                {
                    return false;
                }
                for (const FWorldContext& Ctx : GEngine->GetWorldContexts())
                {
                    UWorld* World = Ctx.World();
                    if (!World || !World->IsGameWorld())
                    {
                        continue;
                    }
                    const FString MapName = World->GetMapName();
                    if (MapName.Contains(TEXT("Persistent_Level")))
                    {
                        bTriggered = true;
                        return false;
                    }
                    Elapsed += DeltaTime;
                    if (Elapsed >= 2.0f)
                    {
                        bTriggered = true;
                        const FString Options = FString::Printf(TEXT("loadgame=%s"), *SaveName);
                        UE_LOG(LogFicsitAICore, Display, TEXT("[DiagBoot] Opening Persistent_Level (%s) from map '%s'"), *Options, *MapName);
                        UGameplayStatics::OpenLevel(World, FName(TEXT("/Game/FactoryGame/Map/GameLevel01/Persistent_Level")), true, Options);
                        return false;
                    }
                }
                return true;
            }),
            0.25f
        );
    }
}

void FFicsitAICoreModule::ShutdownModule()
{
    if (GDiagSaveLoaderHandle.IsValid())
    {
        FTSTicker::GetCoreTicker().RemoveTicker(GDiagSaveLoaderHandle);
        GDiagSaveLoaderHandle.Reset();
    }
    UE_LOG(LogFicsitAICore, Log, TEXT("FicsitAICore module shutdown"));
}

IMPLEMENT_MODULE(FFicsitAICoreModule, FicsitAICore);
