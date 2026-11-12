#include "Sidecar/FicsitAISidecarChannel.h"
#include "Async/Async.h"
#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

DEFINE_LOG_CATEGORY_STATIC(LogFicsitAIChannel, Log, All);

namespace
{
	FString ToJson(const TSharedRef<FJsonObject>& Object)
	{
		FString Out;
		const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Out);
		FJsonSerializer::Serialize(Object, Writer);
		return Out;
	}

	TSharedPtr<FJsonObject> ParseObject(const FString& Text)
	{
		TSharedPtr<FJsonObject> Object;
		FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Object);
		return Object;
	}

	/** Пауза перед повтором: 0,5 → 1 → 2 → 4 → 10 с со случайным разбросом ±20 % (протокол, «Связь в моде»). */
	double Backoff(int32 Failures)
	{
		static const double Steps[] = { 0.5, 1.0, 2.0, 4.0, 10.0 };
		const double Base = Steps[FMath::Clamp(Failures - 1, 0, 4)];
		return Base * FMath::FRandRange(0.8, 1.2);
	}

	FString CodeOf(const FHttpResponsePtr& Resp)
	{
		if (!Resp.IsValid()) { return FString(); }
		const TSharedPtr<FJsonObject> Body = ParseObject(Resp->GetContentAsString());
		FString Code;
		if (Body.IsValid()) { Body->TryGetStringField(TEXT("code"), Code); }
		return Code;
	}
}

const TCHAR* LexToString(EFicsitAIChannelState State)
{
	switch (State)
	{
	case EFicsitAIChannelState::Stopped: return TEXT("stopped");
	case EFicsitAIChannelState::Connecting: return TEXT("connecting");
	case EFicsitAIChannelState::Connected: return TEXT("connected");
	case EFicsitAIChannelState::Reconnecting: return TEXT("reconnecting");
	case EFicsitAIChannelState::Incompatible: return TEXT("incompatible");
	case EFicsitAIChannelState::Unavailable: return TEXT("unavailable");
	}
	return TEXT("?");
}

FFicsitAISidecarConfig FFicsitAISidecarConfig::LoadFromSaved(FString* OutWhy)
{
	FFicsitAISidecarConfig Config;
	const FString Path = FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("FicsitAI"), TEXT("adapter.json"));
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *Path))
	{
		if (OutWhy) { *OutWhy = TEXT("no Saved/FicsitAI/adapter.json"); }
		return Config;
	}
	const TSharedPtr<FJsonObject> Object = ParseObject(Text);
	if (Object.IsValid())
	{
		Object->TryGetStringField(TEXT("url"), Config.BaseUrl);
		Object->TryGetStringField(TEXT("token"), Config.Token);
	}
	Config.BaseUrl.RemoveFromEnd(TEXT("/"));
	if (!Config.IsValid() && OutWhy) { *OutWhy = TEXT("adapter.json: url must be http://127.0.0.1:<port>, token must be set"); }
	return Config;
}

// --- ответ на вызов инструмента -------------------------------------------------------------------------

void FFicsitAIChannelResponder::Ok(const TSharedPtr<FJsonValue>& Body) const
{
	if (!bDone.IsValid() || bDone->AtomicSet(true)) { return; }
	TWeakPtr<FFicsitAISidecarChannel, ESPMode::ThreadSafe> Weak = Channel;
	const FString S = Session, Id = CallId;
	const TSharedPtr<FJsonValue> B = Body.IsValid() ? Body : MakeShared<FJsonValueNull>();
	auto Deliver = [Weak, S, Id, B]() { if (auto C = Weak.Pin()) { C->SendToolResult(S, Id, B, nullptr, nullptr); } };
	IsInGameThread() ? Deliver() : AsyncTask(ENamedThreads::GameThread, MoveTemp(Deliver));
}

void FFicsitAIChannelResponder::Fail(const FString& Code, const FString& Message) const
{
	if (!bDone.IsValid() || bDone->AtomicSet(true)) { return; }
	TWeakPtr<FFicsitAISidecarChannel, ESPMode::ThreadSafe> Weak = Channel;
	const FString S = Session, Id = CallId, C0 = Code, M0 = Message;
	auto Deliver = [Weak, S, Id, C0, M0]() { if (auto C = Weak.Pin()) { C->SendToolResult(S, Id, nullptr, &C0, &M0); } };
	IsInGameThread() ? Deliver() : AsyncTask(ENamedThreads::GameThread, MoveTemp(Deliver));
}

// --- жизненный цикл ---------------------------------------------------------------------------------------

TSharedRef<FFicsitAISidecarChannel, ESPMode::ThreadSafe> FFicsitAISidecarChannel::Create(const FFicsitAISidecarConfig& InConfig, const FString& InApiVersion, const FString& InModVersion)
{
	TSharedRef<FFicsitAISidecarChannel, ESPMode::ThreadSafe> Channel = MakeShareable(new FFicsitAISidecarChannel());
	Channel->Config = InConfig;
	Channel->ApiVersion = InApiVersion;
	Channel->ModVersion = InModVersion;
	return Channel;
}

FFicsitAISidecarChannel::~FFicsitAISidecarChannel()
{
	if (TickHandle.IsValid()) { FTSTicker::GetCoreTicker().RemoveTicker(TickHandle); }
	if (StreamRequest.IsValid()) { StreamRequest->OnProcessRequestComplete().Unbind(); StreamRequest->CancelRequest(); }
}

void FFicsitAISidecarChannel::Start()
{
	check(IsInGameThread());
	if (State != EFicsitAIChannelState::Stopped) { return; }
	TWeakPtr<FFicsitAISidecarChannel, ESPMode::ThreadSafe> Weak = AsShared();
	TickHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Weak](float Dt)
	{
		TSharedPtr<FFicsitAISidecarChannel, ESPMode::ThreadSafe> C = Weak.Pin();
		return C.IsValid() && C->Tick(Dt);
	}), 0.0f);
	SetState(EFicsitAIChannelState::Connecting, TEXT("start"));
	SendHello();
}

void FFicsitAISidecarChannel::Stop()
{
	check(IsInGameThread());
	if (TickHandle.IsValid()) { FTSTicker::GetCoreTicker().RemoveTicker(TickHandle); TickHandle.Reset(); }
	ResetSession(TEXT("stopped"));
	Session.Empty();
	SetState(EFicsitAIChannelState::Stopped, TEXT("stop"));
}

void FFicsitAISidecarChannel::SetState(EFicsitAIChannelState NewState, const FString& Reason)
{
	if (State == NewState) { return; }
	UE_LOG(LogFicsitAIChannel, Display, TEXT("FicsitAI channel: %s -> %s (%s)"), LexToString(State), LexToString(NewState), *Reason);
	State = NewState;
	OnStateChanged.Broadcast(NewState, Reason);
}

void FFicsitAISidecarChannel::ScheduleRetry(double Delay)
{
	RetryAt = FPlatformTime::Seconds() + Delay;
}

TSharedRef<IHttpRequest, ESPMode::ThreadSafe> FFicsitAISidecarChannel::MakeRequest(const FString& Verb, const FString& Path) const
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = FHttpModule::Get().CreateRequest();
	Req->SetVerb(Verb);
	Req->SetURL(Config.BaseUrl + Path);
	Req->SetHeader(TEXT("Authorization"), TEXT("Bearer ") + Config.Token);
	if (Verb == TEXT("POST")) { Req->SetHeader(TEXT("Content-Type"), TEXT("application/json")); }
	return Req;
}

// --- рукопожатие ------------------------------------------------------------------------------------------

void FFicsitAISidecarChannel::SendHello()
{
	if (bHelloInFlight) { return; }
	bHelloInFlight = true;
	++Stats.Hellos;
	const uint64 Gen = ++Generation;

	const TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetNumberField(TEXT("protocol"), Protocol);
	Body->SetStringField(TEXT("apiVersion"), ApiVersion);
	Body->SetStringField(TEXT("modVersion"), ModVersion);
	Body->SetStringField(TEXT("saveId"), SaveId);
	Body->SetBoolField(TEXT("inert"), bInert);
	TArray<TSharedPtr<FJsonValue>> ToolArray;
	for (const FFicsitAIChannelTool& T : Tools)
	{
		const TSharedRef<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("name"), T.Name);
		O->SetStringField(TEXT("description"), T.Description);
		O->SetObjectField(TEXT("inputSchema"), T.InputSchema.IsValid() ? T.InputSchema : MakeShared<FJsonObject>());
		ToolArray.Add(MakeShared<FJsonValueObject>(O));
	}
	Body->SetArrayField(TEXT("tools"), ToolArray);

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = MakeRequest(TEXT("POST"), TEXT("/mod/hello"));
	Req->SetContentAsString(ToJson(Body));
	Req->SetTimeout(10.f);
	TWeakPtr<FFicsitAISidecarChannel, ESPMode::ThreadSafe> Weak = AsShared();
	Req->OnProcessRequestComplete().BindLambda([Weak, Gen](FHttpRequestPtr Rq, FHttpResponsePtr Rs, bool bOk)
	{
		if (auto C = Weak.Pin()) { C->OnHelloDone(Rq, Rs, bOk, Gen); }
	});
	Req->ProcessRequest();
}

void FFicsitAISidecarChannel::OnHelloDone(FHttpRequestPtr, FHttpResponsePtr Resp, bool bOk, uint64 Gen)
{
	bHelloInFlight = false;
	if (Gen != Generation || State == EFicsitAIChannelState::Stopped) { return; }
	const int32 Code = Resp.IsValid() ? Resp->GetResponseCode() : 0;
	if (!bOk || Code == 0)
	{
		++Failures;
		SetState(EFicsitAIChannelState::Unavailable, TEXT("adapter not reachable"));
		ScheduleRetry(Backoff(Failures));
		return;
	}
	if (Code == 401)
	{
		SetState(EFicsitAIChannelState::Unavailable, TEXT("token rejected (401)"));
		ScheduleRetry(60.0);
		return;
	}
	if (Code == 409)
	{
		const FString Why = CodeOf(Resp);
		const TSharedPtr<FJsonObject> B = ParseObject(Resp->GetContentAsString());
		if (B.IsValid()) { B->TryGetStringField(TEXT("apiVersion"), AdapterApiVersion); }
		SetState(EFicsitAIChannelState::Incompatible, Why.IsEmpty() ? TEXT("409") : Why);
		ScheduleRetry(60.0);
		return;
	}
	const TSharedPtr<FJsonObject> B = Code == 200 ? ParseObject(Resp->GetContentAsString()) : nullptr;
	FString NewSession;
	if (!B.IsValid() || !B->TryGetStringField(TEXT("session"), NewSession) || NewSession.IsEmpty())
	{
		++Failures;
		SetState(EFicsitAIChannelState::Unavailable, FString::Printf(TEXT("hello: HTTP %d"), Code));
		ScheduleRetry(Backoff(Failures));
		return;
	}
	B->TryGetStringField(TEXT("apiVersion"), AdapterApiVersion);
	const TSharedPtr<FJsonObject>* Limits = nullptr;
	if (B->TryGetObjectField(TEXT("limits"), Limits))
	{
		(*Limits)->TryGetNumberField(TEXT("pingSec"), PingSec);
		(*Limits)->TryGetNumberField(TEXT("maxBatchMessages"), MaxBatch);
		(*Limits)->TryGetNumberField(TEXT("bufferMessages"), BufferMessages);
		(*Limits)->TryGetNumberField(TEXT("maxMessageBytes"), MaxMessageBytes);
		PingSec = FMath::Max(1, PingSec); MaxBatch = FMath::Max(1, MaxBatch);
		BufferMessages = FMath::Max(4, BufferMessages); MaxMessageBytes = FMath::Max(1024, MaxMessageBytes);
	}
	ResetSession(TEXT("new session"));
	Session = NewSession;
	{
		FScopeLock Lock(&StreamLock);
		StreamSession = NewSession;
	}
	UE_LOG(LogFicsitAIChannel, Display, TEXT("FicsitAI channel: session opened, adapter api %s, ping %d s"), *AdapterApiVersion, PingSec);
	SetState(EFicsitAIChannelState::Reconnecting, TEXT("session opened, opening stream"));
	RetryAt = 0.0;
	OpenStream();
}

void FFicsitAISidecarChannel::ResetSession(const FString& Why)
{
	// Запросы прежней сессии потеряны: ждущий видит ошибку, а не тишину (протокол, «Конверт»).
	TMap<FString, FPendingRequest> Lost = MoveTemp(Pending);
	Pending.Reset();
	for (TPair<FString, FPendingRequest>& P : Lost)
	{
		if (P.Value.OnReply) { P.Value.OnReply(nullptr, TEXT("CHANNEL_RESET"), Why); }
	}
	Outgoing.Reset();
	NextSeqOut = 1;
	AckedIn = 0;
	LastAckAt = FPlatformTime::Seconds();
	bPostInFlight = false;
	PostRetryAt = 0.0;
	if (StreamRequest.IsValid())
	{
		StreamGenerationAtomic.store(++StreamGeneration);
		StreamRequest->CancelRequest();
		StreamRequest.Reset();
	}
	FScopeLock Lock(&StreamLock);
	LastSeqIn = 0;
	LineBuffer.Reset();
	StreamSession.Empty();
	while (!Incoming.IsEmpty()) { Incoming.Pop(); }
}

// --- поток адаптер → мод ----------------------------------------------------------------------------------

void FFicsitAISidecarChannel::OpenStream()
{
	if (Session.IsEmpty()) { return; }
	const uint64 Gen = ++StreamGeneration;
	StreamGenerationAtomic.store(Gen);
	int64 Ack = 0;
	{
		FScopeLock Lock(&StreamLock);
		Ack = LastSeqIn;
		LineBuffer.Reset();
	}
	bStreamHasMessages = false;
	bStreamBroken = false;
	LastLineAt = FPlatformTime::Seconds();
	++Stats.StreamsOpened;

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = MakeRequest(TEXT("GET"), FString::Printf(TEXT("/mod/stream?session=%s&ack=%lld"), *Session, Ack));
	Req->SetTimeout(0.f); // поток долгий: общего предела нет, живость — по ping
	Req->SetActivityTimeout(float(3 * PingSec + 5));
	TWeakPtr<FFicsitAISidecarChannel, ESPMode::ThreadSafe> Weak = AsShared();
	Req->SetResponseBodyReceiveStreamDelegateV2(FHttpRequestStreamDelegateV2::CreateLambda([Weak, Gen](void* Ptr, int64& Length)
	{
		if (auto C = Weak.Pin()) { C->OnStreamBytes(static_cast<const uint8*>(Ptr), Length, Gen); }
	}));
	Req->OnProcessRequestComplete().BindLambda([Weak, Gen](FHttpRequestPtr Rq, FHttpResponsePtr Rs, bool bOk)
	{
		if (auto C = Weak.Pin()) { C->OnStreamDone(Rq, Rs, bOk, Gen); }
	});
	StreamRequest = Req;
	Req->ProcessRequest();
}

void FFicsitAISidecarChannel::OnStreamBytes(const uint8* Data, int64 Length, uint64 Gen)
{
	// Поток HTTP. Сюда приходит и тело ответа с ошибкой (410, 409): у него нет поля type, и оно пропускается.
	if (Gen != StreamGenerationAtomic.load() || Length <= 0) { return; }
	FScopeLock Lock(&StreamLock);
	Stats.BytesIn += Length;
	LineBuffer.Append(Data, Length);
	int32 Start = 0;
	for (int32 i = 0; i < LineBuffer.Num(); ++i)
	{
		if (LineBuffer[i] != '\n') { continue; }
		int32 End = i;
		if (End > Start && LineBuffer[End - 1] == '\r') { --End; }
		const FUTF8ToTCHAR Conv(reinterpret_cast<const ANSICHAR*>(LineBuffer.GetData() + Start), End - Start);
		const FString Line(Conv.Length(), Conv.Get());
		Start = i + 1;
		if (Line.IsEmpty()) { continue; }
		++Stats.LinesIn;
		LastLineAt = FPlatformTime::Seconds();
		const TSharedPtr<FJsonObject> Message = ParseObject(Line);
		FString Type;
		if (!Message.IsValid() || !Message->TryGetStringField(TEXT("type"), Type)) { continue; }
		if (Type == TEXT("ping")) { ++Stats.Pings; continue; }
		if (Type == TEXT("bye"))
		{
			FString Reason;
			Message->TryGetStringField(TEXT("reason"), Reason);
			UE_LOG(LogFicsitAIChannel, Display, TEXT("FicsitAI channel: stream bye (%s)"), *Reason);
			continue;
		}
		int64 Seq = 0;
		if (!Message->TryGetNumberField(TEXT("seq"), Seq)) { continue; }
		if (Seq <= LastSeqIn) { ++Stats.Duplicates; continue; }
		if (Seq != LastSeqIn + 1)
		{
			// Пропуска в потоке быть не может: адаптер отдаёт подряд с ack + 1. Переоткрываем со своим ack.
			UE_LOG(LogFicsitAIChannel, Warning, TEXT("FicsitAI channel: gap in stream, got %lld after %lld"), Seq, LastSeqIn);
			bStreamBroken = true;
			LineBuffer.Reset();
			return;
		}
		LastSeqIn = Seq;
		++Stats.MessagesIn;
		bStreamHasMessages = true;
		Incoming.Enqueue({ Seq, StreamSession, Message });
	}
	if (Start > 0) { LineBuffer.RemoveAt(0, Start, EAllowShrinking::No); }
	if (LineBuffer.Num() > 2 * MaxMessageBytes)
	{
		UE_LOG(LogFicsitAIChannel, Warning, TEXT("FicsitAI channel: line over %d bytes, reopening stream"), 2 * MaxMessageBytes);
		bStreamBroken = true;
		LineBuffer.Reset();
	}
}

void FFicsitAISidecarChannel::OnStreamDone(FHttpRequestPtr, FHttpResponsePtr Resp, bool bOk, uint64 Gen)
{
	if (Gen != StreamGeneration || State == EFicsitAIChannelState::Stopped) { return; }
	StreamRequest.Reset();
	StreamGenerationAtomic.store(++StreamGeneration);
	const int32 Code = Resp.IsValid() ? Resp->GetResponseCode() : 0;
	if (Code == 410 || Code == 409)
	{
		// Сессии нет (адаптер перезапущен, вытеснена) или нужные номера вытеснены: только новое рукопожатие.
		UE_LOG(LogFicsitAIChannel, Display, TEXT("FicsitAI channel: stream refused with HTTP %d, new hello"), Code);
		Session.Empty();
		SetState(EFicsitAIChannelState::Connecting, FString::Printf(TEXT("stream HTTP %d"), Code));
		SendHello();
		return;
	}
	if (Code == 401)
	{
		Session.Empty();
		SetState(EFicsitAIChannelState::Unavailable, TEXT("token rejected (401)"));
		ScheduleRetry(60.0);
		return;
	}
	++Stats.StreamBreaks;
	++Failures;
	if (Failures >= 3)
	{
		// Поток не поднимается — скорее всего, адаптера нет вовсе. Дальше — рукопожатием, с паузами.
		Session.Empty();
		SetState(EFicsitAIChannelState::Unavailable, FString::Printf(TEXT("stream lost (%s, HTTP %d)"), bOk ? TEXT("ended") : TEXT("failed"), Code));
	}
	else
	{
		SetState(EFicsitAIChannelState::Reconnecting, FString::Printf(TEXT("stream %s, HTTP %d"), bOk ? TEXT("ended") : TEXT("failed"), Code));
	}
	ScheduleRetry(Backoff(Failures));
}

// --- GameThread -------------------------------------------------------------------------------------------

bool FFicsitAISidecarChannel::Tick(float)
{
	const double Now = FPlatformTime::Seconds();
	PumpIncoming();

	if (StreamRequest.IsValid())
	{
		if (bStreamHasMessages && State != EFicsitAIChannelState::Connected)
		{
			Failures = 0;
			SetState(EFicsitAIChannelState::Connected, TEXT("stream open"));
		}
		const bool bSilent = Now - LastLineAt.load() > 3.0 * PingSec;
		if (bSilent || bStreamBroken)
		{
			// Тишина дольше трёх ping или пропуск в номерах: поток переоткрывается с той же сессией и своим ack.
			UE_LOG(LogFicsitAIChannel, Warning, TEXT("FicsitAI channel: %s, reopening stream"), bSilent ? TEXT("stream silent") : TEXT("stream broken"));
			StreamGenerationAtomic.store(++StreamGeneration);
			StreamRequest->CancelRequest();
			StreamRequest.Reset();
			++Stats.StreamBreaks;
			SetState(EFicsitAIChannelState::Reconnecting, bSilent ? TEXT("silent") : TEXT("broken"));
			RetryAt = Now;
		}
	}

	switch (State)
	{
	case EFicsitAIChannelState::Unavailable:
	case EFicsitAIChannelState::Incompatible:
		if (Now >= RetryAt && !bHelloInFlight) { Session.Empty(); SendHello(); }
		break;
	case EFicsitAIChannelState::Reconnecting:
		if (!StreamRequest.IsValid() && !Session.IsEmpty() && Now >= RetryAt) { OpenStream(); }
		break;
	default:
		break;
	}
	MaybePost();
	return true;
}

void FFicsitAISidecarChannel::PumpIncoming()
{
	if (Incoming.IsEmpty()) { return; }
	const double T0 = FPlatformTime::Seconds();
	FIncoming Item;
	while (Incoming.Dequeue(Item))
	{
		if (Item.Session != Session) { continue; }
		HandleMessage(Item.Message);
	}
	Stats.GameThreadSeconds += FPlatformTime::Seconds() - T0;
}

void FFicsitAISidecarChannel::HandleMessage(const TSharedPtr<FJsonObject>& Message)
{
	FString Type, Id;
	Message->TryGetStringField(TEXT("type"), Type);
	Message->TryGetStringField(TEXT("id"), Id);
	const TSharedPtr<FJsonObject>* BodyPtr = nullptr;
	const TSharedPtr<FJsonObject> Body = Message->TryGetObjectField(TEXT("body"), BodyPtr) ? *BodyPtr : MakeShared<FJsonObject>();

	if (Type == TEXT("tool.call"))
	{
		++Stats.ToolCalls;
		FString Name, ExpectedSave;
		Body->TryGetStringField(TEXT("name"), Name);
		Body->TryGetStringField(TEXT("saveId"), ExpectedSave);
		const TSharedPtr<FJsonObject>* ArgsPtr = nullptr;
		const TSharedRef<FJsonObject> Args = Body->TryGetObjectField(TEXT("args"), ArgsPtr) && ArgsPtr->IsValid() ? ArgsPtr->ToSharedRef() : MakeShared<FJsonObject>();
		FFicsitAIChannelResponder Respond;
		Respond.Channel = AsShared();
		Respond.CallId = Id;
		Respond.Session = Session;
		Respond.bDone = MakeShared<FThreadSafeBool, ESPMode::ThreadSafe>(false);
		if (!ToolHandler) { Respond.Fail(TEXT("SOURCE_UNAVAILABLE"), TEXT("no API behind the channel")); return; }
		ToolHandler(Name, Args, ExpectedSave, Respond);
		return;
	}
	if (Type == TEXT("reply"))
	{
		FString Re;
		Message->TryGetStringField(TEXT("re"), Re);
		FPendingRequest Req;
		if (!Pending.RemoveAndCopyValue(Re, Req)) { return; }
		const TSharedPtr<FJsonObject>* Error = nullptr;
		if (Message->TryGetObjectField(TEXT("error"), Error))
		{
			FString Code, Text;
			(*Error)->TryGetStringField(TEXT("code"), Code);
			(*Error)->TryGetStringField(TEXT("message"), Text);
			if (Req.OnReply) { Req.OnReply(nullptr, Code.IsEmpty() ? TEXT("ERROR") : Code, Text); }
			return;
		}
		if (Req.OnReply) { Req.OnReply(Message->TryGetField(TEXT("body")), FString(), FString()); }
		return;
	}
	if (Type == TEXT("tool.cancel")) { return; } // вызовы v0 читают снимок и не прерываются
	if (Type == TEXT("adapter.status") || Type.StartsWith(TEXT("chat.")))
	{
		OnMessage.Broadcast(Type, Body);
		return;
	}
	// Незнакомый тип: с id — ответ ошибкой, без id — пропуск. Поэтому новое сообщение не требует нового протокола.
	if (!Id.IsEmpty())
	{
		const TSharedRef<FJsonObject> Reply = MakeShared<FJsonObject>();
		Reply->SetStringField(TEXT("type"), TEXT("reply"));
		Reply->SetStringField(TEXT("re"), Id);
		const TSharedRef<FJsonObject> Error = MakeShared<FJsonObject>();
		Error->SetStringField(TEXT("code"), TEXT("UNKNOWN_TYPE"));
		Error->SetStringField(TEXT("message"), FString::Printf(TEXT("mod does not know %s"), *Type));
		Reply->SetObjectField(TEXT("error"), Error);
		Enqueue(Reply);
	}
	UE_LOG(LogFicsitAIChannel, Verbose, TEXT("FicsitAI channel: unknown message type %s"), *Type);
}

// --- мод → адаптер ----------------------------------------------------------------------------------------

void FFicsitAISidecarChannel::SetModStatus(const FString& InSaveId, bool bInInert)
{
	if (InSaveId == SaveId && bInInert == bInert) { return; }
	SaveId = InSaveId;
	bInert = bInInert;
	if (Session.IsEmpty()) { return; } // уйдёт в рукопожатии
	const TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("saveId"), SaveId);
	Body->SetBoolField(TEXT("inert"), bInert);
	const TSharedRef<FJsonObject> Message = MakeShared<FJsonObject>();
	Message->SetStringField(TEXT("type"), TEXT("mod.status"));
	Message->SetObjectField(TEXT("body"), Body);
	Enqueue(Message);
}

void FFicsitAISidecarChannel::Request(const FString& Type, const TSharedRef<FJsonObject>& Body, FReplyHandler OnReply)
{
	check(IsInGameThread());
	if (Session.IsEmpty() || (State != EFicsitAIChannelState::Connected && State != EFicsitAIChannelState::Reconnecting))
	{
		if (OnReply) { OnReply(nullptr, TEXT("SIDECAR_UNAVAILABLE"), FString::Printf(TEXT("channel %s"), LexToString(State))); }
		return;
	}
	const FString Id = FString::Printf(TEXT("m-%lld"), NextRequestId++);
	Pending.Add(Id, { MoveTemp(OnReply) });
	const TSharedRef<FJsonObject> Message = MakeShared<FJsonObject>();
	Message->SetStringField(TEXT("type"), Type);
	Message->SetStringField(TEXT("id"), Id);
	Message->SetObjectField(TEXT("body"), Body);
	Enqueue(Message);
}

void FFicsitAISidecarChannel::SendToolResult(const FString& CallSession, const FString& CallId, const TSharedPtr<FJsonValue>& Body, const FString* Code, const FString* Message)
{
	check(IsInGameThread());
	// Ответ на вызов прежней сессии адаптеру уже не нужен: он завершил вызов ошибкой CHANNEL_RESET.
	if (CallSession != Session || Session.IsEmpty()) { return; }
	++Stats.ToolResults;
	const TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
	Out->SetStringField(TEXT("type"), TEXT("tool.result"));
	Out->SetStringField(TEXT("re"), CallId);
	if (Code)
	{
		const TSharedRef<FJsonObject> Error = MakeShared<FJsonObject>();
		Error->SetStringField(TEXT("code"), *Code);
		Error->SetStringField(TEXT("message"), Message ? *Message : FString());
		Out->SetObjectField(TEXT("error"), Error);
	}
	else
	{
		Out->SetField(TEXT("body"), Body);
	}
	Enqueue(Out);
}

void FFicsitAISidecarChannel::Enqueue(const TSharedRef<FJsonObject>& Envelope)
{
	const int64 Seq = NextSeqOut++;
	Envelope->SetNumberField(TEXT("seq"), Seq);
	Outgoing.Add({ Seq, ToJson(Envelope) });
	++Stats.MessagesOut;
	MaybePost();
}

void FFicsitAISidecarChannel::MaybePost()
{
	if (bPostInFlight || Session.IsEmpty()) { return; }
	if (State != EFicsitAIChannelState::Connected && State != EFicsitAIChannelState::Reconnecting) { return; }
	const double Now = FPlatformTime::Seconds();
	if (Now < PostRetryAt) { return; }
	int64 Ack = 0;
	{
		FScopeLock Lock(&StreamLock);
		Ack = LastSeqIn;
	}
	// Подтверждение без сообщений: иначе длинный ответ переполнил бы буфер адаптера (протокол, «Мод → адаптер»).
	const bool bAckDue = Ack > AckedIn && (Ack - AckedIn >= BufferMessages / 4 || Now - LastAckAt > 5.0);
	if (Outgoing.Num() == 0 && !bAckDue) { return; }

	FString Messages;
	int32 Count = 0;
	int64 Bytes = 0;
	for (const FOutgoing& O : Outgoing)
	{
		if (Count >= MaxBatch || (Count > 0 && Bytes + O.Json.Len() > MaxMessageBytes)) { break; }
		if (Count > 0) { Messages += TEXT(","); }
		Messages += O.Json;
		Bytes += O.Json.Len();
		++Count;
	}
	const FString Body = FString::Printf(TEXT("{\"session\":\"%s\",\"ack\":%lld,\"messages\":[%s]}"), *Session, Ack, *Messages);
	if (Count == 0) { ++Stats.AckOnlyPosts; }
	++Stats.Posts;
	bPostInFlight = true;
	const uint64 Gen = Generation;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = MakeRequest(TEXT("POST"), TEXT("/mod/send"));
	Req->SetContentAsString(Body);
	Req->SetTimeout(10.f);
	TWeakPtr<FFicsitAISidecarChannel, ESPMode::ThreadSafe> Weak = AsShared();
	Req->OnProcessRequestComplete().BindLambda([Weak, Gen, Ack](FHttpRequestPtr Rq, FHttpResponsePtr Rs, bool bOk)
	{
		if (auto C = Weak.Pin()) { C->OnPostDone(Rq, Rs, bOk, Gen, Ack); }
	});
	Req->ProcessRequest();
}

void FFicsitAISidecarChannel::OnPostDone(FHttpRequestPtr, FHttpResponsePtr Resp, bool bOk, uint64 Gen, int64 SentAck)
{
	if (Gen != Generation) { return; }
	bPostInFlight = false;
	const int32 Code = Resp.IsValid() ? Resp->GetResponseCode() : 0;
	if (Code == 410)
	{
		Session.Empty();
		SetState(EFicsitAIChannelState::Connecting, TEXT("send: SESSION_UNKNOWN"));
		SendHello();
		return;
	}
	if (Code == 200 || Code == 409)
	{
		// 200 — принято подряд до ack; 409 SEQ_GAP — то же ack, а остальное уйдёт следующей пачкой с ack + 1.
		const TSharedPtr<FJsonObject> B = ParseObject(Resp->GetContentAsString());
		int64 Acked = 0;
		if (B.IsValid() && B->TryGetNumberField(TEXT("ack"), Acked))
		{
			Outgoing.RemoveAll([Acked](const FOutgoing& O) { return O.Seq <= Acked; });
		}
		if (Code == 200)
		{
			AckedIn = FMath::Max(AckedIn, SentAck);
			LastAckAt = FPlatformTime::Seconds();
		}
		MaybePost();
		return;
	}
	if (Code == 413 && Outgoing.Num() > 0)
	{
		UE_LOG(LogFicsitAIChannel, Error, TEXT("FicsitAI channel: message seq %lld over adapter limit, dropped"), Outgoing[0].Seq);
		Outgoing.RemoveAt(0);
		MaybePost();
		return;
	}
	++Stats.PostFailures;
	PostRetryAt = FPlatformTime::Seconds() + 1.0;
	UE_LOG(LogFicsitAIChannel, Warning, TEXT("FicsitAI channel: send failed (HTTP %d), retry in 1 s"), Code);
}
