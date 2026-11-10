#include "Host/FicsitAITestScreenHost.h"

void UFicsitAITestScreenHost::InitializeTestHost(const FString& InSaveId, TScriptInterface<IFicsitAIScreenModuleFactory> InFactory)
{
    HostContext.SaveId = InSaveId;
    HostContext.HostId = FName(TEXT("TestScreenHost"));
    HostContext.Layout = EFicsitAIScreenLayout::Slots1;
    HostContext.SizePx = FIntPoint(1920, 1080);
    HostContext.AspectRatio = 16.0f / 9.0f;
    HostContext.bWorldSurface = false;
    HostContext.HostState = EFicsitAIHostState::Ready;
    HostContext.bHasInputFocus = false;

    ModuleFactory = InFactory;
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

    // Закрываем текущий с сохранением состояния
    if (ActiveModuleInstance)
    {
        FString StateJson;
        if (ActiveModuleInstance->SavePersistentState(StateJson))
        {
            ModulePersistentStates.FindOrAdd(ActiveModuleId) = StateJson;
        }
        ActiveModuleInstance->OnDetach();
        ActiveModuleInstance = nullptr;
        ActiveModuleId = NAME_None;
    }

    // Ищем или создаем модуль через фабрику
    TScriptInterface<IFicsitAIScreenModule> TargetModule;
    if (TScriptInterface<IFicsitAIScreenModule>* Found = LoadedModules.Find(ModuleId))
    {
        TargetModule = *Found;
    }
    else if (ModuleFactory)
    {
        TargetModule = ModuleFactory->CreateModuleWidget(ModuleId, this);
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
    ActiveModuleInstance->OnAttach(HostContext);

    // Восстанавливаем состояние, если было сохранено
    if (const FString* SavedState = ModulePersistentStates.Find(ModuleId))
    {
        ActiveModuleInstance->RestorePersistentState(*SavedState);
    }

    return true;
}

void UFicsitAITestScreenHost::CloseModule(FName ModuleId)
{
    if (ActiveModuleId == ModuleId && ActiveModuleInstance)
    {
        FString StateJson;
        if (ActiveModuleInstance->SavePersistentState(StateJson))
        {
            ModulePersistentStates.FindOrAdd(ActiveModuleId) = StateJson;
        }
        ActiveModuleInstance->OnDetach();
        ActiveModuleInstance = nullptr;
        ActiveModuleId = NAME_None;
    }
}

void UFicsitAITestScreenHost::SetFocusToModule(bool bFocus)
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

void UFicsitAITestScreenHost::NotifyContentChanged()
{
}

void UFicsitAITestScreenHost::SetTestHostState(EFicsitAIHostState NewState)
{
    HostContext.HostState = NewState;
    if (NewState != EFicsitAIHostState::Ready && ActiveModuleInstance)
    {
        FString StateJson;
        if (ActiveModuleInstance->SavePersistentState(StateJson))
        {
            ModulePersistentStates.FindOrAdd(ActiveModuleId) = StateJson;
        }
        ActiveModuleInstance->OnDetach();
        ActiveModuleInstance = nullptr;
        ActiveModuleId = NAME_None;
    }
}
