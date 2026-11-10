#include "GameFacade/Terminal/FicsitAITerminal.h"
#include "GameFacade/Terminal/FicsitAISubsystem.h"
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

EFicsitAIHostState AFicsitAITerminal::GetHostState() const
{
    return HostContext.HostState;
}

void AFicsitAITerminal::UpdateHostState()
{
    AFicsitAISubsystem* Subsystem = AFicsitAISubsystem::Get(this);
    if (Subsystem && Subsystem->IsInertMode())
    {
        HostContext.HostState = EFicsitAIHostState::Inert;
        return;
    }

    if (!HasPower())
    {
        HostContext.HostState = EFicsitAIHostState::NoPower;
        if (ActiveModuleInstance)
        {
            ActiveModuleInstance->OnDetach();
            ActiveModuleInstance = nullptr;
            ActiveModuleId = NAME_None;
        }
    }
    else
    {
        HostContext.HostState = EFicsitAIHostState::Ready;
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
        UE_LOG(LogFicsitAITerminal, Log, TEXT("Терминал в инертном режиме (мультиплеерная сессия)."));
        return;
    }

    // Если нет открытого модуля, открываем модуль по умолчанию (Notes)
    if (ActiveModuleId == NAME_None)
    {
        OpenModule(FName(TEXT("Notes")));
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

    // Отсоединяем текущий активный модуль
    if (ActiveModuleInstance)
    {
        ActiveModuleInstance->OnDetach();
        ActiveModuleInstance = nullptr;
        ActiveModuleId = NAME_None;
    }

    // Ищем в кэше или запрашиваем у фабрики
    TScriptInterface<IFicsitAIScreenModule> TargetModule;
    if (TScriptInterface<IFicsitAIScreenModule>* Cached = CachedModules.Find(ModuleId))
    {
        TargetModule = *Cached;
    }
    else if (ModuleFactory)
    {
        TargetModule = ModuleFactory->CreateModuleWidget(ModuleId, this);
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
    ActiveModuleInstance->OnAttach(HostContext);
    UE_LOG(LogFicsitAITerminal, Log, TEXT("Открыт экранный модуль: %s"), *ModuleId.ToString());
    return true;
}

void AFicsitAITerminal::CloseModule(FName ModuleId)
{
    if (ActiveModuleId == ModuleId && ActiveModuleInstance)
    {
        ActiveModuleInstance->OnDetach();
        ActiveModuleInstance = nullptr;
        ActiveModuleId = NAME_None;
        UE_LOG(LogFicsitAITerminal, Log, TEXT("Закрыт экранный модуль: %s"), *ModuleId.ToString());
    }
}

void AFicsitAITerminal::SetFocusToModule(bool bFocus)
{
    HostContext.bHasInputFocus = bFocus;
    if (ActiveModuleInstance)
    {
        if (bFocus)
        {
            ActiveModuleInstance->OnFocusGained();
        }
        else
        {
            ActiveModuleInstance->OnFocusLost();
        }
    }
}

void AFicsitAITerminal::NotifyContentChanged()
{
}

void AFicsitAITerminal::SetModuleFactory(TScriptInterface<IFicsitAIScreenModuleFactory> InFactory)
{
    ModuleFactory = InFactory;
}
