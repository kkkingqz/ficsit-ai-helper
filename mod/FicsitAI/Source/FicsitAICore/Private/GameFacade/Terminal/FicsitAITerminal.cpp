#include "GameFacade/Terminal/FicsitAITerminal.h"
#include "GameFacade/Terminal/FicsitAISubsystem.h"
#include "FicsitAIScreenModuleFactoryImpl.h"
#include "Surface/FicsitAIScreenSurfaceWidget.h"
#include "Net/UnrealNetwork.h"

DEFINE_LOG_CATEGORY(LogFicsitAITerminal);

AFicsitAITerminal::AFicsitAITerminal()
{
    PrimaryActorTick.bCanEverTick = true;
    bReplicates = true;

    TerminalMeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("TerminalMesh"));
    RootComponent = TerminalMeshComponent;

    PowerInfoComponent = CreateDefaultSubobject<UFGPowerInfoComponent>(TEXT("PowerInfo"));
    // Потребление 10 MW (ADR-001, AC-01)
    PowerInfoComponent->SetTargetConsumption(10.0f);

    PowerConnectionComponent = CreateDefaultSubobject<UFGPowerConnectionComponent>(TEXT("PowerConnection"));
    PowerConnectionComponent->SetupAttachment(RootComponent);
}

void AFicsitAITerminal::BeginPlay()
{
    Super::BeginPlay();

    // Получаем SaveId из подсистемы
    AFicsitAISubsystem* Subsystem = AFicsitAISubsystem::Get(this);
    if (Subsystem)
    {
        HostContext.SaveId = Subsystem->GetSaveId();
        if (Subsystem->IsInertMode())
        {
            HostContext.HostState = EFicsitAIHostState::Inert;
        }
    }

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

    // Поверхность экрана 16:9
    if (!ScreenSurface)
    {
        UFicsitAIScreenSurfaceWidget* SurfaceWidget = NewObject<UFicsitAIScreenSurfaceWidget>(this);
        ScreenSurface.SetObject(SurfaceWidget);
        ScreenSurface.SetInterface(Cast<IFicsitAIScreenSurface>(SurfaceWidget));
    }

    UpdateHostState();
}

void AFicsitAITerminal::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    UpdateHostState();
}

void AFicsitAITerminal::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);

    DOREPLIFETIME(AFicsitAITerminal, HostContext);
    DOREPLIFETIME(AFicsitAITerminal, ActiveModuleId);
}

void AFicsitAITerminal::OnRep_HostContext()
{
    if (ActiveModuleInstance)
    {
        ActiveModuleInstance->OnContextChanged(HostContext);
    }
}

bool AFicsitAITerminal::HasPower() const
{
    return PowerInfoComponent && PowerInfoComponent->HasPower();
}

void AFicsitAITerminal::TeardownActiveModule()
{
    if (ActiveModuleInstance)
    {
        // Сохраняем состояние в подсистеме мода по ключу (SaveId, ModuleId) (ADR-014, AC-14, Gs-15.3)
        const FString State = ActiveModuleInstance->SavePersistentState();
        if (!State.IsEmpty())
        {
            if (AFicsitAISubsystem* Subsystem = AFicsitAISubsystem::Get(this))
            {
                Subsystem->SaveModuleState(HostContext.SaveId, ActiveModuleId, State);
            }
        }

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
            if (UFicsitAIScreenSurfaceWidget* SurfaceWidget = Cast<UFicsitAIScreenSurfaceWidget>(ScreenSurface.GetObject()))
            {
                SurfaceWidget->SetHostState(EFicsitAIHostState::Inert);
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
            if (UFicsitAIScreenSurfaceWidget* SurfaceWidget = Cast<UFicsitAIScreenSurfaceWidget>(ScreenSurface.GetObject()))
            {
                SurfaceWidget->SetHostState(EFicsitAIHostState::NoPower);
            }
            UE_LOG(LogFicsitAITerminal, Log, TEXT("Терминал обесточен (требуется 10 МВт). Экран погашен."));
        }
    }
    else
    {
        if (HostContext.HostState != EFicsitAIHostState::Ready)
        {
            HostContext.HostState = EFicsitAIHostState::Ready;
            if (UFicsitAIScreenSurfaceWidget* SurfaceWidget = Cast<UFicsitAIScreenSurfaceWidget>(ScreenSurface.GetObject()))
            {
                SurfaceWidget->SetHostState(EFicsitAIHostState::Ready);
            }
            UE_LOG(LogFicsitAITerminal, Log, TEXT("Терминал запитан (10 МВт). Готов к работе."));
        }
    }
}

void AFicsitAITerminal::OnUse_Implementation(AFGCharacterPlayer* byCharacter, const FUseState& state)
{
    UpdateHostState();

    if (HostContext.HostState == EFicsitAIHostState::NoPower)
    {
        UE_LOG(LogFicsitAITerminal, Log, TEXT("Терминал без питания (10 MW требуется). Экран гаснет (AC-01, §6.1)."));
        return;
    }

    if (HostContext.HostState == EFicsitAIHostState::Inert)
    {
        UE_LOG(LogFicsitAITerminal, Log, TEXT("Терминал в инертном режиме (мультиплеерная сессия). Экран недоступен."));
        return;
    }

    // Если нет открытого модуля, открываем модуль по умолчанию (Notes), иначе переключаем/закрываем
    if (ActiveModuleId == NAME_None)
    {
        OpenModule(FName(TEXT("Notes")));
    }
    else
    {
        CloseActiveModule();
    }
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
    UpdateHostState();

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
