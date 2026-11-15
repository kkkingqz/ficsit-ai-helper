#pragma once
// FicsitAI: мост страница ↔ мод (ARCHITECTURE §6.3.1, ADR-032; чек-лист S8, блок 4).
//
// Один канал: страница вызывает blu_event("ficsitai.bridge", JSON) с конвертом { id, op, args }.
// Мод отвечает выполнением JavaScript: window.__ficsitaiBridge.receive({ re, body } | { re, error }).
// События мода идут тем же путём: { event, data }.
// Мост — только транспорт: формы запросов и ответов задаёт API v0 (docs/interfaces/public-api-v0.md),
// их разбирает обработчик, который подключает основной мод. Плагин про API не знает.
#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "HAL/ThreadSafeBool.h"

class UBluEye;
class FFicsitAIWebBridge;

struct FFicsitAIBridgeStats
{
	int64 Requests = 0;   // принятые конверты
	int64 Replies = 0;    // ответы с body
	int64 Errors = 0;     // ответы с error
	int64 Malformed = 0;  // отброшены без ответа: не JSON, нет id, больше предела
	int64 Events = 0;     // события мода странице
	int64 Duplicates = 0; // повторный вызов ответа — отброшен
	double HandleSeconds = 0.0; // синхронное время обработчика на GameThread
};

/** Ответ на один запрос страницы. Вызывается ровно один раз, с любого потока; повторный вызов отбрасывается. */
class BLU_API FFicsitAIBridgeResponder
{
public:
	void Ok(const TSharedPtr<FJsonValue>& Body) const;
	void Fail(const FString& Code, const FString& Message) const;

private:
	friend class FFicsitAIWebBridge;
	TWeakPtr<FFicsitAIWebBridge, ESPMode::ThreadSafe> Bridge;
	TSharedPtr<FJsonValue> Id;
	TSharedPtr<FThreadSafeBool, ESPMode::ThreadSafe> bDone;
	void Finish(const TSharedPtr<FJsonValue>& Body, const FString* Code, const FString* Message) const;
};

class BLU_API FFicsitAIWebBridge : public TSharedFromThis<FFicsitAIWebBridge, ESPMode::ThreadSafe>
{
public:
	/** Имя события blu_event, по которому идёт мост. Остальные события страницы мост не трогает. */
	static const TCHAR* Channel();
	/** Предел конверта от страницы. Больше — отбрасывается без ответа; фасад проверяет его до отправки. */
	static constexpr int32 MaxRequestBytes = 64 * 1024;

	/** Обработчик запроса. Вызывается на GameThread; ответить можно сразу или позже, с любого потока. */
	using FHandler = TFunction<void(const FString& Op, const TSharedRef<FJsonObject>& Args, const FFicsitAIBridgeResponder& Respond)>;

	static TSharedRef<FFicsitAIWebBridge, ESPMode::ThreadSafe> Attach(UBluEye* Eye, FHandler Handler);
	~FFicsitAIWebBridge();

	/** Отписаться от браузера. Ответы на уже принятые запросы после этого отбрасываются. */
	void Detach();

	/** Событие мода странице: { event, data }. Только GameThread. */
	void PushEvent(const FString& Name, const TSharedPtr<FJsonObject>& Data);

	FFicsitAIBridgeStats Stats;

	/** JSON как литерал JavaScript: U+2028 и U+2029 экранируются, остальное JSON уже гарантирует. */
	static FString ToJsLiteral(const TSharedRef<FJsonObject>& Object);

private:
	friend class FFicsitAIBridgeResponder;
	void OnScriptEvent(const FString& Name, const FString& Data);
	void Send(const TSharedRef<FJsonObject>& Envelope);
	void Deliver(const TSharedPtr<FJsonValue>& Id, const TSharedPtr<FJsonValue>& Body, const FString* Code, const FString* Message);

	TWeakObjectPtr<UBluEye> Eye;
	FHandler Handler;
	FDelegateHandle Subscription;
};
