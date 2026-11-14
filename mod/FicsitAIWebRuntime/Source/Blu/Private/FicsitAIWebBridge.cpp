#include "FicsitAIWebBridge.h"
#include "BluEye.h"
#include "IBlu.h"
#include "Async/Async.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

const TCHAR* FFicsitAIWebBridge::Channel()
{
	return TEXT("ficsitai.bridge");
}

TSharedRef<FFicsitAIWebBridge, ESPMode::ThreadSafe> FFicsitAIWebBridge::Attach(UBluEye* InEye, FHandler InHandler)
{
	check(IsInGameThread());
	TSharedRef<FFicsitAIWebBridge, ESPMode::ThreadSafe> Bridge = MakeShared<FFicsitAIWebBridge, ESPMode::ThreadSafe>();
	Bridge->Eye = InEye;
	Bridge->Handler = MoveTemp(InHandler);
	TWeakPtr<FFicsitAIWebBridge, ESPMode::ThreadSafe> Weak = Bridge;
	Bridge->Subscription = InEye->NativeScriptEvent.AddLambda([Weak](const FString& Name, const FString& Data)
	{
		if (TSharedPtr<FFicsitAIWebBridge, ESPMode::ThreadSafe> Pinned = Weak.Pin()) { Pinned->OnScriptEvent(Name, Data); }
	});
	return Bridge;
}

FFicsitAIWebBridge::~FFicsitAIWebBridge()
{
	Detach();
}

void FFicsitAIWebBridge::Detach()
{
	if (UBluEye* E = Eye.Get()) { E->NativeScriptEvent.Remove(Subscription); }
	Subscription.Reset();
	Eye.Reset();
}

void FFicsitAIWebBridge::OnScriptEvent(const FString& Name, const FString& Data)
{
	if (Name != Channel()) { return; }
	// Предел считается по символам UTF-16: для кириллицы это строже, чем байты UTF-8, — и проверка дешевле.
	if (Data.Len() > MaxRequestBytes)
	{
		++Stats.Malformed;
		UE_LOG(LogBlu, Warning, TEXT("FicsitAI: bridge request dropped: %d chars"), Data.Len());
		return;
	}
	TSharedPtr<FJsonObject> Envelope;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Data);
	if (!FJsonSerializer::Deserialize(Reader, Envelope) || !Envelope.IsValid())
	{
		++Stats.Malformed;
		UE_LOG(LogBlu, Warning, TEXT("FicsitAI: bridge request dropped: not JSON"));
		return;
	}
	// Без id ответить некуда: такой конверт — ошибка фасада, а не запрос.
	const TSharedPtr<FJsonValue> Id = Envelope->TryGetField(TEXT("id"));
	if (!Id.IsValid() || (Id->Type != EJson::String && Id->Type != EJson::Number))
	{
		++Stats.Malformed;
		UE_LOG(LogBlu, Warning, TEXT("FicsitAI: bridge request dropped: no id"));
		return;
	}
	++Stats.Requests;

	FFicsitAIBridgeResponder Respond;
	Respond.Bridge = AsShared();
	Respond.Id = Id;
	Respond.bDone = MakeShared<FThreadSafeBool, ESPMode::ThreadSafe>(false);

	FString Op;
	if (!Envelope->TryGetStringField(TEXT("op"), Op) || Op.IsEmpty())
	{
		Respond.Fail(TEXT("INVALID_ARGUMENT"), TEXT("bridge envelope has no op"));
		return;
	}
	const TSharedPtr<FJsonObject>* ArgsPtr = nullptr;
	const bool bHasArgs = Envelope->HasField(TEXT("args"));
	if (bHasArgs && !Envelope->TryGetObjectField(TEXT("args"), ArgsPtr))
	{
		Respond.Fail(TEXT("INVALID_ARGUMENT"), TEXT("bridge args must be an object"));
		return;
	}
	const TSharedRef<FJsonObject> Args = ArgsPtr && ArgsPtr->IsValid() ? ArgsPtr->ToSharedRef() : MakeShared<FJsonObject>();

	if (!Handler)
	{
		Respond.Fail(TEXT("SOURCE_UNAVAILABLE"), TEXT("no API behind the bridge"));
		return;
	}
	const double T0 = FPlatformTime::Seconds();
	Handler(Op, Args, Respond);
	Stats.HandleSeconds += FPlatformTime::Seconds() - T0;
}

void FFicsitAIBridgeResponder::Ok(const TSharedPtr<FJsonValue>& Body) const
{
	Finish(Body.IsValid() ? Body : MakeShared<FJsonValueNull>(), nullptr, nullptr);
}

void FFicsitAIBridgeResponder::Fail(const FString& Code, const FString& Message) const
{
	Finish(nullptr, &Code, &Message);
}

void FFicsitAIBridgeResponder::Finish(const TSharedPtr<FJsonValue>& Body, const FString* Code, const FString* Message) const
{
	if (!bDone.IsValid() || bDone->AtomicSet(true))
	{
		if (TSharedPtr<FFicsitAIWebBridge, ESPMode::ThreadSafe> B = Bridge.Pin()) { ++B->Stats.Duplicates; }
		return;
	}
	if (IsInGameThread())
	{
		if (TSharedPtr<FFicsitAIWebBridge, ESPMode::ThreadSafe> B = Bridge.Pin()) { B->Deliver(Id, Body, Code, Message); }
		return;
	}
	// Ответ с рабочего потока: браузер трогаем только с GameThread.
	TWeakPtr<FFicsitAIWebBridge, ESPMode::ThreadSafe> Weak = Bridge;
	TSharedPtr<FJsonValue> IdCopy = Id;
	const bool bError = Code != nullptr;
	const FString CodeCopy = bError ? *Code : FString();
	const FString MessageCopy = bError && Message ? *Message : FString();
	AsyncTask(ENamedThreads::GameThread, [Weak, IdCopy, Body, bError, CodeCopy, MessageCopy]()
	{
		if (TSharedPtr<FFicsitAIWebBridge, ESPMode::ThreadSafe> B = Weak.Pin())
		{
			B->Deliver(IdCopy, Body, bError ? &CodeCopy : nullptr, bError ? &MessageCopy : nullptr);
		}
	});
}

void FFicsitAIWebBridge::Deliver(const TSharedPtr<FJsonValue>& Id, const TSharedPtr<FJsonValue>& Body, const FString* Code, const FString* Message)
{
	const TSharedRef<FJsonObject> Envelope = MakeShared<FJsonObject>();
	Envelope->SetField(TEXT("re"), Id);
	if (Code)
	{
		const TSharedRef<FJsonObject> Error = MakeShared<FJsonObject>();
		Error->SetStringField(TEXT("code"), *Code);
		Error->SetStringField(TEXT("message"), Message ? *Message : FString());
		Envelope->SetObjectField(TEXT("error"), Error);
		++Stats.Errors;
	}
	else
	{
		Envelope->SetField(TEXT("body"), Body);
		++Stats.Replies;
	}
	Send(Envelope);
}

void FFicsitAIWebBridge::PushEvent(const FString& Name, const TSharedPtr<FJsonObject>& Data)
{
	check(IsInGameThread());
	const TSharedRef<FJsonObject> Envelope = MakeShared<FJsonObject>();
	Envelope->SetStringField(TEXT("event"), Name);
	Envelope->SetObjectField(TEXT("data"), Data.IsValid() ? Data : MakeShared<FJsonObject>());
	++Stats.Events;
	Send(Envelope);
}

FString FFicsitAIWebBridge::ToJsLiteral(const TSharedRef<FJsonObject>& Object)
{
	FString Json;
	const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Json);
	FJsonSerializer::Serialize(Object, Writer);
	// В JSON эти два символа могут стоять только внутри строк; в старых движках JS они обрывали литерал.
	Json.ReplaceInline(TEXT(" "), TEXT("\\u2028"), ESearchCase::CaseSensitive);
	Json.ReplaceInline(TEXT(" "), TEXT("\\u2029"), ESearchCase::CaseSensitive);
	return Json;
}

void FFicsitAIWebBridge::Send(const TSharedRef<FJsonObject>& Envelope)
{
	UBluEye* E = Eye.Get();
	if (!E) { return; }
	// Страница без фасада (или ещё не загрузила его) ответ молча пропускает: проверка — в самом выражении.
	E->ExecuteJS(TEXT("window.__ficsitaiBridge&&window.__ficsitaiBridge.receive(") + ToJsLiteral(Envelope) + TEXT(");"));
}
