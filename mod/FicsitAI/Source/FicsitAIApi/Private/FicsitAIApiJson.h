#pragma once

// Каноническая форма API v0 (public-api-v0.md, «Канонические формы»): enum — строки lowerCamelCase, поля —
// lowerCamelCase без префикса b, value: null ровно при state: notApplicable, у queryMetric — дискриминатор kind.

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "FicsitAIApiTypes.h"

namespace FicsitAI::ApiJson
{
    FString ToString(EFicsitAIDataSource Value);
    FString ToString(EFicsitAIValueState Value);
    FString ToString(EFicsitAIUnit Value);
    FString ToString(EFicsitAIMetricScope Value);
    FString ToString(EFicsitAISeriesWindow Value);
    FString ToString(EFicsitAIAssistantState Value);

    bool Parse(const FString& Text, EFicsitAIMetricScope& Out);
    bool Parse(const FString& Text, EFicsitAISeriesWindow& Out);

    double WindowSeconds(EFicsitAISeriesWindow Window);

    TSharedRef<FJsonObject> ToJson(const FFicsitAIApiStatus& Status);
    /** Тело события api.status: статус без apiVersion, saveId и времени снимка. */
    TSharedRef<FJsonObject> StatusEventJson(const FFicsitAIApiStatus& Status);
    TSharedRef<FJsonObject> ToJson(const FFicsitAIMetricDescriptor& Descriptor);
    TSharedRef<FJsonObject> ToJson(const FFicsitAIMetricPage& Page);
    TSharedRef<FJsonObject> ToJson(const FFicsitAIScopePage& Page);
    TSharedRef<FJsonObject> ToJson(const FFicsitAIValue& Value);
    TSharedRef<FJsonObject> ToJson(const FFicsitAISeries& Series);
}
