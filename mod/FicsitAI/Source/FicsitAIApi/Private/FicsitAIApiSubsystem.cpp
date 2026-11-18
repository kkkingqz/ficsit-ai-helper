#include "FicsitAIApiSubsystem.h"

#include "Engine/World.h"
#include "FicsitAIApiClient.h"
#include "FicsitAIApiCore.h"
#include "IFicsitAIDataSource.h"

UFicsitAIApiSubsystem* UFicsitAIApiSubsystem::Get(const UObject* WorldContext)
{
    const UWorld* World = WorldContext ? WorldContext->GetWorld() : nullptr;
    return World ? World->GetSubsystem<UFicsitAIApiSubsystem>() : nullptr;
}

bool UFicsitAIApiSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
    // Только игровые миры: в мирах редактора и превью экраны не открываются, а клиенты API не подключаются.
    const UWorld* World = Cast<UWorld>(Outer);
    return World && (World->WorldType == EWorldType::Game || World->WorldType == EWorldType::PIE)
        && Super::ShouldCreateSubsystem(Outer);
}

void UFicsitAIApiSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);
    Core = MakeShared<FFicsitAIApiCore>();
    // Мод инертен в любой не одиночной игре (§4.2). Проверка — на каждом запросе, а не опросом проводки:
    // у клиента чужой сессии проводке не с кем синхронизироваться, у хоста опрос отстаёт на полсекунды.
    TWeakObjectPtr<UWorld> WeakWorld(GetWorld());
    Core->SetNetInertProbe([WeakWorld]()
    {
        const UWorld* World = WeakWorld.Get();
        return World && World->GetNetMode() != NM_Standalone;
    });
}

void UFicsitAIApiSubsystem::Deinitialize()
{
    if (Core.IsValid())
    {
        Core->Shutdown();
        Core.Reset();
    }
    Super::Deinitialize();
}

FString UFicsitAIApiSubsystem::GetApiVersion() const
{
    return FFicsitAIApiCore::ApiVersion;
}

TSharedRef<FFicsitAIApiClient> UFicsitAIApiSubsystem::Connect(const FFicsitAIApiClientInfo& Info)
{
    if (!Core.IsValid())
    {
        // Подключение к закрытому API: отдельное ядро без источника, клиент сразу получает SOURCE_UNAVAILABLE.
        TSharedRef<FFicsitAIApiCore> Dead = MakeShared<FFicsitAIApiCore>();
        TSharedRef<FFicsitAIApiClient> Client = Dead->Connect(Info);
        Dead->Shutdown();
        return Client;
    }
    return Core->Connect(Info);
}

void UFicsitAIApiSubsystem::SetSource(TSharedPtr<IFicsitAIDataSource> Source)
{
    if (Core.IsValid())
    {
        Core->SetSource(MoveTemp(Source));
    }
}

void UFicsitAIApiSubsystem::SetModState(const FString& SaveId, bool bInert, const FText& InertReason)
{
    if (Core.IsValid())
    {
        Core->SetModState(SaveId, bInert, InertReason);
    }
}
