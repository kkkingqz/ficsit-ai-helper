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
    TerminalMeshComponent->SetupAttachment(RootComponent);

    static ConstructorHelpers::FObjectFinder<UStaticMesh> MeshFinder(TEXT("/Engine/BasicShapes/Cube.Cube"));
    if (MeshFinder.Succeeded())
    {
        TerminalMeshComponent->SetStaticMesh(MeshFinder.Object);
        TerminalMeshComponent->SetRelativeScale3D(FVector(0.5f, 1.2f, 1.8f));
    }

    // Плоская поверхность экрана на лицевой стороне меша с пропорциями 16:9 (ADR-030, P-7 §1.1)
    // Крепится к RootComponent (масштаб 1:1:1), чтобы не искажаться родительским масштабом корпуса (Gs-15 раунд 4)
    ScreenMeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("ScreenMesh"));
    ScreenMeshComponent->SetupAttachment(RootComponent);
    static ConstructorHelpers::FObjectFinder<UStaticMesh> ScreenPlaneFinder(TEXT("/Engine/BasicShapes/Plane.Plane"));
    if (ScreenPlaneFinder.Succeeded())
    {
        ScreenMeshComponent->SetStaticMesh(ScreenPlaneFinder.Object);
        ScreenMeshComponent->SetRelativeLocation(FVector(25.5f, 0.0f, 20.0f));
        ScreenMeshComponent->SetRelativeRotation(FRotator(90.0f, 0.0f, 0.0f));
        ScreenMeshComponent->SetRelativeScale3D(FVector(0.54f, 0.96f, 1.0f)); // 96 см / 54 см = ровно 16:9
    }

    TargetPowerConsumption = 10.0f;
    PowerInfoComponent = CreateDefaultSubobject<UFGPowerInfoComponent>(TEXT("PowerInfo"));
    // Потребление 10 MW (ADR-001, AC-01)
    PowerInfoComponent->SetTargetConsumption(TargetPowerConsumption);

    PowerConnectionComponent = CreateDefaultSubobject<UFGPowerConnectionComponent>(TEXT("PowerConnection"));
    PowerConnectionComponent->SetupAttachment(RootComponent);
    // Привязываем силовую цепь к информации о потреблении мощности (10 МВт) (Gs-15.2)
    PowerConnectionComponent->SetPowerInfo(PowerInfoComponent);
}

float AFicsitAITerminal::GetScreenAspectRatio() const
{
    if (ScreenMeshComponent)
    {
        // Вычисляем итоговый масштаб с учётом цепочки родителей (Gs-15 раунд 4)
        FVector CombinedScale = ScreenMeshComponent->GetRelativeScale3D();
        const USceneComponent* ParentComp = ScreenMeshComponent->GetAttachParent();
        while (ParentComp)
        {
            CombinedScale *= ParentComp->GetRelativeScale3D();
            ParentComp = ParentComp->GetAttachParent();
        }
        if (CombinedScale.X > 0.0f)
        {
            return CombinedScale.Y / CombinedScale.X;
        }
    }
    return 16.0f / 9.0f;
}

AFicsitAISubsystem* AFicsitAITerminal::GetSubsystem() const
{
    if (CustomSubsystem)
    {
        return CustomSubsystem;
    }
    return AFicsitAISubsystem::Get(const_cast<AFicsitAITerminal*>(this));
}

void AFicsitAITerminal::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    CloseActiveModule();
    if (AFicsitAISubsystem* Subsystem = GetSubsystem())
    {
        Subsystem->UnregisterTerminal(this);
    }
    Super::EndPlay(EndPlayReason);
}

void AFicsitAITerminal::InitializeHost()
{
    HostContext.HostId = FName(TEXT("AITerminal"));
    HostContext.Layout = EFicsitAIScreenLayout::Slots3;
    HostContext.SizePx = FIntPoint(1920, 1080);
    HostContext.AspectRatio = 16.0f / 9.0f;
    HostContext.bWorldSurface = false;
    HostContext.Host.SetObject(this);
    HostContext.Host.SetInterface(Cast<IFicsitAIScreenHost>(this));
    HostContext.HostState = EFicsitAIHostState::Ready;

    // Фабрика модулей по умолчанию (Notes, Status)
    if (!ModuleFactory)
    {
        ModuleFactory = NewObject<UFicsitAIScreenModuleFactoryImpl>(this);
    }

    if (AFicsitAISubsystem* Subsystem = GetSubsystem())
    {
        Subsystem->RegisterTerminal(this);
        HostContext.SaveId = Subsystem->GetSaveId();
        if (Subsystem->IsInertMode())
        {
            HostContext.HostState = EFicsitAIHostState::Inert;
        }
    }
}

void AFicsitAITerminal::BeginPlay()
{
    Super::BeginPlay();
    InitializeHost();

    if (HasAuthority())
    {
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
    if (bPowerOverride.IsSet())
    {
        return bPowerOverride.GetValue();
    }
    return PowerInfoComponent && PowerInfoComponent->HasPower();
}

void AFicsitAITerminal::FlushActiveModuleState()
{
    if (ActiveModuleInstance)
    {
        const FString State = ActiveModuleInstance->SavePersistentState();
        if (!State.IsEmpty())
        {
            if (AFicsitAISubsystem* Subsystem = GetSubsystem())
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
    AFicsitAISubsystem* Subsystem = GetSubsystem();
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

static TMap<FName, FKey> QueryActionKeyBindings(UEnhancedInputLocalPlayerSubsystem* Subsystem, const UFicsitAIInputMappingContext* IMC)
{
    TMap<FName, FKey> Bindings;
    auto QueryActionKey = [&](const UInputAction* Action, FName ActionId, FKey FallbackKey)
    {
        if (Subsystem && Action)
        {
            TArray<FKey> Keys = Subsystem->QueryKeysMappedToAction(Action);
            if (Keys.Num() > 0 && Keys[0].IsValid())
            {
                Bindings.Add(ActionId, Keys[0]);
                return;
            }
        }
        Bindings.Add(ActionId, FallbackKey);
    };

    if (IMC)
    {
        QueryActionKey(IMC->ActionBack, FName(TEXT("IA_FicsitAI_Back")), EKeys::Escape);
        QueryActionKey(IMC->ActionOpenTerminal, FName(TEXT("IA_FicsitAI_OpenTerminal")), EKeys::E);
        QueryActionKey(IMC->ActionNotes, FName(TEXT("IA_FicsitAI_Notes")), EKeys::F);
        QueryActionKey(IMC->ActionStatus, FName(TEXT("IA_FicsitAI_Status")), EKeys::R);
    }
    return Bindings;
}

void AFicsitAITerminal::HandleControlMappingsRebuilt()
{
    if (UWorld* World = GetWorld())
    {
        if (APlayerController* PC = World->GetFirstPlayerController())
        {
            if (ULocalPlayer* LP = PC->GetLocalPlayer())
            {
                if (UEnhancedInputLocalPlayerSubsystem* Subsystem = LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>())
                {
                    const UFicsitAIInputMappingContext* IMC = GetDefault<UFicsitAIInputMappingContext>();
                    if (IMC && ScreenSurface)
                    {
                        if (UFicsitAIScreenSurfaceWidget* Widget = Cast<UFicsitAIScreenSurfaceWidget>(ScreenSurface.GetObject()))
                        {
                            Widget->SetActionKeyBindings(QueryActionKeyBindings(Subsystem, IMC));
                        }
                    }
                }
            }
        }
    }
}

void AFicsitAITerminal::OnUse_Implementation(AFGCharacterPlayer* byCharacter, const FUseState& state)
{
    APlayerController* PC = byCharacter ? Cast<APlayerController>(byCharacter->GetController()) : nullptr;
    if (!PC || !PC->IsLocalController() || UFicsitAIScreenSurfaceWidget::IsOpenForPlayer(PC))
    {
        // Штатный Use и действие мода могут получить одно и то же нажатие.
        return;
    }

    if (HasAuthority())
    {
        UpdateHostState();
    }

    // При открытии терминала подтверждаем контекст Enhanced Input (SML Manual Registration, priority 200)
    TMap<FName, FKey> CurrentBindings;
    const UFicsitAIInputMappingContext* IMC = GetDefault<UFicsitAIInputMappingContext>();
    if (IMC)
    {
        if (AFGPlayerController* FGPC = Cast<AFGPlayerController>(PC))
        {
            (void)FGPC->BindMappingContext(const_cast<UFicsitAIInputMappingContext*>(IMC), 200, this);
        }

        if (ULocalPlayer* LP = PC->GetLocalPlayer())
        {
            if (UEnhancedInputLocalPlayerSubsystem* Subsystem = LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>())
            {
                FModifyContextOptions Options;
                Options.bForceImmediately = true;
                if (!Subsystem->HasMappingContext(IMC))
                {
                    Subsystem->AddMappingContext(IMC, 200, Options);
                }

                Subsystem->ControlMappingsRebuiltDelegate.AddUniqueDynamic(this, &AFicsitAITerminal::HandleControlMappingsRebuilt);
                CurrentBindings = QueryActionKeyBindings(Subsystem, IMC);
            }
        }
    }

    if (HostContext.HostState == EFicsitAIHostState::NoPower)
    {
        UE_LOG(LogFicsitAITerminal, Log, TEXT("Терминал без питания (10 MW требуется). Экран гаснет (AC-01, §6.1)."));
        UFicsitAIScreenSurfaceWidget* Widget = UFicsitAIScreenSurfaceWidget::OpenForPlayer(PC, this, EFicsitAIHostState::NoPower, nullptr);
        if (Widget)
        {
            Widget->SetActionKeyBindings(CurrentBindings);
        }
        SetScreenSurface(Widget);
        return;
    }

    if (HostContext.HostState == EFicsitAIHostState::Inert)
    {
        UE_LOG(LogFicsitAITerminal, Log, TEXT("Терминал в инертном режиме (мультиплеерная сессия). Экран недоступен."));
        UFicsitAIScreenSurfaceWidget* Widget = UFicsitAIScreenSurfaceWidget::OpenForPlayer(PC, this, EFicsitAIHostState::Inert, nullptr);
        if (Widget)
        {
            Widget->SetActionKeyBindings(CurrentBindings);
        }
        SetScreenSurface(Widget);
        return;
    }

    // В состоянии Ready переключаем открытие терминала
    if (ActiveModuleId == NAME_None)
    {
        OpenModule(FName(TEXT("Notes")));
    }

    UFicsitAIScreenSurfaceWidget* Widget = UFicsitAIScreenSurfaceWidget::OpenForPlayer(PC, this, HostContext.HostState, ActiveModuleInstance);
    if (Widget)
    {
        Widget->SetActionKeyBindings(CurrentBindings);
    }
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
    if (HostContext.HostId.IsNone() || !ModuleFactory)
    {
        InitializeHost();
    }

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

    // 1. Ищем в кэше или запрашиваем у фабрики ДО отсоединения текущего модуля
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

    // 2. Проверка совместимости версии API (§5.5, Gs-15.4) ДО любого teardown
    const FString RequiredApi = TargetModule->GetRequiredApiVersion();
    if (!CheckApiCompatibility(RequiredApi, TEXT("0.3.0")))
    {
        UE_LOG(LogFicsitAITerminal, Warning, TEXT("Модуль %s требует несовместимую версию API (%s, поддерживается 0.x). Открытие отклонено, текущий экран сохранён."), *ModuleId.ToString(), *RequiredApi);
        return false;
    }

    // 3. Отсоединяем текущий активный модуль с сохранением состояния только после успешной проверки (AC-14)
    if (ActiveModuleInstance)
    {
        TeardownActiveModule();
    }

    ActiveModuleId = ModuleId;
    ActiveModuleInstance = TargetModule;

    // Жизненный цикл по docs/interfaces/screen-host-and-module.md:
    // CreateModule -> OnAttach(Context) -> RestorePersistentState(State) -> Surface->SetModule
    ActiveModuleInstance->OnAttach(HostContext);

    // Восстанавливаем сохранённое состояние модуля из подсистемы по (SaveId, ModuleId)
    if (AFicsitAISubsystem* Subsystem = GetSubsystem())
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

    if (UFicsitAIScreenSurfaceWidget* Widget = Cast<UFicsitAIScreenSurfaceWidget>(ScreenSurface.GetObject()))
    {
        APlayerController* PC = Widget->GetOwningPlayer();
        if (ULocalPlayer* LP = PC ? PC->GetLocalPlayer() : nullptr)
        {
            if (UEnhancedInputLocalPlayerSubsystem* Subsystem = LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>())
            {
                Subsystem->ControlMappingsRebuiltDelegate.RemoveAll(this);
            }
        }
        UFicsitAIScreenSurfaceWidget::CloseForPlayer(PC);
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
