#include "FicsitAICatalogOwner.h"

#include "GameFacade/Terminal/FicsitAISubsystem.h"

#include "Engine/World.h"
#include "HAL/PlatformTime.h"
#include "Subsystem/SubsystemActorManager.h"

DEFINE_LOG_CATEGORY(LogFicsitAICatalog);

namespace
{
// Около 10 с при 60 кадрах: реестр и менеджер рецептов появляются в первые кадры после начала игры.
constexpr int32 MaxFailedAttempts = 600;
}

AFicsitAICatalogOwner::AFicsitAICatalogOwner()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.bStartWithTickEnabled = true;
    ReplicationPolicy = ESubsystemReplicationPolicy::SpawnOnServer;
}

void AFicsitAICatalogOwner::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    // Тик начинается после BeginPlay мира. Ждём HasBegunPlay: SML регистрирует штатные схемы и замораживает
    // реестр в OnWorldBeginPlay, и рецепты, прочитанные раньше, были бы неполными.
    const UWorld* World = GetWorld();
    if (!World || !World->HasBegunPlay())
    {
        return;
    }

    const AFicsitAISubsystem* Mod = FindModSubsystem();
    if (Mod && Mod->IsInertMode())
    {
        // Инертный режим до конца сессии не снимается: ждать нечего.
        UE_LOG(LogFicsitAICatalog, Log, TEXT("FicsitAI: мод в инертном режиме, каталог не читается"));
        SetActorTickEnabled(false);
        return;
    }
    if (Mod && RefreshCatalog())
    {
        SetActorTickEnabled(false);
        return;
    }

    if (++FailedAttempts >= MaxFailedAttempts)
    {
        UE_LOG(LogFicsitAICatalog, Warning, TEXT("FicsitAI: каталог не прочитан за %d кадров, снимка нет"), FailedAttempts);
        SetActorTickEnabled(false);
    }
}

const AFicsitAISubsystem* AFicsitAICatalogOwner::FindModSubsystem() const
{
    const UWorld* World = GetWorld();
    USubsystemActorManager* Manager = World ? World->GetSubsystem<USubsystemActorManager>() : nullptr;
    return Manager ? Manager->GetSubsystemActor<AFicsitAISubsystem>() : nullptr;
}

bool AFicsitAICatalogOwner::IsModActive() const
{
    const AFicsitAISubsystem* Mod = FindModSubsystem();
    return Mod && !Mod->IsInertMode();
}

const FicsitAI::Catalog::FSnapshot* AFicsitAICatalogOwner::GetSnapshot() const
{
    return IsModActive() ? Snapshot.GetPtrOrNull() : nullptr;
}

bool AFicsitAICatalogOwner::RefreshCatalog()
{
    if (!IsModActive())
    {
        return false;
    }

    FicsitAI::Catalog::FSnapshot Fresh;
    const double Start = FPlatformTime::Seconds();
    if (!FicsitAI::Catalog::TryReadCatalog(GetWorld(), Fresh))
    {
        return false;
    }
    const double Ms = (FPlatformTime::Seconds() - Start) * 1000.0;

    int32 Unlocked = 0;
    for (const FicsitAI::Catalog::FRecipe& Recipe : Fresh.Recipes)
    {
        Unlocked += Recipe.bUnlocked ? 1 : 0;
    }
    UE_LOG(LogFicsitAICatalog, Log,
        TEXT("FicsitAI: каталог прочитан за %.3f мс: рецептов %d (разблокировано %d), предметов %d, классов построек %d, множитель %s"),
        Ms, Fresh.Recipes.Num(), Unlocked, Fresh.Items.Num(), Fresh.Buildings.Num(),
        Fresh.PartsCostMultiplier.IsSet() ? *FString::SanitizeFloat(Fresh.PartsCostMultiplier.GetValue()) : TEXT("нет"));

    Snapshot = MoveTemp(Fresh);
    return true;
}

AFicsitAICatalogOwner* AFicsitAICatalogOwner::Get(const UObject* WorldContext)
{
    const UWorld* World = WorldContext ? WorldContext->GetWorld() : nullptr;
    USubsystemActorManager* Manager = World ? World->GetSubsystem<USubsystemActorManager>() : nullptr;
    return Manager ? Manager->GetSubsystemActor<AFicsitAICatalogOwner>() : nullptr;
}
