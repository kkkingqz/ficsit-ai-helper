#pragma once

#include "CoreMinimal.h"
#include "Internationalization/Culture.h"
#include "Internationalization/Internationalization.h"

enum class ESBCLanguage : uint8
{
	Korean,
	English,
	ChineseSimplified,
	German
};

namespace SBCLocalization
{
	inline ESBCLanguage GetCurrentLanguage()
	{
		// Satisfactory can change its display language independently of the Windows
		// locale.  GetCurrentLanguage follows that in-game selection, while
		// GetCurrentCulture may continue to report the operating-system culture.
		const FString Culture = FInternationalization::Get().GetCurrentLanguage()->GetName().ToLower();
		if (Culture.StartsWith(TEXT("ko"))) return ESBCLanguage::Korean;
		if (Culture.StartsWith(TEXT("zh"))) return ESBCLanguage::ChineseSimplified;
		if (Culture.StartsWith(TEXT("de"))) return ESBCLanguage::German;
		return ESBCLanguage::English;
	}

	inline FString String(
		ESBCLanguage Language,
		const TCHAR* Korean,
		const TCHAR* English,
		const TCHAR* Chinese = nullptr,
		const TCHAR* German = nullptr)
	{
		switch (Language)
		{
		case ESBCLanguage::Korean: return Korean;
		case ESBCLanguage::ChineseSimplified: return Chinese ? Chinese : English;
		case ESBCLanguage::German: return German ? German : English;
		default: return English;
		}
	}

	inline FText Text(
		ESBCLanguage Language,
		const TCHAR* Korean,
		const TCHAR* English,
		const TCHAR* Chinese = nullptr,
		const TCHAR* German = nullptr)
	{
		return FText::FromString(String(Language, Korean, English, Chinese, German));
	}

	template <typename... TArgs>
	inline FString Format(const FString& Pattern, TArgs&&... Args)
	{
		FStringFormatOrderedArguments OrderedArguments;
		(OrderedArguments.Add(FStringFormatArg(Forward<TArgs>(Args))), ...);
		return FString::Format(*Pattern, OrderedArguments);
	}
}
