#include "RenderHandler.h"
#include "Interfaces/IPluginManager.h"
#include "BluEye.h"
#include "IBlu.h"
#include "Misc/ScopeExit.h"
#include "FicsitAIWebIsolation.h"

RenderHandler::RenderHandler(int32 Width, int32 Height, UBluEye* UI)
{
	this->Width = Width;
	this->Height = Height;
	this->ParentUI = UI;
}

void RenderHandler::GetViewRect(CefRefPtr<CefBrowser> Browser, CefRect &Rect)
{
	Rect = CefRect(0, 0, Width, Height);
}

void RenderHandler::Upload(const void* Pixels, const RectList& Rects)
{
	if (Rects.empty()) { return; }
	FUpdateTextureRegion2D* UpdateRegions = static_cast<FUpdateTextureRegion2D*>(FMemory::Malloc(sizeof(FUpdateTextureRegion2D) * Rects.size()));
	int32 RegionIndex = 0;
	for (const CefRect& R : Rects)
	{
		UpdateRegions[RegionIndex].DestX = UpdateRegions[RegionIndex].SrcX = R.x;
		UpdateRegions[RegionIndex].DestY = UpdateRegions[RegionIndex].SrcY = R.y;
		UpdateRegions[RegionIndex].Width = R.width;
		UpdateRegions[RegionIndex].Height = R.height;
		RegionIndex++;
	}
	// TextureUpdate копирует полный кадр ViewSize и освобождает массив областей.
	ParentUI->TextureUpdate(Pixels, UpdateRegions, Rects.size());
}

CefRect RenderHandler::ClampToView(const CefRect& Rect) const
{
	const int32 VW = (int32)ParentUI->Settings.ViewSize.X;
	const int32 VH = (int32)ParentUI->Settings.ViewSize.Y;
	const int32 X0 = FMath::Clamp(Rect.x, 0, VW), Y0 = FMath::Clamp(Rect.y, 0, VH);
	const int32 X1 = FMath::Clamp(Rect.x + Rect.width, 0, VW), Y1 = FMath::Clamp(Rect.y + Rect.height, 0, VH);
	return CefRect(X0, Y0, X1 - X0, Y1 - Y0);
}

const TArray<uint8>& RenderHandler::Compose()
{
	const int32 VW = (int32)ParentUI->Settings.ViewSize.X;
	Composite = ViewPixels;
	const CefRect Dest = ClampToView(PopupRect);
	if (Dest.IsEmpty() || PopupPixels.Num() == 0) { return Composite; }
	// Части слоя за краем страницы не рисуются; смещение источника — на величину обрезки.
	const int32 SrcX0 = Dest.x - PopupRect.x, SrcY0 = Dest.y - PopupRect.y;
	const int32 Cols = FMath::Min(Dest.width, PopupWidth - SrcX0);
	const int32 Rows = FMath::Min(Dest.height, PopupHeight - SrcY0);
	for (int32 Row = 0; Row < Rows; ++Row)
	{
		FMemory::Memcpy(Composite.GetData() + ((int64)(Dest.y + Row) * VW + Dest.x) * 4,
			PopupPixels.GetData() + ((int64)(SrcY0 + Row) * PopupWidth + SrcX0) * 4, (int64)Cols * 4);
	}
	return Composite;
}

void RenderHandler::OnPaint(CefRefPtr<CefBrowser> Browser, PaintElementType Type, const RectList &DirtyRects, const void *Buffer, int InWidth, int InHeight)
{
	const int32 VW = (int32)ParentUI->Settings.ViewSize.X;
	const int32 VH = (int32)ParentUI->Settings.ViewSize.Y;
	if (!Buffer || InWidth <= 0 || InHeight <= 0) { return; }
	// FicsitAI (3.5): сколько кадров присылает CEF и сколько времени они стоят GameThread.
	const double PaintStart = FPlatformTime::Seconds();
	++ParentUI->PaintStats.Paints;
	ON_SCOPE_EXIT { ParentUI->PaintStats.Seconds += FPlatformTime::Seconds() - PaintStart; };

	if (Type == PET_VIEW)
	{
		// Кадр не того размера (идёт смена размера) — пропускаем: копирование по ViewSize вышло бы за буфер.
		if (InWidth != VW || InHeight != VH)
		{
			++ParentUI->PaintStats.SkippedSize;
			if (!bWarnedSize) { bWarnedSize = true; UE_LOG(LogBlu, Warning, TEXT("FicsitAI: skipped paint %dx%d for view %dx%d"), InWidth, InHeight, VW, VH); }
			return;
		}
		// Копия кадра нужна, чтобы вернуть страницу под закрытым слоем. Копируем только изменённые области,
		// полный кадр — один раз; на страницу без слоя кадр CEF уходит напрямую, как раньше.
		const int64 Bytes = (int64)VW * VH * 4;
		if (ViewPixels.Num() != Bytes)
		{
			ViewPixels.SetNumUninitialized(Bytes);
			FMemory::Memcpy(ViewPixels.GetData(), Buffer, Bytes);
		}
		else
		{
			for (const CefRect& D : DirtyRects)
			{
				const CefRect R = ClampToView(D);
				for (int32 Row = 0; Row < R.height; ++Row)
				{
					const int64 Offset = ((int64)(R.y + Row) * VW + R.x) * 4;
					FMemory::Memcpy(ViewPixels.GetData() + Offset, static_cast<const uint8*>(Buffer) + Offset, (int64)R.width * 4);
				}
			}
		}
		if (!bPopupShown)
		{
			Upload(Buffer, DirtyRects);
			return;
		}
		RectList Rects = DirtyRects;
		const CefRect Dest = ClampToView(PopupRect);
		if (!Dest.IsEmpty()) { Rects.push_back(Dest); }
		Upload(Compose().GetData(), Rects);
		return;
	}

	// PET_POPUP
	if (!bPopupShown || ViewPixels.Num() != (int64)VW * VH * 4) { return; }
	PopupWidth = InWidth;
	PopupHeight = InHeight;
	PopupPixels.SetNumUninitialized((int64)InWidth * InHeight * 4);
	FMemory::Memcpy(PopupPixels.GetData(), Buffer, PopupPixels.Num());
	const CefRect Dest = ClampToView(PopupRect);
	if (!Dest.IsEmpty()) { Upload(Compose().GetData(), RectList{ Dest }); }
}

void RenderHandler::OnPopupShow(CefRefPtr<CefBrowser> Browser, bool bShow)
{
	UE_LOG(LogBlu, Display, TEXT("FicsitAI: popup %s"), bShow ? TEXT("shown") : TEXT("hidden"));
	if (bShow) { bPopupShown = true; return; }
	bPopupShown = false;
	// Вернуть под слоем кадр страницы.
	const CefRect Old = ClampToView(PopupRect);
	PopupRect = CefRect();
	PopupPixels.Reset();
	if (!Old.IsEmpty() && ViewPixels.Num() == (int64)ParentUI->Settings.ViewSize.X * ParentUI->Settings.ViewSize.Y * 4)
	{
		Upload(ViewPixels.GetData(), RectList{ Old });
	}
}

void RenderHandler::OnPopupSize(CefRefPtr<CefBrowser> Browser, const CefRect& Rect)
{
	UE_LOG(LogBlu, Display, TEXT("FicsitAI: popup rect %d,%d %dx%d"), Rect.x, Rect.y, Rect.width, Rect.height);
	// Слой переехал — сначала вернуть кадр страницы на старом месте.
	const CefRect Old = ClampToView(PopupRect);
	PopupRect = Rect;
	if (!Old.IsEmpty() && ViewPixels.Num() > 0) { Upload(ViewPixels.GetData(), RectList{ Old }); }
}

void BrowserClient::OnAfterCreated(CefRefPtr<CefBrowser> Browser)
{
	//CEF_REQUIRE_UI_THREAD();
	if (!BrowserRef.get())
	{
		// Keep a reference to the main browser.
		BrowserRef = Browser;
		BrowserId = Browser->GetIdentifier();
	}
}

void BrowserClient::OnBeforeClose(CefRefPtr<CefBrowser> Browser)
{
	//CEF_REQUIRE_UI_THREAD();
	if (BrowserId == Browser->GetIdentifier())
	{
		BrowserRef = nullptr;
	}
}

bool BrowserClient::OnConsoleMessage(CefRefPtr<CefBrowser> Browser, cef_log_severity_t Level, const CefString& Message, const CefString& source, int line)
{
	FString LogMessage = FString(Message.ToWString().c_str());
	//UE_LOG(LogTemp, Log, TEXT("Console.log: %s"), *LogMessage);
	LogEmitter->Broadcast(LogMessage);
	return true;
}

void BrowserClient::OnFullscreenModeChange(CefRefPtr< CefBrowser > Browser, bool Fullscreen)
{
	UE_LOG(LogTemp, Log, TEXT("Changed to Fullscreen: %d"), Fullscreen);
}

void BrowserClient::OnTitleChange(CefRefPtr< CefBrowser > Browser, const CefString& Title)
{
	FString TitleMessage = FString(Title.ToWString().c_str());
	LogEmitter->Broadcast(TitleMessage);
}

CefRefPtr<CefBrowser> BrowserClient::GetCEFBrowser()
{
	return BrowserRef;
}

bool BrowserClient::OnProcessMessageReceived(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame, CefProcessId SourceProcess, CefRefPtr<CefProcessMessage> Message)
{
	FString Data;
	FString Name = FString(UTF8_TO_TCHAR(Message->GetArgumentList()->GetString(0).ToString().c_str()));
	FString Type = FString(UTF8_TO_TCHAR(Message->GetArgumentList()->GetString(2).ToString().c_str()));
	FString DataType = FString(UTF8_TO_TCHAR(Message->GetArgumentList()->GetString(3).ToString().c_str()));

	if (Type == "js_event")
	{
		// FicsitAI: события принимаются только из главного кадра нашего источника (S8, блок 4). Подкадров CSP не
		// допускает (frame-src 'none'), но мост не должен на это полагаться; about:blank и чужие адреса — мимо.
		const FString FrameUrl = Frame ? FString(Frame->GetURL().ToWString().c_str()) : FString();
		const FString OurPrefix = FString(FicsitAIWeb::Origin()) + TEXT("/");
		if (!Frame || !Frame->IsMain() || !FrameUrl.StartsWith(OurPrefix, ESearchCase::CaseSensitive))
		{
			if (RejectedCounter) { ++*RejectedCounter; }
			UE_LOG(LogBlu, Warning, TEXT("FicsitAI: blu_event rejected: main=%d url=%s"), Frame && Frame->IsMain() ? 1 : 0, *FrameUrl.Left(120));
			return true;
		}

		// Check the datatype

		if (DataType == "bool")
			Data = Message->GetArgumentList()->GetBool(1) ? TEXT("true") : TEXT("false");
		else if (DataType == "int")
			Data = FString::FromInt(Message->GetArgumentList()->GetInt(1));
		else if (DataType == "string")
			Data = FString(UTF8_TO_TCHAR(Message->GetArgumentList()->GetString(1).ToString().c_str()));
		else if (DataType == "double")
			Data = FString::SanitizeFloat(Message->GetArgumentList()->GetDouble(1));

		if (NativeEmitter) { NativeEmitter->Broadcast(Name, Data); }
		EventEmitter->Broadcast(Name, Data);
	}

	return true;
}

void BrowserClient::OnUncaughtException(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame, CefRefPtr<CefV8Context> Context, CefRefPtr<CefV8Exception> Exception, CefRefPtr<CefV8StackTrace> StackTrace)
{
	FString ErrorMessage = FString(Exception->GetMessage().ToWString().c_str());
	UE_LOG(LogClass, Warning, TEXT("%s"), *ErrorMessage);
}

//The path slashes have to be reversed to work with CEF
FString ReversePathSlashes(FString ForwardPath)
{
	return ForwardPath.Replace(TEXT("/"), TEXT("\\"));
}
FString UtilityBLUIDownloadsFolder()
{
	return ReversePathSlashes(FPaths::ConvertRelativePathToFull(IPluginManager::Get().FindPlugin(TEXT("FicsitAIWebRuntime"))->GetBaseDir() + "/Downloads/"));
}


void BrowserClient::SetEventEmitter(FScriptEvent* Emitter)
{
	this->EventEmitter = Emitter;
}

void BrowserClient::SetNativeEmitter(TMulticastDelegate<void(const FString&, const FString&)>* Emitter, int32* Rejected)
{
	NativeEmitter = Emitter;
	RejectedCounter = Rejected;
}

void BrowserClient::SetLogEmitter(FLogEvent* Emitter)
{
	this->LogEmitter = Emitter;
}

bool BrowserClient::OnBeforeDownload(
	CefRefPtr<CefBrowser> Browser,
	CefRefPtr<CefDownloadItem> DownloadItem,
	const CefString & SuggestedName,
	CefRefPtr<CefBeforeDownloadCallback> Callback)
{
	UNREFERENCED_PARAMETER(Browser);
	UNREFERENCED_PARAMETER(DownloadItem);

	//We use this concatenation method to mix c_str with regular FString and then convert the result back to c_str
	FString DownloadPath = UtilityBLUIDownloadsFolder() + FString(SuggestedName.ToWString().c_str());

	// FicsitAI: загрузки запрещены (§12 п. 11). Callback не вызывается — загрузка отменяется.
	UNREFERENCED_PARAMETER(Callback);

	UE_LOG(LogClass, Warning, TEXT("FicsitAI: download blocked: %s"), *DownloadPath);

	return true;
}

void BrowserClient::OnDownloadUpdated(
	CefRefPtr<CefBrowser> ForBrowser,
	CefRefPtr<CefDownloadItem> DownloadItem,
	CefRefPtr<CefDownloadItemCallback> Callback)
{
	int Percentage = DownloadItem->GetPercentComplete();
	FString Url = FString(DownloadItem->GetFullPath().ToWString().c_str());
	
	UE_LOG(LogClass, Log, TEXT("Download %s Updated: %d"), *Url , Percentage);

	RenderHandlerRef->ParentUI->DownloadUpdated.Broadcast(Url, Percentage);

	if (Percentage == 100 && DownloadItem->IsComplete()) {
		UE_LOG(LogClass, Log, TEXT("Download %s Complete"), *Url);
		RenderHandlerRef->ParentUI->DownloadComplete.Broadcast(Url);
	}

	//Example download cancel/pause etc, we just have to hijack this
	//callback->Cancel();
}

// FicsitAI: сторож первой загрузки (см. RenderHandler.h).
namespace
{
	class FCheckPendingLoadTask : public CefTask
	{
	public:
		FCheckPendingLoadTask(CefRefPtr<BrowserClient> InClient, int InSerial) : Client(InClient), Serial(InSerial) {}
		virtual void Execute() override { Client->CheckPendingLoad(Serial); }
	private:
		CefRefPtr<BrowserClient> Client;
		int Serial;
		IMPLEMENT_REFCOUNTING(FCheckPendingLoadTask);
	};
}

void BrowserClient::WatchPendingLoad(CefRefPtr<CefFrame> Frame, const CefString& Url)
{
	if (!FicsitAIWeb::IsAllowedNavigation(Url) || Url == "about:blank")
	{
		return;
	}
	PendingFrame = Frame;
	PendingUrl = Url;
	bPendingCommitted = false;
	++PendingSerial;
	CefPostDelayedTask(TID_UI, new FCheckPendingLoadTask(this, PendingSerial), 3000);
}

void BrowserClient::CheckPendingLoad(int Serial)
{
	if (Serial != PendingSerial || bPendingCommitted || !PendingFrame || bIsClosing)
	{
		return;
	}
	if (LoadRetries >= 3)
	{
		UE_LOG(LogBlu, Error, TEXT("FicsitAI: page did not start loading after %d retries: %s"), LoadRetries, *FString(PendingUrl.ToWString().c_str()).Left(200));
		return;
	}
	++LoadRetries;
	UE_LOG(LogBlu, Warning, TEXT("FicsitAI: page load lost, retry %d: %s"), LoadRetries, *FString(PendingUrl.ToWString().c_str()).Left(200));
	PendingFrame->LoadURL(PendingUrl);
}

void BrowserClient::OnLoadStart(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame, cef_transition_type_t TransitionType)
{
	// Начальная about:blank заканчивает загрузку уже после того, как запрошена наша страница,
	// поэтому «началась» считается только загрузка адреса, который мы ждём.
	if (Frame->IsMain() && Frame->GetURL() == PendingUrl)
	{
		bPendingCommitted = true;
	}
}

void BrowserClient::OnLoadEnd(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame, int HttpStatusCode)
{
	if (Frame->IsMain())
	{
		LoadRetries = 0;
		UE_LOG(LogBlu, Log, TEXT("FicsitAI: page loaded, status %d: %s"), HttpStatusCode, *FString(Frame->GetURL().ToWString().c_str()).Left(200));
	}
}

void BrowserClient::OnLoadError(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame, cef_errorcode_t ErrorCode,
	const CefString& ErrorText, const CefString& FailedUrl)
{
	if (Frame->IsMain())
	{
		UE_LOG(LogBlu, Warning, TEXT("FicsitAI: page load error %d (%s): %s"), static_cast<int>(ErrorCode),
			*FString(ErrorText.ToWString().c_str()), *FString(FailedUrl.ToWString().c_str()).Left(200));
	}
}
