#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "Containers/Ticker.h"
#include "IFicsitAIScreenModule.h"
#include "FicsitAIWebScreenModule.generated.h"

class SBox;
class SWidget;
class FFicsitAIWebBridge;
class FFicsitAIApiClient;

/**
 * Экранный модуль на веб-странице (ADR-032, ARCHITECTURE §6.3.1; S8 3.4).
 *
 * Для хоста — обычный IFicsitAIScreenModule: хост не знает ни про браузер, ни про мост. Внутри — браузер BLUI
 * со страницей из каталога `Web/` мода (https://ficsitai.invalid/...) и мост страница ↔ мод.
 *
 * Браузер живёт, пока модуль прикреплён к хосту: OnAttach создаёт, OnDetach закрывает (бюджет процессов §6.3.1).
 *
 * Экран в мире (bWorldSurface): страница рисуется в размер области модуля, без подстройки под пиксели окна,
 * с частотой не выше WorldFrameRate. Хост рисует render target только по NotifyContentChanged, поэтому модуль
 * сам следит за новыми кадрами страницы и сообщает о них не чаще WorldFrameRate раз в секунду (условие «б»).
 *
 * Esc странице не передаётся: он уходит хосту, а хост спрашивает HandleBackAction. Страница, которой есть что
 * отменить (поток чата), заранее заявляет это запросом моста `screen.back.capture`, и тогда модуль отдаёт ей
 * событие `screen.back` вместо закрытия экрана.
 *
 * Клавиши «Назад» хоста (Context.BackKeys) странице не передаются, поэтому переназначенное действие тоже доходит
 * до хоста.
 *
 * Без браузера (сервер, платформа без FicsitAIWebRuntime, CEF не поднялся или отказал в браузере) модуль
 * показывает надпись и не падает. Фабрика регистрирует веб-экран, только если IsWebAvailable и IsPageReady.
 */
UCLASS()
class FICSITAIUI_API UFicsitAIWebScreenModule : public UUserWidget, public IFicsitAIScreenModule
{
    GENERATED_BODY()

public:
    /** Частота кадров страницы и перерисовки экрана в мире. */
    static constexpr int32 WorldFrameRate = 10;
    /** Частота кадров страницы на интерактивном экране. */
    static constexpr int32 InteractiveFrameRate = 60;

    /** Задаёт фабрика сразу после создания. PagePath — путь страницы от корня `Web/`, с ведущей косой чертой. */
    void Configure(FName InModuleId, const FString& InPagePath, const FText& InDisplayName);

    /** Адрес страницы модуля. */
    FString GetPageUrl() const;

    /** Браузер этого модуля сейчас создан. */
    bool HasBrowser() const;
    /** Кадров страницы, загруженных в текстуру (для проверок). */
    int64 GetUploadedFrames() const;
    /** Сколько раз модуль попросил хост перерисовать экран в мире (для проверок). */
    int64 GetWorldNotifies() const { return WorldNotifies; }
    /** Страница заявила, что сама обработает Esc. */
    bool IsBackCaptured() const { return bBackCaptured; }
    /** Подключена ли страница к API мода: хост передал API, браузер создан. */
    bool IsApiConnected() const { return ApiClient.IsValid(); }
    /** Браузер этого модуля не создался: CEF отказал (для проверок и надписи на экране). */
    bool HasBrowserFailed() const { return bBrowserFailed; }
    /** Есть ли браузер: клиент Win64 с FicsitAIWebRuntime и поднятым CEF. false — сервер, Linux-редактор, отказ CEF. */
    static bool IsWebAvailable();
    /**
     * Страница запустится в игре: файл есть в каталоге страниц, у неё нет встроенных скриптов (CSP страниц —
     * `script-src 'self'`, встроенный скрипт и import map он не выполнит), и каждый скрипт по `src` лежит рядом.
     * Модули, которые загружают эти скрипты, не проверяются. Результат запоминается на процесс: каталог страниц
     * в игре не меняется. OutReason — почему нет. Только GameThread.
     */
    static bool IsPageReady(const FString& PagePath, FString* OutReason = nullptr);

    // IFicsitAIScreenModule
    virtual FName GetModuleId() const override { return ModuleId; }
    virtual FString GetRequiredApiVersion() const override { return TEXT("0.5.0"); }
    virtual void OnAttach(const FFicsitAIScreenContext& Context) override;
    virtual void OnContextChanged(const FFicsitAIScreenContext& Context) override;
    virtual void OnDetach() override;
    virtual bool WantsInputFocus() const override { return true; }
    virtual FText GetDisplayName() const override { return DisplayName; }
    virtual bool HandleBackAction() override;

protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
    virtual void ReleaseSlateResources(bool bReleaseChildren) override;
    virtual void NativeTick(const FGeometry& MyGeometry, float InDeltaTime) override;
    virtual void BeginDestroy() override;

private:
    FName ModuleId;
    FString PagePath;
    FText DisplayName;

    UPROPERTY(Transient)
    FFicsitAIScreenContext CurrentContext;

    /** UBluEye. Тип UObject, чтобы заголовок не зависел от Blu: на сервере и в Linux-редакторе его нет. */
    UPROPERTY(Transient)
    TObjectPtr<UObject> Eye;

    TSharedPtr<SBox> RootBox;
    TSharedPtr<SWidget> View;
    TSharedPtr<FFicsitAIWebBridge, ESPMode::ThreadSafe> Bridge;
    /** Подключение страницы к API: своё у каждого модуля, со своим лимитом частоты (public-api-v0, «Лимиты»). */
    TSharedPtr<FFicsitAIApiClient> ApiClient;

    FTSTicker::FDelegateHandle WorldTicker;
    int64 LastSeenUploads = 0;
    double LastWorldNotify = 0.0;
    int64 WorldNotifies = 0;

    bool bAttached = false;
    bool bBackCaptured = false;
    bool bFocusPending = false;
    bool bBrowserFailed = false;

    void CreateBrowser();
    void DestroyBrowser();
    /** Подключить страницу к API из контекста хоста и пустить события API в мост. */
    void ConnectApi();
    void ApplyContext();
    void RebuildContent();
    void SetWorldWatch(bool bEnabled);
    TArray<FKey> HostKeys() const;
    bool TickWorld(float DeltaTime);
};
