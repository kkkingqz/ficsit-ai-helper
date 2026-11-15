// FicsitAI: изоляция страниц. См. FicsitAIWebIsolation.h.
#include "FicsitAIWebIsolation.h"
#include "IBlu.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/ScopeLock.h"
#include "Misc/ScopeExit.h"
#include "HAL/PlatformFileManager.h"
#if PLATFORM_WINDOWS
#include "Windows/AllowWindowsPlatformTypes.h"
#include "Windows/WindowsHWrapper.h"
#include "Windows/HideWindowsPlatformTypes.h"
#else
#include <stdlib.h>
#endif
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
	FString GWebRootReal; // фактический путь корня после разрешения ссылок (Windows: GetFinalPathNameByHandle)

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

#if PLATFORM_WINDOWS
	/** Фактический путь открытого объекта: ссылки, junction и точки повторного разбора разрешены. */
	FString FinalPathOf(HANDLE Handle)
	{
		WCHAR Buffer[2048];
		const DWORD Len = GetFinalPathNameByHandleW(Handle, Buffer, UE_ARRAY_COUNT(Buffer), FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
		return (Len == 0 || Len >= UE_ARRAY_COUNT(Buffer)) ? FString() : FString(static_cast<int32>(Len), Buffer);
	}

	FString RealPathOfDirectory(const FString& Dir)
	{
		HANDLE Handle = CreateFileW(*Dir, 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
			FILE_FLAG_BACKUP_SEMANTICS, nullptr);
		if (Handle == INVALID_HANDLE_VALUE)
		{
			return FString();
		}
		const FString Real = FinalPathOf(Handle);
		CloseHandle(Handle);
		return Real;
	}
#else
	FString RealPathOfDirectory(const FString& Dir)
	{
		char* Real = realpath(TCHAR_TO_UTF8(*Dir), nullptr);
		const FString Out = Real ? FString(UTF8_TO_TCHAR(Real)) : FString();
		free(Real);
		return Out;
	}
#endif

	/**
	 * Чтение файла страницы с проверкой фактического пути (ревью #54, P1-1). Лексическая проверка в MapPath не видит
	 * ссылок: Web/a.txt может быть символической ссылкой, а каталог — junction за пределы Web. Поэтому:
	 * 1) ни один элемент пути ниже корня не может быть ссылкой или точкой повторного разбора — отказ;
	 * 2) файл открывается один раз, и уже у открытого дескриптора фактический путь сверяется с фактическим корнем,
	 *    а байты читаются из того же дескриптора — подмена между проверкой и чтением ничего не даёт.
	 * Возвращает 200, 403 (ссылка или выход за корень) или 404.
	 */
	int32 ReadInsideRoot(const FString& File, const FString& Root, const FString& RealRoot, TArray<uint8>& Out)
	{
		if (RealRoot.IsEmpty())
		{
			return 404;
		}
		TArray<FString> Segments;
		File.RightChop(Root.Len()).ParseIntoArray(Segments, TEXT("/"), true);
		if (Segments.Num() == 0)
		{
			return 404;
		}
#if PLATFORM_WINDOWS
		FString Walk = Root;
		for (int32 Index = 0; Index < Segments.Num(); ++Index)
		{
			Walk /= Segments[Index];
			const DWORD Attr = GetFileAttributesW(*Walk);
			if (Attr == INVALID_FILE_ATTRIBUTES)
			{
				return 404;
			}
			if (Attr & FILE_ATTRIBUTE_REPARSE_POINT)
			{
				UE_LOG(LogBlu, Warning, TEXT("FicsitAI: page path is a link, rejected: %s"), *Walk.RightChop(Root.Len()).Left(200));
				return 403;
			}
			const bool bLast = Index == Segments.Num() - 1;
			if (bLast == ((Attr & FILE_ATTRIBUTE_DIRECTORY) != 0))
			{
				return 404;
			}
		}
		// Сам последний элемент, без перехода по ссылке: у ссылки на файл атрибут точки повторного разбора есть только
		// у неё самой. На Windows это дублирует проверку выше, под Wine — единственный шанс увидеть ссылку на файл.
		{
			HANDLE Self = CreateFileW(*File, FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
				OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr);
			if (Self == INVALID_HANDLE_VALUE)
			{
				return 404;
			}
			FILE_ATTRIBUTE_TAG_INFO Tag = {};
			const bool bTag = GetFileInformationByHandleEx(Self, FileAttributeTagInfo, &Tag, sizeof(Tag)) != 0;
			CloseHandle(Self);
			if (bTag && (Tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT))
			{
				UE_LOG(LogBlu, Warning, TEXT("FicsitAI: page file is a link, rejected: %s"), *File.RightChop(Root.Len()).Left(200));
				return 403;
			}
		}
		HANDLE Handle = CreateFileW(*File, GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
		if (Handle == INVALID_HANDLE_VALUE)
		{
			return 404;
		}
		ON_SCOPE_EXIT { CloseHandle(Handle); };
		BY_HANDLE_FILE_INFORMATION Info;
		if (!GetFileInformationByHandle(Handle, &Info) || (Info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)))
		{
			return 404;
		}
		const FString Final = FinalPathOf(Handle);
		if (Final.IsEmpty() || !Final.StartsWith(RealRoot + TEXT("\\"), ESearchCase::IgnoreCase))
		{
			UE_LOG(LogBlu, Warning, TEXT("FicsitAI: page file resolves outside the page root, rejected: %s"), *File.RightChop(Root.Len()).Left(200));
			return 403;
		}
		LARGE_INTEGER Size;
		if (!GetFileSizeEx(Handle, &Size) || Size.QuadPart < 0 || Size.QuadPart > GMaxFileBytes)
		{
			return 404;
		}
		Out.SetNumUninitialized(static_cast<int32>(Size.QuadPart));
		int64 Done = 0;
		while (Done < Size.QuadPart)
		{
			DWORD Got = 0;
			if (!ReadFile(Handle, Out.GetData() + Done, static_cast<DWORD>(Size.QuadPart - Done), &Got, nullptr) || Got == 0)
			{
				return 404;
			}
			Done += Got;
		}
		return 200;
#else
		// Не Windows (только сборка редактора): фактический путь файла под фактическим корнем.
		const FString Real = RealPathOfDirectory(File);
		if (Real.IsEmpty())
		{
			return 404;
		}
		if (Real != File || !Real.StartsWith(RealRoot + TEXT("/"), ESearchCase::CaseSensitive))
		{
			return 403;
		}
		IPlatformFile& PlatformFile = FPlatformFileManager::Get().GetPlatformFile();
		const int64 Size = PlatformFile.FileSize(*File);
		if (Size < 0 || Size > GMaxFileBytes || !FFileHelper::LoadFileToArray(Out, *File, FILEREAD_Silent))
		{
			return 404;
		}
		return 200;
#endif
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
		const FString Real = RealPathOfDirectory(Normalized);
		FScopeLock Lock(&GWebRootLock);
		GWebRoot = Normalized;
		GWebRootReal = Real;
		UE_LOG(LogBlu, Log, TEXT("FicsitAI: pages are served from %s as %s/"), *GWebRoot, GOrigin);
		if (Real.IsEmpty())
		{
			UE_LOG(LogBlu, Error, TEXT("FicsitAI: page root does not resolve, every page request will fail: %s"), *GWebRoot);
		}
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
		const char* Mime = nullptr;
		CefRefPtr<FBytesHolder> Body = new FBytesHolder();
		const int32 Status = ReadPageFile(U.Path, Body->Data, &Mime);
		if (Status == 403)
		{
			UE_LOG(LogBlu, Warning, TEXT("FicsitAI: page request rejected: %s"), *U.Path.Left(200));
			return RespondError(403, "Forbidden");
		}
		if (Status != 200)
		{
			return RespondError(404, "Not Found");
		}
		if (Body->Data.Num() == 0)
		{
			Body->Data.Add('\n');
		}
		return Respond(200, "OK", Mime, Body, FCStringAnsi::Strcmp(Mime, "text/html") == 0);
	}

	int32 ReadPageFile(const FString& UrlPath, TArray<uint8>& OutBytes, const char** OutMime)
	{
		FString Root, RealRoot;
		{
			FScopeLock Lock(&GWebRootLock);
			Root = GWebRoot;
			RealRoot = GWebRootReal;
		}
		const FString File = MapPath(UrlPath, Root);
		const char* Mime = File.IsEmpty() ? nullptr : MimeFor(File);
		if (File.IsEmpty() || Mime == nullptr)
		{
			return 403;
		}
		if (OutMime)
		{
			*OutMime = Mime;
		}
		OutBytes.Reset();
		return ReadInsideRoot(File, Root, RealRoot, OutBytes);
	}
}
