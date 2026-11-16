#include "Web/FicsitAIWebScreenModule.h"

#include "Framework/Application/SlateApplication.h"
#include "Interfaces/IPluginManager.h"
#include "Misc/Paths.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Text/STextBlock.h"

#if WITH_FICSITAI_WEB
#include "BluEye.h"
#include "FicsitAIWebBridge.h"
#include "FicsitAIWebIsolation.h"
#include "FicsitAIWebView.h"
#endif

DEFINE_LOG_CATEGORY_STATIC(LogFicsitAIWebScreen, Log, All);

namespace
{
    /** Размер области модуля на экране в мире по умолчанию: 1280 × (720 − 48), §6.6, ADR-030. */
    const FIntPoint DefaultWorldSize(1280, 672);

#if WITH_FICSITAI_WEB
    /**
     * Страницы основного мода лежат в его каталоге `Web/`. Корень общий для всех браузеров процесса, поэтому
     * задаётся один раз, до создания первого браузера. Если каталога нет (сборка без страниц), остаётся корень
     * FicsitAIWebRuntime — там страницы проверок S8.
     */
    void EnsureModWebRoot()
    {
        static bool bDone = false;
        if (bDone)
        {
            return;
        }
        bDone = true;
        const TSharedPtr<IPlugin> Plugin = IPluginManager::Get().FindPlugin(TEXT("FicsitAI"));
        if (!Plugin.IsValid())
        {
            return;
        }
        const FString Dir = FPaths::ConvertRelativePathToFull(Plugin->GetBaseDir() / TEXT("Web"));
        if (FPaths::DirectoryExists(Dir))
        {
            FicsitAIWeb::SetWebRoot(Dir);
        }
        else
        {
            UE_LOG(LogFicsitAIWebScreen, Warning, TEXT("Каталога страниц мода нет (%s), страницы берутся из %s"),
                *Dir, *FicsitAIWeb::GetWebRoot());
        }
    }
#endif
}

bool UFicsitAIWebScreenModule::IsWebAvailable()
{
#if WITH_FICSITAI_WEB
    return !IsRunningDedicatedServer() && FSlateApplication::IsInitialized();
#else
    return false;
#endif
}

void UFicsitAIWebScreenModule::Configure(FName InModuleId, const FString& InPagePath, const FText& InDisplayName)
{
    ModuleId = InModuleId;
    PagePath = InPagePath.StartsWith(TEXT("/")) ? InPagePath : TEXT("/") + InPagePath;
    DisplayName = InDisplayName;
}

FString UFicsitAIWebScreenModule::GetPageUrl() const
{
#if WITH_FICSITAI_WEB
    return FString(FicsitAIWeb::Origin()) + PagePath;
#else
    return PagePath;
#endif
}

bool UFicsitAIWebScreenModule::HasBrowser() const
{
    return Eye != nullptr;
}

int64 UFicsitAIWebScreenModule::GetUploadedFrames() const
{
#if WITH_FICSITAI_WEB
    if (const UBluEye* E = Cast<UBluEye>(Eye))
    {
        return E->PaintStats.Uploads;
    }
#endif
    return 0;
}

void UFicsitAIWebScreenModule::OnAttach(const FFicsitAIScreenContext& Context)
{
    CurrentContext = Context;
    bAttached = true;
    bBackCaptured = false;
    CreateBrowser();
    ApplyContext();
}

void UFicsitAIWebScreenModule::OnContextChanged(const FFicsitAIScreenContext& Context)
{
    CurrentContext = Context;
    if (bAttached)
    {
        ApplyContext();
    }
}

void UFicsitAIWebScreenModule::OnDetach()
{
    bAttached = false;
    bBackCaptured = false;
    bFocusPending = false;
    SetWorldWatch(false);
    DestroyBrowser();
    CurrentContext = FFicsitAIScreenContext();
}

bool UFicsitAIWebScreenModule::HandleBackAction()
{
#if WITH_FICSITAI_WEB
    if (bBackCaptured && Bridge.IsValid())
    {
        // Отменять или нет — решает страница; повторный Esc снова придёт сюда, пока она держит захват.
        Bridge->PushEvent(TEXT("screen.back"), MakeShared<FJsonObject>());
        return true;
    }
#endif
    return false;
}

void UFicsitAIWebScreenModule::CreateBrowser()
{
#if WITH_FICSITAI_WEB
    if (Eye || !IsWebAvailable())
    {
        RebuildContent();
        return;
    }
    EnsureModWebRoot();

    const FIntPoint Size = CurrentContext.bWorldSurface && CurrentContext.SizePx.X > 0 && CurrentContext.SizePx.Y > 0
        ? CurrentContext.SizePx
        : (CurrentContext.bWorldSurface ? DefaultWorldSize : FIntPoint(FMath::Max(CurrentContext.SizePx.X, 16), FMath::Max(CurrentContext.SizePx.Y, 16)));

    UBluEye* E = NewObject<UBluEye>(this);
    E->SetProperties(Size.X, Size.Y, false, true, false, GetPageUrl(), FName(TEXT("BluTexture")), nullptr);
    E->Settings.FrameRate = CurrentContext.bWorldSurface ? WorldFrameRate : InteractiveFrameRate;
    E->Settings.bAudioMuted = true;
    E->Settings.bAutoPlayEnabled = false;
    const double T0 = FPlatformTime::Seconds();
    E->Init();
    Eye = E;
    LastSeenUploads = 0;
    UE_LOG(LogFicsitAIWebScreen, Log, TEXT("%s: браузер %dx%d, %s, %.1f мс"),
        *ModuleId.ToString(), Size.X, Size.Y, *GetPageUrl(), (FPlatformTime::Seconds() - T0) * 1000.0);

    TWeakObjectPtr<UFicsitAIWebScreenModule> WeakThis(this);
    Bridge = FFicsitAIWebBridge::Attach(E, [WeakThis](const FString& Op, const TSharedRef<FJsonObject>& Args, const FFicsitAIBridgeResponder& Respond)
    {
        UFicsitAIWebScreenModule* Self = WeakThis.Get();
        if (!Self)
        {
            Respond.Fail(TEXT("SOURCE_UNAVAILABLE"), TEXT("экран закрыт"));
            return;
        }
        // Запросы самого экрана, не API: их обрабатывает модуль, хост о них не знает.
        if (Op == TEXT("screen.back.capture"))
        {
            bool bActive = false;
            if (!Args->TryGetBoolField(TEXT("active"), bActive))
            {
                Respond.Fail(TEXT("INVALID_ARGUMENT"), TEXT("нужно поле active: boolean"));
                return;
            }
            Self->bBackCaptured = bActive;
            Respond.Ok(MakeShared<FJsonValueNull>());
            return;
        }
        // API v0 в моде появится с V-2; до тех пор источник данных честно недоступен (public-api-v0, коды ошибок).
        Respond.Fail(TEXT("SOURCE_UNAVAILABLE"), TEXT("API мода ещё не подключён к странице"));
    });
    RebuildContent();
#else
    RebuildContent();
#endif
}

void UFicsitAIWebScreenModule::DestroyBrowser()
{
#if WITH_FICSITAI_WEB
    if (Bridge.IsValid())
    {
        Bridge->Detach();
        Bridge.Reset();
    }
    if (View.IsValid())
    {
        StaticCastSharedPtr<SFicsitAIWebView>(View)->ReleaseAll();
    }
    if (UBluEye* E = Cast<UBluEye>(Eye))
    {
        E->CloseBrowser();
    }
#endif
    Eye = nullptr;
    View.Reset();
    RebuildContent();
}

void UFicsitAIWebScreenModule::ApplyContext()
{
#if WITH_FICSITAI_WEB
    UBluEye* E = Cast<UBluEye>(Eye);
    const bool bWorld = CurrentContext.bWorldSurface;
    if (E)
    {
        if (View.IsValid())
        {
            const TSharedPtr<SFicsitAIWebView> WebView = StaticCastSharedPtr<SFicsitAIWebView>(View);
            // На интерактивном экране страница идёт за пикселями окна; в мире — ровно в размер области модуля.
            WebView->SetFollowPixelSize(!bWorld);
            if (bWorld)
            {
                WebView->ReleaseAll();
            }
        }
        if (bWorld)
        {
            const FIntPoint Want = CurrentContext.SizePx.X > 0 && CurrentContext.SizePx.Y > 0 ? CurrentContext.SizePx : DefaultWorldSize;
            if (FIntPoint((int32)E->Settings.ViewSize.X, (int32)E->Settings.ViewSize.Y) != Want)
            {
                E->ResizeBrowser(Want.X, Want.Y);
            }
        }
        const int32 Rate = bWorld ? WorldFrameRate : InteractiveFrameRate;
        E->Settings.FrameRate = Rate;
        if (CefRefPtr<CefBrowserHost> Host = E->GetBrowserHost())
        {
            Host->SetWindowlessFrameRate(Rate);
        }
    }
    bFocusPending = !bWorld && E != nullptr;
    SetWorldWatch(bWorld && E != nullptr);
#endif
}

void UFicsitAIWebScreenModule::SetWorldWatch(bool bEnabled)
{
    if (bEnabled && !WorldTicker.IsValid())
    {
        LastWorldNotify = 0.0;
        WorldTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this, &UFicsitAIWebScreenModule::TickWorld));
    }
    else if (!bEnabled && WorldTicker.IsValid())
    {
        FTSTicker::GetCoreTicker().RemoveTicker(WorldTicker);
        WorldTicker.Reset();
    }
}

bool UFicsitAIWebScreenModule::TickWorld(float DeltaTime)
{
    // Хост рисует экран в мире только по NotifyContentChanged, а страница меняется сама (графики, поток чата).
    // Новый кадр страницы — повод перерисовать, но не чаще WorldFrameRate раз в секунду.
    const int64 Uploads = GetUploadedFrames();
    if (Uploads == LastSeenUploads)
    {
        return true;
    }
    const double Now = FPlatformTime::Seconds();
    if (Now - LastWorldNotify < 1.0 / WorldFrameRate)
    {
        return true;
    }
    LastSeenUploads = Uploads;
    LastWorldNotify = Now;
    if (IFicsitAIScreenHost* Host = CurrentContext.Host.GetInterface())
    {
        ++WorldNotifies;
        Host->NotifyContentChanged();
    }
    return true;
}

TSharedRef<SWidget> UFicsitAIWebScreenModule::RebuildWidget()
{
    SAssignNew(RootBox, SBox);
    RebuildContent();
    return RootBox.ToSharedRef();
}

void UFicsitAIWebScreenModule::RebuildContent()
{
    if (!RootBox.IsValid())
    {
        return;
    }
#if WITH_FICSITAI_WEB
    if (UBluEye* E = Cast<UBluEye>(Eye))
    {
        if (!View.IsValid())
        {
            View = SNew(SFicsitAIWebView)
                .Eye(E)
                .FollowPixelSize(!CurrentContext.bWorldSurface)
                .HostKeys({ EKeys::Escape });
        }
        RootBox->SetContent(View.ToSharedRef());
        return;
    }
#endif
    View.Reset();
    RootBox->SetContent(
        SNew(STextBlock)
        .Text(IsWebAvailable()
            ? NSLOCTEXT("FicsitAI", "WebScreenNoBrowser", "Экран не открыт")
            : NSLOCTEXT("FicsitAI", "WebScreenUnavailable", "Встроенный браузер недоступен"))
        .ColorAndOpacity(FLinearColor(0.7f, 0.7f, 0.7f, 1.0f)));
}

void UFicsitAIWebScreenModule::NativeTick(const FGeometry& MyGeometry, float InDeltaTime)
{
    Super::NativeTick(MyGeometry, InDeltaTime);
    // Фокус ставится, когда страница уже лежит в интерактивной поверхности: при OnContextChanged её там ещё нет.
    if (bFocusPending && View.IsValid() && !CurrentContext.bWorldSurface && FSlateApplication::IsInitialized())
    {
        bFocusPending = false;
        FSlateApplication::Get().SetAllUserFocus(View, EFocusCause::SetDirectly);
    }
}

void UFicsitAIWebScreenModule::ReleaseSlateResources(bool bReleaseChildren)
{
    Super::ReleaseSlateResources(bReleaseChildren);
    RootBox.Reset();
    View.Reset();
}

void UFicsitAIWebScreenModule::BeginDestroy()
{
    SetWorldWatch(false);
#if WITH_FICSITAI_WEB
    if (Bridge.IsValid())
    {
        Bridge->Detach();
        Bridge.Reset();
    }
#endif
    // Браузер закрывает сам UBluEye в своём BeginDestroy (правки P1 #54).
    Super::BeginDestroy();
}
