#pragma once
// Канал мод ↔ адаптер сайдкара, протокол 1 (docs/interfaces/mod-adapter-channel.md, ARCHITECTURE §3.3).
//
// Транспорт — модуль HTTP игры (под Windows это libcurl): рукопожатие POST /mod/hello, долгий GET /mod/stream
// с NDJSON и пачки POST /mod/send. Строки потока читаются и разбираются на потоке HTTP; сообщения доходят до
// пользователя канала только на GameThread. Игровое состояние канал не трогает: вызов инструмента уходит
// обработчику, который подключает владелец (API мода), и ответ возвращается через FFicsitAIChannelResponder.
#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Containers/Queue.h"
#include "Containers/Ticker.h"
#include "HAL/ThreadSafeBool.h"
#include <atomic>
#include "Interfaces/IHttpRequest.h"
#include "Templates/SharedPointer.h"

class FFicsitAISidecarChannel;

/** Адрес адаптера и токен канала. Токен генерирует установщик (§4.1); в лог он не попадает. */
struct FICSITAICORE_API FFicsitAISidecarConfig
{
	FString BaseUrl;  // http://127.0.0.1:<порт>, без завершающей косой черты
	FString Token;
	bool IsValid() const { return IsLoopbackUrl(BaseUrl) && !Token.IsEmpty(); }

	/** Ровно http://127.0.0.1:<порт 1–65535>: без userinfo, пути, запроса и фрагмента. Токен уходит только на петлю. */
	static bool IsLoopbackUrl(const FString& Url);

	/** Saved/FicsitAI/adapter.json: { "url": "...", "token": "..." }. Нет файла или не петля — канал выключен. */
	static FFicsitAISidecarConfig LoadFromSaved(FString* OutWhy = nullptr);
};

/** Определение инструмента для рукопожатия — из реестра операций (§7.5, правило 2). */
struct FICSITAICORE_API FFicsitAIChannelTool
{
	FString Name;
	FString Description;
	TSharedPtr<FJsonObject> InputSchema;
};

enum class EFicsitAIChannelState : uint8
{
	Stopped,
	Connecting,    // рукопожатие
	Connected,     // сессия есть, поток открыт
	Reconnecting,  // поток оборвался, сессия жива
	Incompatible,  // адаптер отказал по версии; повтор раз в 60 с
	Unavailable,   // адаптер не отвечает; повтор с паузой
};

FICSITAICORE_API const TCHAR* LexToString(EFicsitAIChannelState State);

/** Ответ на вызов инструмента. Ровно один раз, с любого потока; повторный вызов отбрасывается. */
class FICSITAICORE_API FFicsitAIChannelResponder
{
public:
	void Ok(const TSharedPtr<FJsonValue>& Body) const;
	void Fail(const FString& Code, const FString& Message) const;

private:
	friend class FFicsitAISidecarChannel;
	TWeakPtr<FFicsitAISidecarChannel, ESPMode::ThreadSafe> Channel;
	FString CallId;
	FString Session;
	TSharedPtr<FThreadSafeBool, ESPMode::ThreadSafe> bDone;
};

struct FFicsitAIChannelStats
{
	int64 Hellos = 0, StreamsOpened = 0, StreamBreaks = 0;
	int64 LinesIn = 0, MessagesIn = 0, Duplicates = 0, Pings = 0, BytesIn = 0;
	int64 MessagesOut = 0, Posts = 0, PostFailures = 0, AckOnlyPosts = 0;
	int64 ToolCalls = 0, ToolResults = 0;
	int64 CallsRefused = 0;     // MOD_INERT, SAVE_MISMATCH: отказано до обработчика
	int64 TooLarge = 0;         // сообщение больше maxMessageBytes: номер не выдан, отправитель получил TOO_LARGE
	int64 SessionRestarts = 0;  // новое рукопожатие из-за отказа адаптера (410, 413, 400)
	double GameThreadSeconds = 0.0; // разбор очереди на GameThread
};

class FICSITAICORE_API FFicsitAISidecarChannel : public TSharedFromThis<FFicsitAISidecarChannel, ESPMode::ThreadSafe>
{
public:
	static constexpr int32 Protocol = 1;

	/** Вызов инструмента: имя, аргументы, ожидаемое сохранение (пусто — текущее), ответ. GameThread. */
	using FToolHandler = TFunction<void(const FString& Name, const TSharedRef<FJsonObject>& Args, const FString& SaveId, const FFicsitAIChannelResponder& Respond)>;
	/** Ответ на запрос мода: body или код ошибки (CHANNEL_RESET, если сессия сменилась). GameThread. */
	using FReplyHandler = TFunction<void(const TSharedPtr<FJsonValue>& Body, const FString& ErrorCode, const FString& ErrorMessage)>;

	static TSharedRef<FFicsitAISidecarChannel, ESPMode::ThreadSafe> Create(const FFicsitAISidecarConfig& Config, const FString& ApiVersion, const FString& ModVersion);
	~FFicsitAISidecarChannel();

	void SetTools(TArray<FFicsitAIChannelTool> InTools) { Tools = MoveTemp(InTools); }
	void SetToolHandler(FToolHandler InHandler) { ToolHandler = MoveTemp(InHandler); }

	void Start();
	void Stop();

	/** Текущее сохранение и инертный режим: в рукопожатии и сообщением mod.status при смене. */
	void SetModStatus(const FString& SaveId, bool bInert);

	/** Запрос с ответом (chat.send, chat.cancel, chat.history). Без сессии — сразу SIDECAR_UNAVAILABLE. */
	void Request(const FString& Type, const TSharedRef<FJsonObject>& Body, FReplyHandler OnReply);

	/** Сообщения адаптера без ответа: adapter.status, chat.*. GameThread. */
	TMulticastDelegate<void(const FString& Type, const TSharedPtr<FJsonObject>& Body)> OnMessage;
	/** Смена состояния связи. GameThread. */
	TMulticastDelegate<void(EFicsitAIChannelState State, const FString& Reason)> OnStateChanged;

	EFicsitAIChannelState GetState() const { return State; }
	bool IsConnected() const { return State == EFicsitAIChannelState::Connected; }
	const FString& GetAdapterApiVersion() const { return AdapterApiVersion; }
	const FFicsitAIChannelStats& GetStats() const { return Stats; }

private:
	struct FOutgoing { int64 Seq; TArray<uint8> Utf8; }; // конверт уже в UTF-8: его длина и есть размер по протоколу
	struct FIncoming { int64 Seq; FString Session; TSharedPtr<FJsonObject> Message; };
	struct FPendingRequest { FReplyHandler OnReply; };

	friend class FFicsitAIChannelResponder;
	FFicsitAISidecarChannel() = default;
	bool Tick(float DeltaTime);

	void SendHello();
	void OnHelloDone(FHttpRequestPtr Req, FHttpResponsePtr Resp, bool bOk, uint64 Generation);
	void OpenStream();
	void OnStreamDone(FHttpRequestPtr Req, FHttpResponsePtr Resp, bool bOk, uint64 StreamGeneration);
	void OnStreamBytes(const uint8* Data, int64 Length, uint64 StreamGeneration);
	void PumpIncoming();
	void HandleMessage(const TSharedPtr<FJsonObject>& Message);
	void MaybePost();
	void OnPostDone(FHttpRequestPtr Req, FHttpResponsePtr Resp, bool bOk, uint64 Generation, int64 SentAck);
	/** Номер выдаётся, только если конверт укладывается в maxMessageBytes; иначе false и номер не тратится. */
	bool Enqueue(const TSharedRef<FJsonObject>& Envelope, int64* OutBytes = nullptr);
	void SendToolResult(const FString& Session, const FString& CallId, const TSharedPtr<FJsonValue>& Body, const FString* Code, const FString* Message);
	void ResetSession(const FString& Why);
	/** Сессию не восстановить на месте: ждущие получают CHANNEL_RESET, дальше новое рукопожатие. */
	void RestartSession(const FString& Why);
	/** Смена поколения потока — под StreamLock, вместе с буфером, входящим seq и StreamSession. */
	void BumpStreamGenerationLocked();
	void SetState(EFicsitAIChannelState NewState, const FString& Reason);
	void ScheduleRetry(double Delay);
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> MakeRequest(const FString& Verb, const FString& Path) const;

	FFicsitAISidecarConfig Config;
	FString ApiVersion, ModVersion;
	TArray<FFicsitAIChannelTool> Tools;
	FToolHandler ToolHandler;
	FTSTicker::FDelegateHandle TickHandle;

	EFicsitAIChannelState State = EFicsitAIChannelState::Stopped;
	FString Session;              // GameThread
	FString AdapterApiVersion;
	uint64 Generation = 0;        // растёт на каждом рукопожатии и на Stop(): ответы прежних сессий отбрасываются
	TSharedPtr<IHttpRequest, ESPMode::ThreadSafe> HelloRequest, PostRequest; // в полёте; Stop() их отменяет
	double RetryAt = 0.0;
	int32 Failures = 0;

	// Пределы из рукопожатия.
	int32 PingSec = 15, MaxBatch = 64, BufferMessages = 1024, MaxMessageBytes = 1 << 20;

	// Поток: HTTP-поток пишет, GameThread читает.
	TSharedPtr<IHttpRequest, ESPMode::ThreadSafe> StreamRequest;
	uint64 StreamGeneration = 0;
	FCriticalSection StreamLock;
	TArray<uint8> LineBuffer;           // под StreamLock
	int64 LastSeqIn = 0;                // под StreamLock: последний принятый подряд
	FString StreamSession;              // под StreamLock
	std::atomic<double> LastLineAt { 0.0 };
	std::atomic<bool> bStreamHasMessages { false };
	std::atomic<bool> bStreamBroken { false };
	std::atomic<uint64> StreamGenerationAtomic { 0 };
	TQueue<FIncoming, EQueueMode::Mpsc> Incoming;
	int64 AckedIn = 0;                  // GameThread: последний подтверждённый адаптеру
	double LastAckAt = 0.0;

	// Мод → адаптер.
	TArray<FOutgoing> Outgoing;         // GameThread: неподтверждённые, по возрастанию seq
	int64 NextSeqOut = 1;
	bool bPostInFlight = false;
	double PostRetryAt = 0.0;
	bool bHelloInFlight = false;
	int64 NextRequestId = 1;
	TMap<FString, FPendingRequest> Pending;

	FString SaveId;
	bool bInert = false;
	FFicsitAIChannelStats Stats;
};
