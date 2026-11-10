#include "GameFacade/Terminal/FicsitAITerminal.h"
#include "GameFacade/Terminal/FicsitAISubsystem.h"
#include "GameFacade/Terminal/FicsitAIInputMappingContext.h"
#include "FicsitAIScreenModuleFactoryImpl.h"
#include "Surface/FicsitAIScreenSurfaceWidget.h"
#include "FGCharacterPlayer.h"
#include "Net/UnrealNetwork.h"
#include "GameFramework/PlayerController.h"
#include "EnhancedInputSubsystems.h"
#include "UObject/ConstructorHelpers.h"

DEFINE_LOG_CATEGORY(LogFicsitAITerminal);

static bool CheckApiCompatibility(const FString& RequiredVersion, const FString& SupportedVersion = TEXT("0.3.0"))
{
    if (RequiredVersion.IsEmpty())
    {
        return false;
    }

    TArray<FString> ReqParts;
    TArray<FString> SuppParts;
    RequiredVersion.ParseIntoArray(ReqParts, TEXT("."));
    SupportedVersion.ParseIntoArray(SuppParts, TEXT("."));

    const int32 ReqMajor = ReqParts.Num() > 0 ? FCString::Atoi(*ReqParts[0]) : -1;
    const int32 SuppMajor = SuppParts.Num() > 0 ? FCString::Atoi(*SuppParts[0]) : -1;

    return ReqMajor == SuppMajor;
}

AFicsitAITerminal::AFicsitAITerminal()
{
    PrimaryActorTick.bCanEverTick = true;
    bReplicates = true;

    TerminalMeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("TerminalMesh"));
    RootComponent = TerminalMeshComponent;

    static ConstructorHelpers::FObjectFinder<UStaticMesh> MeshFinder(TEXT("/Engine/BasicShapes/Cube.Cube"));
    if (MeshFinder.Succeeded())
    {
        TerminalMeshComponent->SetStaticMesh(MeshFinder.Object);
        TerminalMeshComponent->SetRelativeScale3D(FVector(0.5f, 1.2f, 1.8f));
    }

    PowerInfoComponent = CreateDefaultSubobject<UFGPowerInfoComponent>(TEXT("PowerInfo"));
    // Потребление 10 MW (ADR-001, AC-01)
    PowerInfoComponent->SetTargetConsumption(10.0f);

    PowerConnectionComponent = CreateDefaultSubobject<UFGPowerConnectionComponent>(TEXT("PowerConnection"));
    PowerConnectionComponent->SetupAttachment(RootComponent);
    // Привязываем силовую цепь к информации о потреблении мощности (10 МВт) (Gs-15.2)
    PowerConnectionComponent->SetPowerInfo(PowerInfoComponent);
}

void AFicsitAITerminal::BeginPlay()
{
    Super::BeginPlay();

    HostContext.HostId = FName(TEXT("AITerminal"));
    HostContext.Layout = EFicsitAIScreenLayout::Slots3;
    HostContext.SizePx = FIntPoint(1920, 1080);
    HostContext.AspectRatio = 16.0f / 9.0f;
    HostContext.bWorldSurface = false;
    HostContext.Host.SetObject(this);
    HostContext.Host.SetInterface(Cast<IFicsitAIScreenHost>(this));

    // Фабрика модулей по умолчанию (Notes, Status)
    if (!ModuleFactory)
    {
        ModuleFactory = NewObject<UFicsitAIScreenModuleFactoryImpl>(this);
    }

    if (HasAuthority())
    {
        AFicsitAISubsystem* Subsystem = AFicsitAISubsystem::Get(this);
        if (Subsystem)
        {
            HostContext.SaveId = Subsystem->GetSaveId();
            if (Subsystem->IsInertMode())
            {
                HostContext.HostState = EFicsitAIHostState::Inert;
            }
        }
        UpdateHostState();
    }
}

void AFicsitAITerminal::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    // Только сервер (Authority) принимает решение о состоянии хоста (Ready/NoPower/Inert) (Gs-15.3)
    if (HasAuthority())
    {
        UpdateHostState();
    }
}

void AFicsitAITerminal::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);

    DOREPLIFETIME(AFicsitAITerminal, HostContext);
    DOREPLIFETIME(AFicsitAITerminal, ActiveModuleId);
}

void AFicsitAITerminal::OnRep_HostContext()
{
    if (HostContext.HostState != EFicsitAIHostState::Ready && ActiveModuleInstance)
    {
        TeardownActiveModule();
    }
    else if (ActiveModuleInstance)
    {
        ActiveModuleInstance->OnContextChanged(HostContext);
    }

    if (ScreenSurface)
    {
        if (UFicsitAIScreenSurfaceWidget* Widget = Cast<UFicsitAIScreenSurfaceWidget>(ScreenSurface.GetObject()))
        {
            Widget->SetHostState(HostContext.HostState);
        }
    }
}

bool AFicsitAITerminal::HasPower() const
{
    return PowerInfoComponent && PowerInfoComponent->HasPower();
}

void AFicsitAITerminal::FlushActiveModuleState()
{
    if (ActiveModuleInstance)
    {
        const FString State = ActiveModuleInstance->SavePersistentState();
        if (!State.IsEmpty())
        {
            if (AFicsitAISubsystem* Subsystem = AFicsitAISubsystem::Get(this))
            {
                Subsystem->SaveModuleState(HostContext.SaveId, ActiveModuleId, State);
            }
        }
    }
}

void AFicsitAITerminal::PreSaveGame_Implementation(int32 SaveVersion, int32 GameVersion)
{
    Super::PreSaveGame_Implementation(SaveVersion, GameVersion);
    FlushActiveModuleState();
}

void AFicsitAITerminal::TeardownActiveModule()
{
    if (ActiveModuleInstance)
    {
        FlushActiveModuleState();

        ActiveModuleInstance->OnDetach();

        if (ScreenSurface)
        {
            ScreenSurface->ClearModule();
        }

        ActiveModuleInstance = nullptr;
        ActiveModuleId = NAME_None;
        HostContext.bHasInputFocus = false;
    }
}

void AFicsitAITerminal::UpdateHostState()
{
    AFicsitAISubsystem* Subsystem = AFicsitAISubsystem::Get(this);
    const bool bInert = Subsystem && Subsystem->IsInertMode();

    if (bInert)
    {
        if (HostContext.HostState != EFicsitAIHostState::Inert)
        {
            HostContext.HostState = EFicsitAIHostState::Inert;
            TeardownActiveModule();
            if (ScreenSurface)
            {
                if (UFicsitAIScreenSurfaceWidget* Widget = Cast<UFicsitAIScreenSurfaceWidget>(ScreenSurface.GetObject()))
                {
                    Widget->SetHostState(EFicsitAIHostState::Inert);
                }
            }
            UE_LOG(LogFicsitAITerminal, Warning, TEXT("Терминал переведён в инертный режим (вход удалённого игрока). Экран закрыт."));
        }
        return;
    }

    if (!HasPower())
    {
        if (HostContext.HostState != EFicsitAIHostState::NoPower)
        {
            HostContext.HostState = EFicsitAIHostState::NoPower;
            TeardownActiveModule();
            if (ScreenSurface)
            {
                if (UFicsitAIScreenSurfaceWidget* Widget = Cast<UFicsitAIScreenSurfaceWidget>(ScreenSurface.GetObject()))
                {
                    Widget->SetHostState(EFicsitAIHostState::NoPower);
                }
            }
            UE_LOG(LogFicsitAITerminal, Log, TEXT("Терминал обесточен (требуется 10 МВт). Экран погашен."));
        }
    }
    else
    {
        if (HostContext.HostState != EFicsitAIHostState::Ready)
        {
            HostContext.HostState = EFicsitAIHostState::Ready;
            if (ScreenSurface)
            {
                if (UFicsitAIScreenSurfaceWidget* Widget = Cast<UFicsitAIScreenSurfaceWidget>(ScreenSurface.GetObject()))
                {
                    Widget->SetHostState(EFicsitAIHostState::Ready);
                }
            }
            UE_LOG(LogFicsitAITerminal, Log, TEXT("Терминал запитан (10 МВт). Готов к работе."));
        }
    }
}

void AFicsitAITerminal::OnUse_Implementation(AFGCharacterPlayer* byCharacter, const FUseState& state)
{
    if (HasAuthority())
    {
        UpdateHostState();
    }

    APlayerController* PC = byCharacter ? Cast<APlayerController>(byCharacter->GetController()) : nullptr;
    if (!PC || !PC->IsLocalController())
    {
        return;
    }

    // Регистрируем Enhanced Input контекст для игрока (Gs-15.2)
    if (ULocalPlayer* LP = PC->GetLocalPlayer())
    {
        if (UEnhancedInputLocalPlayerSubsystem* Subsystem = LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>())
        {
            const UFicsitAIInputMappingContext* IMC = GetDefault<UFicsitAIInputMappingContext>();
            if (IMC && !Subsystem->HasMappingContext(IMC))
            {
                Subsystem->AddMappingContext(IMC, 100);
            }
        }
    }

    // Если экран уже открыт для этого игрока, повторное нажатие E закрывает его
    if (UFicsitAIScreenSurfaceWidget::IsOpenForPlayer(PC))
    {
        CloseActiveModule();
        return;
    }

    if (HostContext.HostState == EFicsitAIHostState::NoPower)
    {
        UE_LOG(LogFicsitAITerminal, Log, TEXT("Терминал без питания (10 MW требуется). Экран гаснет (AC-01, §6.1)."));
        UFicsitAIScreenSurfaceWidget* Widget = UFicsitAIScreenSurfaceWidget::OpenForPlayer(PC, this, EFicsitAIHostState::NoPower, nullptr);
        SetScreenSurface(Widget);
        return;
    }

    if (HostContext.HostState == EFicsitAIHostState::Inert)
    {
        UE_LOG(LogFicsitAITerminal, Log, TEXT("Терминал в инертном режиме (мультиплеерная сессия). Экран недоступен."));
        UFicsitAIScreenSurfaceWidget* Widget = UFicsitAIScreenSurfaceWidget::OpenForPlayer(PC, this, EFicsitAIHostState::Inert, nullptr);
        SetScreenSurface(Widget);
        return;
    }

    // В состоянии Ready переключаем открытие терминала
    if (ActiveModuleId == NAME_None)
    {
        OpenModule(FName(TEXT("Notes")));
    }

    UFicsitAIScreenSurfaceWidget* Widget = UFicsitAIScreenSurfaceWidget::OpenForPlayer(PC, this, HostContext.HostState, ActiveModuleInstance);
    SetScreenSurface(Widget);
}

bool AFicsitAITerminal::IsUseable_Implementation() const
{
    return true;
}

void AFicsitAITerminal::UpdateUseState_Implementation(AFGCharacterPlayer* byCharacter, const FVector& atLocation, class UPrimitiveComponent* componentHit, FUseState& out_useState)
{
    out_useState.SetUseState(UFGUseState_Valid::StaticClass());
}

TArray<FName> AFicsitAITerminal::GetAvailableModules() const
{
    if (ModuleFactory)
    {
        return ModuleFactory->GetRegisteredModules();
    }
    return { FName(TEXT("Notes")), FName(TEXT("Status")) };
}

bool AFicsitAITerminal::OpenModule(FName ModuleId)
{
    if (HasAuthority())
    {
        UpdateHostState();
    }

    if (HostContext.HostState != EFicsitAIHostState::Ready)
    {
        return false;
    }

    if (ActiveModuleId == ModuleId && ActiveModuleInstance)
    {
        return true;
    }

    // Отсоединяем текущий активный модуль с сохранением состояния (AC-14)
    if (ActiveModuleInstance)
    {
        TeardownActiveModule();
    }

    // Ищем в кэше или запрашиваем у фабрики
    TScriptInterface<IFicsitAIScreenModule> TargetModule;
    if (TScriptInterface<IFicsitAIScreenModule>* Cached = CachedModules.Find(ModuleId))
    {
        TargetModule = *Cached;
    }
    else if (ModuleFactory)
    {
        TargetModule = ModuleFactory->CreateModule(ModuleId, this);
        if (TargetModule)
        {
            CachedModules.Add(ModuleId, TargetModule);
        }
    }

    if (!TargetModule)
    {
        UE_LOG(LogFicsitAITerminal, Warning, TEXT("Не удалось создать экранный модуль: %s"), *ModuleId.ToString());
        return false;
    }

    // Проверка совместимости версии API (§5.5, Gs-15.4) ДО вызова OnAttach
    const FString RequiredApi = TargetModule->GetRequiredApiVersion();
    if (!CheckApiCompatibility(RequiredApi, TEXT("0.3.0")))
    {
        UE_LOG(LogFicsitAITerminal, Warning, TEXT("Модуль %s требует несовместимую версию API (%s, поддерживается 0.x). Открытие отклонено до OnAttach."), *ModuleId.ToString(), *RequiredApi);
        return false;
    }

    ActiveModuleId = ModuleId;
    ActiveModuleInstance = TargetModule;

    // Жизненный цикл по docs/interfaces/screen-host-and-module.md:
    // CreateModule -> OnAttach(Context) -> RestorePersistentState(State) -> Surface->SetModule
    ActiveModuleInstance->OnAttach(HostContext);

    // Восстанавливаем сохранённое состояние модуля из подсистемы по (SaveId, ModuleId)
    if (AFicsitAISubsystem* Subsystem = AFicsitAISubsystem::Get(this))
    {
        const FString SavedState = Subsystem->GetModuleState(HostContext.SaveId, ModuleId);
        if (!SavedState.IsEmpty())
        {
            ActiveModuleInstance->RestorePersistentState(SavedState);
        }
    }

    if (ScreenSurface)
    {
        ScreenSurface->SetModule(TargetModule);
    }

    UE_LOG(LogFicsitAITerminal, Log, TEXT("Открыт экранный модуль: %s"), *ModuleId.ToString());
    return true;
}

void AFicsitAITerminal::CloseActiveModule()
{
    if (ActiveModuleInstance)
    {
        UE_LOG(LogFicsitAITerminal, Log, TEXT("Закрытие активного модуля: %s"), *ActiveModuleId.ToString());
        TeardownActiveModule();
    }

    if (UWorld* World = GetWorld())
    {
        if (APlayerController* PC = World->GetFirstPlayerController())
        {
            UFicsitAIScreenSurfaceWidget::CloseForPlayer(PC);
        }
    }
    SetScreenSurface(nullptr);
}

void AFicsitAITerminal::RequestInputFocus(bool bWanted)
{
    HostContext.bHasInputFocus = bWanted;
    if (ActiveModuleInstance)
    {
        ActiveModuleInstance->OnContextChanged(HostContext);
    }
}

void AFicsitAITerminal::NotifyContentChanged()
{
    FlushActiveModuleState();
}

bool AFicsitAITerminal::HandleBackAction()
{
    if (ActiveModuleInstance && ActiveModuleInstance->HandleBackAction())
    {
        return true;
    }

    CloseActiveModule();
    return true;
}

void AFicsitAITerminal::SetModuleFactory(TScriptInterface<IFicsitAIScreenModuleFactory> InFactory)
{
    ModuleFactory = InFactory;
}

void AFicsitAITerminal::SetScreenSurface(TScriptInterface<IFicsitAIScreenSurface> InSurface)
{
    ScreenSurface = InSurface;
}
