// FicsitAI: изоляция страниц. См. FicsitAIWebIsolation.h.
#include "FicsitAIWebIsolation.h"
#include "IBlu.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/ScopeLock.h"
#include "HAL/PlatformFileManager.h"
THIRD_PARTY_INCLUDES_START
#include "include/cef_parser.h"
#include "include/wrapper/cef_byte_read_handler.h"
#include "include/wrapper/cef_stream_resource_handler.h"
THIRD_PARTY_INCLUDES_END

namespace
{
	const TCHAR* GOrigin = TEXT("https://ficsitai.invalid");
	const int64 GMaxFileBytes = 16 * 1024 * 1024;

	FCriticalSection GWebRootLock;
	FString GWebRoot;

	/** Держит байты файла, пока CEF читает ответ. */
	class FBytesHolder : public CefBaseRefCounted
	{
	public:
		TArray<uint8> Data;
		IMPLEMENT_REFCOUNTING(FBytesHolder);
	};

	struct FParsedUrl
	{
		FString Scheme;
		FString Host;
		FString Port;
		FString Path;
		bool bValid = false;
	};

	FParsedUrl Parse(const CefString& Url)
	{
		FParsedUrl Out;
		CefURLParts Parts;
		if (!CefParseURL(Url, Parts))
		{
			return Out;
		}
		Out.Scheme = FString(CefString(&Parts.scheme).ToWString().c_str()).ToLower();
		Out.Host = FString(CefString(&Parts.host).ToWString().c_str()).ToLower();
		Out.Port = FString(CefString(&Parts.port).ToWString().c_str());
		Out.Path = FString(CefString(&Parts.path).ToWString().c_str());
		Out.bValid = true;
		return Out;
	}

	bool IsOurOrigin(const FParsedUrl& U)
	{
		return U.bValid && U.Scheme == TEXT("https") && U.Host == TEXT("ficsitai.invalid") && (U.Port.IsEmpty() || U.Port == TEXT("443"));
	}

	/**
	 * Путь к файлу внутри каталога страниц или пустая строка.
	 * Белый список символов вместо раскодирования: в именах наших файлов нет ни процентов, ни пробелов, ни обратных
	 * косых черт, поэтому всё, что их содержит, отклоняется, а не разбирается.
	 */
	FString MapPath(const FString& UrlPath, const FString& Root)
	{
		if (Root.IsEmpty() || !UrlPath.StartsWith(TEXT("/")) || UrlPath.Len() > 512)
		{
			return FString();
		}
		for (const TCHAR C : UrlPath)
		{
			const bool bOk = (C >= 'a' && C <= 'z') || (C >= 'A' && C <= 'Z') || (C >= '0' && C <= '9')
				|| C == '/' || C == '.' || C == '-' || C == '_';
			if (!bOk)
			{
				return FString();
			}
		}
		TArray<FString> Segments;
		UrlPath.ParseIntoArray(Segments, TEXT("/"), false);
		// Первый элемент пуст (путь начинается с '/'); пустых и начинающихся с точки сегментов дальше быть не должно.
		for (int32 Index = 1; Index < Segments.Num(); ++Index)
		{
			const FString& Segment = Segments[Index];
			if (Segment.IsEmpty() || Segment.StartsWith(TEXT(".")))
			{
				return FString();
			}
		}
		if (Segments.Num() < 2)
		{
			return FString();
		}
		FString Full = FPaths::ConvertRelativePathToFull(Root / UrlPath.RightChop(1));
		FPaths::CollapseRelativeDirectories(Full);
		const FString RootWithSlash = Root.EndsWith(TEXT("/")) ? Root : Root + TEXT("/");
		return Full.StartsWith(RootWithSlash, ESearchCase::CaseSensitive) ? Full : FString();
	}

	const char* MimeFor(const FString& Path)
	{
		const FString Ext = FPaths::GetExtension(Path).ToLower();
		if (Ext == TEXT("html")) return "text/html";
		if (Ext == TEXT("js")) return "text/javascript";
		if (Ext == TEXT("css")) return "text/css";
		if (Ext == TEXT("json") || Ext == TEXT("map")) return "application/json";
		if (Ext == TEXT("svg")) return "image/svg+xml";
		if (Ext == TEXT("png")) return "image/png";
		if (Ext == TEXT("jpg") || Ext == TEXT("jpeg")) return "image/jpeg";
		if (Ext == TEXT("webp")) return "image/webp";
		if (Ext == TEXT("ico")) return "image/x-icon";
		if (Ext == TEXT("woff2")) return "font/woff2";
		if (Ext == TEXT("txt")) return "text/plain";
		return nullptr;
	}

	CefRefPtr<CefResourceHandler> Respond(int Status, const char* StatusText, const char* Mime, CefRefPtr<FBytesHolder> Body, bool bHtml)
	{
		CefResponse::HeaderMap Headers;
		Headers.insert(std::make_pair("Cache-Control", "no-store"));
		Headers.insert(std::make_pair("X-Content-Type-Options", "nosniff"));
		Headers.insert(std::make_pair("Referrer-Policy", "no-referrer"));
		if (bHtml)
		{
			// Заголовок сильнее meta на странице: страница может политику только ужесточить.
			// connect-src 'self' закрывает fetch, XHR и WebSocket к любому другому адресу, включая 127.0.0.1.
			Headers.insert(std::make_pair("Content-Security-Policy",
				"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; "
				"connect-src 'self'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; "
				"form-action 'none'; frame-ancestors 'none'"));
		}
		CefRefPtr<CefStreamReader> Stream = CefStreamReader::CreateForHandler(
			new CefByteReadHandler(Body->Data.GetData(), static_cast<size_t>(Body->Data.Num()), Body));
		return new CefStreamResourceHandler(Status, StatusText, Mime, Headers, Stream);
	}

	CefRefPtr<CefResourceHandler> RespondError(int Status, const char* StatusText)
	{
		CefRefPtr<FBytesHolder> Body = new FBytesHolder();
		Body->Data.Add('\n');
		return Respond(Status, StatusText, "text/plain", Body, false);
	}
}

namespace FicsitAIWeb
{
	void SetWebRoot(const FString& AbsoluteDir)
	{
		FString Normalized = FPaths::ConvertRelativePathToFull(AbsoluteDir);
		FPaths::NormalizeDirectoryName(Normalized);
		FScopeLock Lock(&GWebRootLock);
		GWebRoot = Normalized;
		UE_LOG(LogBlu, Log, TEXT("FicsitAI: pages are served from %s as %s/"), *GWebRoot, GOrigin);
	}

	FString GetWebRoot()
	{
		FScopeLock Lock(&GWebRootLock);
		return GWebRoot;
	}

	const TCHAR* Origin()
	{
		return GOrigin;
	}

	bool IsAllowedNavigation(const CefString& Url)
	{
		const FString Raw(Url.ToWString().c_str());
		if (Raw == TEXT("about:blank"))
		{
			return true;
		}
		return IsOurOrigin(Parse(Url));
	}

	bool IsAllowedResource(const CefString& Url)
	{
		const FParsedUrl U = Parse(Url);
		if (!U.bValid)
		{
			return false;
		}
		return IsOurOrigin(U) || U.Scheme == TEXT("data") || U.Scheme == TEXT("blob") || U.Scheme == TEXT("about");
	}

	bool IsNetworkScheme(const CefString& Url)
	{
		const FParsedUrl U = Parse(Url);
		if (!U.bValid)
		{
			return true;
		}
		return !(U.Scheme == TEXT("data") || U.Scheme == TEXT("blob") || U.Scheme == TEXT("about"));
	}

	CefRefPtr<CefResourceHandler> MakeResourceHandler(CefRefPtr<CefRequest> Request)
	{
		const CefString Url = Request->GetURL();
		const FParsedUrl U = Parse(Url);
		if (!IsOurOrigin(U))
		{
			return nullptr;
		}
		const FString Method(Request->GetMethod().ToWString().c_str());
		if (Method != TEXT("GET") && Method != TEXT("HEAD"))
		{
			return RespondError(405, "Method Not Allowed");
		}
		const FString Root = GetWebRoot();
		const FString File = MapPath(U.Path, Root);
		const char* Mime = File.IsEmpty() ? nullptr : MimeFor(File);
		if (File.IsEmpty() || Mime == nullptr)
		{
			UE_LOG(LogBlu, Warning, TEXT("FicsitAI: page request rejected: %s"), *U.Path.Left(200));
			return RespondError(403, "Forbidden");
		}
		IPlatformFile& PlatformFile = FPlatformFileManager::Get().GetPlatformFile();
		const int64 Size = PlatformFile.FileSize(*File);
		CefRefPtr<FBytesHolder> Body = new FBytesHolder();
		if (Size < 0 || Size > GMaxFileBytes || !FFileHelper::LoadFileToArray(Body->Data, *File, FILEREAD_Silent))
		{
			return RespondError(404, "Not Found");
		}
		if (Body->Data.Num() == 0)
		{
			Body->Data.Add('\n');
		}
		return Respond(200, "OK", Mime, Body, FCStringAnsi::Strcmp(Mime, "text/html") == 0);
	}
}
