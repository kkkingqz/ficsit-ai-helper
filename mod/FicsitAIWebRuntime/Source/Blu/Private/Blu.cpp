#include "IBlu.h"
#include "Interfaces/IPluginManager.h"
#include "BluManager.h"
#include "FicsitAIWebIsolation.h"

#if PLATFORM_WINDOWS && IS_MONOLITHIC
#include "Windows/AllowWindowsPlatformTypes.h"
#include <delayimp.h>
#include "Windows/HideWindowsPlatformTypes.h"

/**
 * In a monolithic exe that also links the engine's CEF3 (WebBrowser module), both CEF SDKs are statically linked into one
 * binary and their symbols collide, so the linker may bind BLUI's CEF calls to the engine's "libcef.dll" import instead of
 * "blucef.dll". If that DLL can't be loaded when BLUI initializes, hand back our already loaded runtime instead of crashing.
 * The engine WebBrowser then reports a CEF version mismatch and stays disabled (same behavior as BLUI <= 5.0.0).
 */
static FARPROC WINAPI BluDelayLoadFailureHook(unsigned Notify, PDelayLoadInfo Info)
{
	if (Notify == dliFailLoadLib && Info && Info->szDll && _stricmp(Info->szDll, "libcef.dll") == 0)
	{
		if (HMODULE BluCef = GetModuleHandleW(L"blucef.dll"))
		{
			UE_LOG(LogBlu, Warning, TEXT("Engine CEF3 is linked into this monolithic build, sharing BLUI's CEF runtime with it. The engine WebBrowser will be disabled."));
			return (FARPROC)BluCef;
		}
	}
	return nullptr;
}

extern "C" const PfnDliHook __pfnDliFailureHook2 = BluDelayLoadFailureHook;
#endif

class FBlu : public IBlu
{

	/** IModuleInterface implementation */
	virtual void StartupModule() override
	{
		// FicsitAI: ничего не пишем в каталог игры; кэш в памяти, служебный корень и лог CEF — в Saved пользователя.
		const FString FicsitCefRoot = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("FicsitAI/Cef"));
		FString ExecutablePath = FPaths::ConvertRelativePathToFull(IPluginManager::Get().FindPlugin(TEXT("FicsitAIWebRuntime"))->GetBaseDir() + "/ThirdParty/cef/");

		// Setup the default settings for BluManager
		BluManager::Settings.windowless_rendering_enabled = true;
		BluManager::Settings.no_sandbox = true;
		// FicsitAI: порт DevTools — входящий слушатель в процессе игры (§12 п. 1, п. 11). Выключен.
		BluManager::Settings.remote_debugging_port = 0;
		BluManager::Settings.log_severity = LOGSEVERITY_WARNING;
		const CefString FicsitCefLog = *(FicsitCefRoot / TEXT("cef.log"));
		CefString(&BluManager::Settings.log_file).FromString(FicsitCefLog);
		BluManager::Settings.uncaught_exception_stack_size = 5;

	#if PLATFORM_LINUX
		ExecutablePath = "./blu_ue4_process";
	#endif
	#if PLATFORM_MAC
		ExecutablePath += "Mac/shipping/blu_ue4_process.app/Contents/MacOS/blu_ue4_process";
	#endif
	#if PLATFORM_WINDOWS
		ExecutablePath += "Win/shipping/BluBrowserProcess.exe";
	#endif

		CefString realExePath = *ExecutablePath;

		// Set the sub-process path
		CefString(&BluManager::Settings.browser_subprocess_path).FromString(realExePath);

		// FicsitAI: cache_path пуст — профиль в памяти; root_cache_path обязателен для CEF и лежит в Saved.
		const CefString FicsitCefRootPath = *FicsitCefRoot;
		CefString(&BluManager::Settings.root_cache_path).FromString(FicsitCefRootPath);

		// FicsitAI: страницы раздаются только из каталога Web плагина (пока идёт спайк; основной мод задаст свой).
		FicsitAIWeb::SetWebRoot(IPluginManager::Get().FindPlugin(TEXT("FicsitAIWebRuntime"))->GetBaseDir() / TEXT("Web"));

		// Make a new manager instance
		CefRefPtr<BluManager> BluApp = new BluManager();

		//CefExecuteProcess(BluManager::main_args, BluApp, NULL);
		if (!CefInitialize(BluManager::MainArgs, BluManager::Settings, BluApp, NULL))
		{
			UE_LOG(LogBlu, Error, TEXT(" STATUS: CefInitialize failed (exit code %d), BLUI browsers will not be created"), CefGetExitCode());
			return;
		}

		UE_LOG(LogBlu, Log, TEXT(" STATUS: Loaded CEF %d.%d.%d (chromium %d.%d.%d.%d)"),
			cef_version_info(0), cef_version_info(1), cef_version_info(2),
			cef_version_info(4), cef_version_info(5), cef_version_info(6), cef_version_info(7));
	}

	virtual void ShutdownModule() override
	{
		UE_LOG(LogBlu, Log, TEXT(" STATUS: Shutdown"));
		//CefShutdown();
	}

};


IMPLEMENT_MODULE( FBlu, Blu )
DEFINE_LOG_CATEGORY(LogBlu);