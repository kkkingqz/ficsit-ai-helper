#include "Host/FicsitAITestScreenHost.h"

void UFicsitAITestScreenHost::InitializeTestHost(const FString& InSaveId, TScriptInterface<IFicsitAIScreenModuleFactory> InFactory)
{
    HostContext.SaveId = InSaveId;
    HostContext.HostId = FName(TEXT("TestHost"));
    HostContext.Layout = EFicsitAIScreenLayout::Slots3;
    HostContext.SizePx = FIntPoint(1920, 1080);
    HostContext.AspectRatio = 16.0f / 9.0f;
    HostContext.bWorldSurface = false;
    HostContext.HostState = EFicsitAIHostState::Ready;
    HostContext.bHasInputFocus = false;
    HostContext.Host.SetObject(this);
    HostContext.Host.SetInterface(Cast<IFicsitAIScreenHost>(this));

    ModuleFactory = InFactory;

    UFicsitAIScreenSurfaceWidget* SurfaceWidget = NewObject<UFicsitAIScreenSurfaceWidget>(this);
    ScreenSurface.SetObject(SurfaceWidget);
    ScreenSurface.SetInterface(Cast<IFicsitAIScreenSurface>(SurfaceWidget));
}

TArray<FName> UFicsitAITestScreenHost::GetAvailableModules() const
{
    if (ModuleFactory)
    {
        return ModuleFactory->GetRegisteredModules();
    }
    return { FName(TEXT("Notes")), FName(TEXT("Status")) };
}

bool UFicsitAITestScreenHost::OpenModule(FName ModuleId)
{
    if (HostContext.HostState != EFicsitAIHostState::Ready)
    {
        return false;
    }

    if (ActiveModuleId == ModuleId && ActiveModuleInstance)
    {
        return true;
    }

    // Сохранение и отсоединение текущего модуля (AC-14)
    if (ActiveModuleInstance)
    {
        const FString State = ActiveModuleInstance->SavePersistentState();
        if (!State.IsEmpty())
        {
            ModulePersistentStates.FindOrAdd(ActiveModuleId) = State;
        }
        ActiveModuleInstance->OnDetach();
        if (ScreenSurface)
        {
            ScreenSurface->ClearModule();
        }
        ActiveModuleInstance = nullptr;
        ActiveModuleId = NAME_None;
    }

    // Создание или загрузка из кэша
    TScriptInterface<IFicsitAIScreenModule> TargetModule;
    if (TScriptInterface<IFicsitAIScreenModule>* Cached = LoadedModules.Find(ModuleId))
    {
        TargetModule = *Cached;
    }
    else if (ModuleFactory)
    {
        TargetModule = ModuleFactory->CreateModule(ModuleId, this);
        if (TargetModule)
        {
            LoadedModules.Add(ModuleId, TargetModule);
        }
    }

    if (!TargetModule)
    {
        return false;
    }

    ActiveModuleId = ModuleId;
    ActiveModuleInstance = TargetModule;

    // Жизненный цикл по docs/interfaces/screen-host-and-module.md:
    // CreateModule -> OnAttach(Context) -> RestorePersistentState(State) -> Surface->SetModule
    ActiveModuleInstance->OnAttach(HostContext);

    if (const FString* SavedState = ModulePersistentStates.Find(ModuleId))
    {
        ActiveModuleInstance->RestorePersistentState(*SavedState);
    }

    if (ScreenSurface)
    {
        ScreenSurface->SetModule(TargetModule);
    }

    return true;
}

void UFicsitAITestScreenHost::CloseActiveModule()
{
    if (ActiveModuleInstance)
    {
        const FString State = ActiveModuleInstance->SavePersistentState();
        if (!State.IsEmpty())
        {
            ModulePersistentStates.FindOrAdd(ActiveModuleId) = State;
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

void UFicsitAITestScreenHost::SetTestHostState(EFicsitAIHostState NewState)
{
    HostContext.HostState = NewState;

    if (UFicsitAIScreenSurfaceWidget* SurfaceWidget = Cast<UFicsitAIScreenSurfaceWidget>(ScreenSurface.GetObject()))
    {
        SurfaceWidget->SetHostState(NewState);
    }

    // При Ready -> NoPower или Ready -> Inert модуль закрывается с сохранением состояния (Gs-15.3)
    if (NewState != EFicsitAIHostState::Ready && ActiveModuleInstance)
    {
        CloseActiveModule();
    }
}

void UFicsitAITestScreenHost::RequestInputFocus(bool bWanted)
{
    HostContext.bHasInputFocus = bWanted;
    if (ActiveModuleInstance)
    {
        ActiveModuleInstance->OnContextChanged(HostContext);
    }
}

void UFicsitAITestScreenHost::NotifyContentChanged()
{
}

bool UFicsitAITestScreenHost::HandleBackAction()
{
    if (ActiveModuleInstance && ActiveModuleInstance->HandleBackAction())
    {
        return true;
    }

    CloseActiveModule();
    return true;
}
