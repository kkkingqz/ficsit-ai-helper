#pragma once
// FicsitAI: изоляция страниц (ARCHITECTURE §6.3.1, §12 п. 11; чек-лист S8, блок 2).
// Страницы живут на несуществующем источнике https://ficsitai.invalid/ и читаются только из одного каталога.
// Всё остальное — другие хосты, file://, blui://, devtools://, всплывающие окна — отклоняется здесь.
#include "CEFInclude.h"
#include "IBlu.h"
#include <string>

namespace FicsitAIWeb
{
	/** Каталог, из которого раздаются страницы. Задаётся на GameThread до создания первого браузера. */
	BLU_API void SetWebRoot(const FString& AbsoluteDir);
	BLU_API FString GetWebRoot();

	/** Адрес источника страниц без завершающей косой черты. */
	BLU_API const TCHAR* Origin();

	/** Переход фрейма: только наш источник и about:blank. */
	bool IsAllowedNavigation(const CefString& Url);

	/** Запрос ресурса: наш источник, data: и blob: (их создаёт сама страница). */
	bool IsAllowedResource(const CefString& Url);

	/** true — запрос должен обслужить наш обработчик или он будет отменён; в сеть он не уходит. */
	bool IsNetworkScheme(const CefString& Url);

	/** Ответ на запрос к нашему источнику: файл из каталога страниц либо 404/403/405. Вызывается на потоке IO. */
	CefRefPtr<CefResourceHandler> MakeResourceHandler(CefRefPtr<CefRequest> Request);

	/**
	 * Байты файла страницы по пути адреса (/spikes/s8/bridge.html). 200, 403 — путь вне белого списка, ссылка или
	 * фактический путь вне каталога страниц, 404 — нет файла или он больше 16 МиБ. Любой поток.
	 */
	BLU_API int32 ReadPageFile(const FString& UrlPath, TArray<uint8>& OutBytes, const char** OutMime = nullptr);
}
