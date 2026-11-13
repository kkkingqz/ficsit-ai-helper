#include "BluManager.h"

BluManager::BluManager()
{
}

void BluManager::OnBeforeCommandLineProcessing(const CefString& process_type,
	CefRefPtr< CefCommandLine > CommandLine)
{

	/////////////////
	/**
	* Used to pick command line switches
	* If set to "true": CEF will use less CPU, but rendering performance will be lower. CSS3 and WebGL are not be usable
	* If set to "false": CEF will use more CPU, but rendering will be better, CSS3 and WebGL will also be usable
	*/
	// FicsitAI: только программный рендер (§6.3.1 условие 5, §12 п. 11).
	BluManager::CPURenderSettings = true;
	/////////////////

	CommandLine->AppendSwitch("off-screen-rendering-enabled");
	CommandLine->AppendSwitchWithValue("off-screen-frame-rate", "60");
	CommandLine->AppendSwitch("enable-font-antialiasing");
	// FicsitAI: enable-media-stream убран — доступ к камере и микрофону без запроса.

	// Should we use the render settings that use less CPU?
	if (CPURenderSettings)
	{
		CommandLine->AppendSwitch("disable-gpu");
		CommandLine->AppendSwitch("disable-gpu-compositing");
		CommandLine->AppendSwitch("enable-begin-frame-scheduling");
	}
	else
	{
		// Enables things like CSS3 and WebGL
		CommandLine->AppendSwitch("enable-gpu-rasterization");
		CommandLine->AppendSwitch("enable-webgl");
		// FicsitAI: disable-web-security убран — политика источников остаётся включённой.
	}

	CommandLine->AppendSwitchWithValue("enable-blink-features", "HTMLImports");

	// FicsitAI: фоновые обращения Chromium в сеть выключены (§12 п. 11; замер 11.11.2026: без этих ключей CEF сам
	// обращается к accounts.google.com и optimizationguide-pa.googleapis.com и ищет прокси по WPAD).
	// Последний ключ — рубеж: ни одно имя не разрешается. Канал мода к адаптеру идёт через модуль HTTP игры, не через CEF.
	CommandLine->AppendSwitch("no-proxy-server");
	CommandLine->AppendSwitch("disable-background-networking");
	CommandLine->AppendSwitch("disable-component-update");
	CommandLine->AppendSwitch("disable-sync");
	CommandLine->AppendSwitch("disable-domain-reliability");
	CommandLine->AppendSwitch("disable-client-side-phishing-detection");
	CommandLine->AppendSwitch("no-first-run");
	CommandLine->AppendSwitch("no-default-browser-check");
	CommandLine->AppendSwitch("no-pings");
	CommandLine->AppendSwitch("disable-default-apps");
	CommandLine->AppendSwitchWithValue("disable-features", "OptimizationHints,OptimizationGuideModelDownloading,OptimizationHintsFetching,OptimizationTargetPrediction,MediaRouter,Translate,AutofillServerCommunication");
	CommandLine->AppendSwitchWithValue("host-resolver-rules", "MAP * ~NOTFOUND");

	if (AutoPlay)
	{
		CommandLine->AppendSwitchWithValue("autoplay-policy", "no-user-gesture-required");
	}
	
	// Append more command line options here if you want
	// Visit Peter Beverloo's site: http://peter.sh/experiments/chromium-command-line-switches/ for more info on the switches

}

void BluManager::DoBluMessageLoop()
{
	CefDoMessageLoopWork();
}

CefSettings BluManager::Settings;
CefMainArgs BluManager::MainArgs;
bool BluManager::CPURenderSettings = false;
bool BluManager::AutoPlay = false; // FicsitAI: медиа на наших страницах нет