#include "GameFacade/Terminal/FicsitAIDiagnostics.h"
#include "GameFacade/Terminal/FicsitAITerminal.h"
#include "GameFacade/Terminal/FicsitAISubsystem.h"
#include "EngineUtils.h"
#include "Engine/World.h"
#include "Misc/CommandLine.h"
#include "Misc/Paths.h"
#include "Misc/FileHelper.h"
#include "HAL/PlatformTime.h"
#include "HAL/PlatformMisc.h"
#include "HAL/FileManager.h"

namespace FicsitAI::Diagnostics
{

static FString EscapeJson(const FString& InStr)
{
    FString Out;
    Out.Reserve(InStr.Len() + 16);
    for (int32 i = 0; i < InStr.Len(); ++i)
    {
        const TCHAR C = InStr[i];
        switch (C)
        {
        case TEXT('"'):  Out += TEXT("\\\""); break;
        case TEXT('\\'): Out += TEXT("\\\\"); break;
        case TEXT('\b'): Out += TEXT("\\b");  break;
        case TEXT('\f'): Out += TEXT("\\f");  break;
        case TEXT('\n'): Out += TEXT("\\n");  break;
        case TEXT('\r'): Out += TEXT("\\r");  break;
        case TEXT('\t'): Out += TEXT("\\t");  break;
        default:
            if (C < 32)
            {
                Out += FString::Printf(TEXT("\\u%04x"), static_cast<uint32>(C));
            }
            else
            {
                Out.AppendChar(C);
            }
            break;
        }
    }
    return Out;
}

static FString MakeTestEventJson(const FString& InScenario, const FString& TestName, const FString& Status, double DurationMs, const FString& Details)
{
    return FString::Printf(
        TEXT("{\"type\":\"test_event\",\"scenario\":\"%s\",\"test\":\"%s\",\"status\":\"%s\",\"duration_ms\":%.1f,\"details\":\"%s\",\"timestamp\":\"%s\"}"),
        *EscapeJson(InScenario),
        *EscapeJson(TestName),
        *EscapeJson(Status),
        DurationMs,
        *EscapeJson(Details),
        *FDateTime::UtcNow().ToIso8601()
    );
}

static void AppendRecordingRecord(const FString& InSaveId, const FString& Line)
{
    const FString RecordingDir = FPaths::ProjectSavedDir() / TEXT("Recording");
    IFileManager::Get().MakeDirectory(*RecordingDir, true);
    const FString FileName = (InSaveId.IsEmpty() ? TEXT("common") : InSaveId) + TEXT(".jsonl");
    const FString FullPath = RecordingDir / FileName;
    FFileHelper::SaveStringToFile(Line + TEXT("\n"), *FullPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM, &IFileManager::Get(), FILEWRITE_Append);
}

void FFicsitAIDiagnosticsRunner::Initialize(UWorld* InWorld, FName InScenario)
{
    Scenario = InScenario;
    ElapsedSeconds = 0.0f;
    bFinished = false;

    if (AFicsitAISubsystem* Subsystem = AFicsitAISubsystem::Get(InWorld))
    {
        SaveId = Subsystem->GetSaveId();
    }

    const FString MapName = InWorld ? InWorld->GetMapName() : FString();
    bIsMainMenuWorld = !MapName.Contains(TEXT("Persistent_Level"));

    // Проверка допустимости сценария по ARCHITECTURE §13 (неизвестное имя -> ошибка и ненулевой код)
    const bool bValidScenario = (Scenario == FName(TEXT("S1Screen")) || Scenario == FName(TEXT("S1")));
    if (!bValidScenario)
    {
        UE_LOG(LogFicsitAISubsystem, Error,
            TEXT("[Diag] ОШИБКА: неизвестный сценарий '%s'. Допустимы: S1Screen, S1 (ARCHITECTURE §13)"),
            *Scenario.ToString());
        const FString Record = MakeTestEventJson(
            Scenario.ToString(),
            TEXT("scenario_dispatch"),
            TEXT("FAIL"),
            0.0,
            TEXT("Неизвестный сценарий диагностики (ARCHITECTURE §13)")
        );
        AppendRecordingRecord(SaveId, Record);
        if (GLog) { GLog->Flush(); }
        bFinished = true;
        FPlatformMisc::RequestExitWithStatus(true, 1);
        return;
    }

    UE_LOG(LogFicsitAISubsystem, Display, TEXT("[Diag:%s] Init Map='%s' MainMenu=%d (read-only mode per §13)"),
        *Scenario.ToString(), *MapName, bIsMainMenuWorld ? 1 : 0);
}

void FFicsitAIDiagnosticsRunner::Tick(UWorld* InWorld, float DeltaSeconds)
{
    if (!InWorld || bFinished || bIsMainMenuWorld)
    {
        return;
    }

    ElapsedSeconds += DeltaSeconds;
    if (Scenario == FName(TEXT("S1Screen")) || Scenario == FName(TEXT("S1")))
    {
        TickScenarioS1Screen(InWorld, DeltaSeconds);
    }
}

void FFicsitAIDiagnosticsRunner::TickScenarioS1Screen(UWorld* InWorld, float DeltaSeconds)
{
    if (ElapsedSeconds < 1.0f)
    {
        return;
    }

    AFicsitAITerminal* FoundTerminal = nullptr;
    for (TActorIterator<AFicsitAITerminal> It(InWorld); It; ++It)
    {
        FoundTerminal = *It;
        break;
    }

    if (!FoundTerminal)
    {
        UE_LOG(LogFicsitAISubsystem, Error,
            TEXT("[DiagS1Screen] ОШИБКА: В мире сохранения не найден актор AFicsitAITerminal (обязательная предпосылка сценария S1Screen)"));
        AppendRecordingRecord(SaveId, MakeTestEventJson(
            Scenario.ToString(),
            TEXT("terminal_world_screen"),
            TEXT("FAIL"),
            ElapsedSeconds * 1000.0,
            TEXT("No AFicsitAITerminal found in world save")
        ));
        if (GLog) { GLog->Flush(); }
        bFinished = true;
        return;
    }

    // Проверяем поля терминала и корректность поверхности
    const float Aspect = FoundTerminal->GetScreenAspectRatio();
    const bool bAspectOk = FMath::IsNearlyEqual(Aspect, 16.0f / 9.0f, 0.05f);
    const EFicsitAIHostState State = FoundTerminal->GetHostState();
    const bool bStateOk = (State == EFicsitAIHostState::Ready || State == EFicsitAIHostState::NoPower || State == EFicsitAIHostState::Inert);
    const bool bSurfaceOk = (FoundTerminal->GetWorldSurfaceWidget() != nullptr);
    const bool bRenderTargetOk = (FoundTerminal->GetWorldScreenRenderTarget() != nullptr);

    const bool bAllPassed = bAspectOk && bStateOk && bSurfaceOk && bRenderTargetOk;
    const FString StatusStr = bAllPassed ? TEXT("PASS") : TEXT("FAIL");
    const FString Details = FString::Printf(
        TEXT("aspect=%.4f (ok=%d) state=%d (ok=%d) surface=%d rt=%d draws=%llu rev=%llu"),
        Aspect, bAspectOk ? 1 : 0, static_cast<int32>(State), bStateOk ? 1 : 0,
        bSurfaceOk ? 1 : 0, bRenderTargetOk ? 1 : 0,
        FoundTerminal->GetWorldScreenDrawCount(),
        FoundTerminal->GetWorldScreenRenderRevision());

    UE_LOG(LogFicsitAISubsystem, Display,
        TEXT("[DiagS1Screen] READ_ONLY: %s (%s)"),
        *StatusStr, *Details);

    AppendRecordingRecord(SaveId, MakeTestEventJson(
        Scenario.ToString(),
        TEXT("terminal_world_screen"),
        StatusStr,
        ElapsedSeconds * 1000.0,
        Details
    ));

    if (GLog) { GLog->Flush(); }
    bFinished = true;
}

} // namespace FicsitAI::Diagnostics
