#pragma once
#include <atomic>

#include "CEFInclude.h"
#include "BluTypes.h"
#include "FicsitAIWebIsolation.h"

class UBluEye;


class RenderHandler : public CefRenderHandler
{
	public:
		UBluEye* ParentUI;

		int32 Width;
		int32 Height;

		// CefRenderHandler interface
		virtual void GetViewRect(CefRefPtr<CefBrowser> Browser, CefRect &Rect) override;

		void OnPaint(CefRefPtr<CefBrowser> Browser, PaintElementType Type, const RectList &DirtyRects, const void *Buffer, int Width, int Height) override;

		// FicsitAI: всплывающий слой (раскрытый <select>) CEF рисует отдельным буфером PET_POPUP своего размера.
		// BLUI копировал его как буфер всей страницы — чтение за концом буфера и падение игры (проверено 12.11.2026).
		// Теперь слой накладывается поверх последнего кадра страницы, как в cefclient.
		virtual void OnPopupShow(CefRefPtr<CefBrowser> Browser, bool bShow) override;
		virtual void OnPopupSize(CefRefPtr<CefBrowser> Browser, const CefRect& Rect) override;

		RenderHandler(int32 Width, int32 Height, UBluEye* UI);

		/** FicsitAI: последний полный кадр страницы (BGRA, premultiplied alpha) — для проверок прозрачности. */
		const TArray<uint8>& GetViewPixels() const { return ViewPixels; }
		/** FicsitAI: размер браузера сменился — снова предупредить о первом кадре старого размера. */
		void OnResized() { bWarnedSize = false; }

	private:
		TArray<uint8> ViewPixels;     // последний полный кадр страницы
		TArray<uint8> PopupPixels;    // последний кадр всплывающего слоя
		TArray<uint8> Composite;      // кадр страницы с наложенным слоем
		CefRect PopupRect;
		int32 PopupWidth = 0;
		int32 PopupHeight = 0;
		bool bPopupShown = false;
		bool bWarnedSize = false;

		void Upload(const void* Pixels, const RectList& Rects);
		const TArray<uint8>& Compose();
		CefRect ClampToView(const CefRect& Rect) const;

		// CefBase interface
		// NOTE: Must be at bottom
	public:
		IMPLEMENT_REFCOUNTING(RenderHandler);
};

// for manual render handler
class BrowserClient : public CefClient, public CefLifeSpanHandler, public CefDownloadHandler, public CefDisplayHandler,
	public CefRequestHandler, public CefResourceRequestHandler, public CefLoadHandler
{

	private:
		FScriptEvent* EventEmitter;
		FLogEvent* LogEmitter;
		// FicsitAI: мост и счётчик отклонённых событий (S8, блок 4)
		TMulticastDelegate<void(const FString&, const FString&)>* NativeEmitter = nullptr;
		int32* RejectedCounter = nullptr;
		CefRefPtr<RenderHandler> RenderHandlerRef;

		// FicsitAI: сторож первой загрузки
		CefRefPtr<CefFrame> PendingFrame;
		CefString PendingUrl;
		int PendingSerial = 0;
		int LoadRetries = 0;
		bool bPendingCommitted = true;

		// For lifespan
		CefRefPtr<CefBrowser> BrowserRef;
		int BrowserId = 0;
		bool bIsClosing = false; // FicsitAI: в BLUI поле не инициализировано

	public:
		BrowserClient(RenderHandler* InRenderHandler) : RenderHandlerRef(InRenderHandler)
		{
		
		};

		virtual CefRefPtr<CefRenderHandler> GetRenderHandler() 
		{
			return RenderHandlerRef;
		};

		// Getter for renderer
		virtual CefRefPtr<RenderHandler> GetRenderHandlerCustom()
		{
			return RenderHandlerRef;
		};

		// Getter for lifespan
		virtual CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override
		{
			return this;
		}
		//required or pdf download won't work 
		virtual CefRefPtr<CefDownloadHandler> GetDownloadHandler() override 
		{
			return this; 	
		}

		// FicsitAI: изоляция страниц — фильтр переходов и запросов, раздача из каталога страниц.
		virtual CefRefPtr<CefRequestHandler> GetRequestHandler() override
		{
			return this;
		}

		// FicsitAI: сторож первой загрузки. Сетевой процесс CEF завершается при создании первого браузера
		// (замеры 11.11.2026, шесть прогонов из шести), и переход, начатый в этот момент, теряется без ошибки:
		// браузер остаётся на about:blank. Если переход на нашу страницу не начал загружаться за три секунды,
		// он повторяется, не больше трёх раз.
		virtual CefRefPtr<CefLoadHandler> GetLoadHandler() override
		{
			return this;
		}
		virtual void OnLoadStart(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame, cef_transition_type_t TransitionType) override;
		virtual void OnLoadEnd(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame, int HttpStatusCode) override;
		virtual void OnLoadError(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame, cef_errorcode_t ErrorCode,
			const CefString& ErrorText, const CefString& FailedUrl) override;
		void WatchPendingLoad(CefRefPtr<CefFrame> Frame, const CefString& Url);
		void CheckPendingLoad(int Serial);

		// CefRequestHandler. Переход фрейма куда-либо, кроме нашего источника, отменяется.
		virtual bool OnBeforeBrowse(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame, CefRefPtr<CefRequest> Request,
			bool bUserGesture, bool bIsRedirect) override
		{
			const bool bAllowed = FicsitAIWeb::IsAllowedNavigation(Request->GetURL());
			if (bAllowed && Frame->IsMain() && Request->GetURL() != "about:blank")
			{
				WatchPendingLoad(Frame, Request->GetURL());
			}
			if (!bAllowed)
			{
				UE_LOG(LogBlu, Warning, TEXT("FicsitAI: navigation blocked: %s"), *FString(Request->GetURL().ToWString().c_str()).Left(200));
			}
			return !bAllowed;
		}

		virtual bool OnOpenURLFromTab(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame, const CefString& TargetUrl,
			cef_window_open_disposition_t TargetDisposition, bool bUserGesture) override
		{
			return true;
		}

		// Запрос по сетевой схеме либо обслуживает наш обработчик, либо он отменяется: в сеть из страницы не уходит ничего.
		virtual CefRefPtr<CefResourceRequestHandler> GetResourceRequestHandler(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame,
			CefRefPtr<CefRequest> Request, bool bIsNavigation, bool bIsDownload, const CefString& RequestInitiator,
			bool& bDisableDefaultHandling) override
		{
			bDisableDefaultHandling = FicsitAIWeb::IsNetworkScheme(Request->GetURL());
			return this;
		}

		// CefResourceRequestHandler
		virtual ReturnValue OnBeforeResourceLoad(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame, CefRefPtr<CefRequest> Request,
			CefRefPtr<CefCallback> Callback) override
		{
			if (!FicsitAIWeb::IsAllowedResource(Request->GetURL()))
			{
				UE_LOG(LogBlu, Warning, TEXT("FicsitAI: request blocked: %s"), *FString(Request->GetURL().ToWString().c_str()).Left(200));
				return RV_CANCEL;
			}
			return RV_CONTINUE;
		}

		virtual CefRefPtr<CefResourceHandler> GetResourceHandler(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame,
			CefRefPtr<CefRequest> Request) override
		{
			return FicsitAIWeb::MakeResourceHandler(Request);
		}

		// needed or console log & js script callbacks won't show up
		virtual CefRefPtr<CefDisplayHandler> GetDisplayHandler() override
		{
			return this;
		}

		virtual bool OnProcessMessageReceived(CefRefPtr<CefBrowser> Browser, 
			CefRefPtr<CefFrame> Frame,
			CefProcessId SourceProcess, 
			CefRefPtr<CefProcessMessage> Message) override;

		virtual void OnUncaughtException(CefRefPtr<CefBrowser> Browser,
			CefRefPtr<CefFrame> Frame,
			CefRefPtr<CefV8Context> Context,
			CefRefPtr<CefV8Exception> Exception,
			CefRefPtr<CefV8StackTrace> StackTrace);

		void SetEventEmitter(FScriptEvent* Emitter);
		void SetLogEmitter(FLogEvent* Emitter);
		void SetNativeEmitter(TMulticastDelegate<void(const FString&, const FString&)>* Emitter, int32* Rejected);

		//CefDownloadHandler
		// FicsitAI: загрузки запрещены целиком — CEF не начинает их вовсе.
		virtual bool CanDownload(CefRefPtr<CefBrowser> Browser, const CefString& Url, const CefString& RequestMethod) override { return false; }
		virtual bool OnBeforeDownload(
			CefRefPtr<CefBrowser> Browser,
			CefRefPtr<CefDownloadItem> DownloadItem,
			const CefString& SuggestedName,
			CefRefPtr<CefBeforeDownloadCallback> Callback) override;

		virtual void OnDownloadUpdated(
			CefRefPtr<CefBrowser> Browser,
			CefRefPtr<CefDownloadItem> DownloadItem,
			CefRefPtr<CefDownloadItemCallback> Callback) override;

		//CefLifeSpanHandler
		virtual bool OnBeforePopup(CefRefPtr<CefBrowser> Browser,
			CefRefPtr<CefFrame> Frame,
			const CefString& TargetUrl,
			const CefString& TargetFrameName,
			cef_window_open_disposition_t TargetDisposition,
			bool UserGesture,
			const CefPopupFeatures& PopupFeatures,
			CefWindowInfo& WindowInfo,
			CefRefPtr<CefClient>& Client,
			CefBrowserSettings& Settings,
			CefRefPtr<CefDictionaryValue>& ExtraInfo,
			bool* NoJavascriptAccess) override {
			// FicsitAI: всплывающие окна запрещены (true — отменить создание).
			return true;
		}

		// Lifespan methods
		void OnAfterCreated(CefRefPtr<CefBrowser> Browser) override;
		void OnBeforeClose(CefRefPtr<CefBrowser> Browser) override;

		virtual bool OnConsoleMessage(CefRefPtr<CefBrowser> Browser,
				cef_log_severity_t Level,
				const CefString& Message,
				const CefString& Source,
				int Line) override;

		virtual void OnFullscreenModeChange(CefRefPtr< CefBrowser > Browser, bool Fullscreen) override;

		virtual void OnTitleChange(CefRefPtr< CefBrowser > Browser, const CefString& Title);

		// FicsitAI: курсор страницы. CEF в режиме без окна не ставит курсор сам — запоминаем тип,
		// виджет ввода отдаёт его Slate в OnCursorQuery.
		virtual bool OnCursorChange(CefRefPtr<CefBrowser> Browser, CefCursorHandle Cursor, cef_cursor_type_t Type,
			const CefCursorInfo& CustomCursorInfo) override
		{
			CursorType.store(static_cast<int32>(Type));
			return true;
		}
		std::atomic<int32> CursorType{ CT_POINTER };

		CefRefPtr<CefBrowser> GetCEFBrowser();

		// NOTE: Must be at bottom
	public:
		IMPLEMENT_REFCOUNTING(BrowserClient);
};


