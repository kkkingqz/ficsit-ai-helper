// FICSIT AI Helper — terminal events (GameFacade boundary, ADR-021).
// DRAFT, not compiled yet (written without the SML 3.12 headers). See art/command_center/ue/README_UE.md.
//
// This header contains ONLY engine types, so UI / core modules can include it without touching AFG*/UFG* types.
// The Command Center (and later the compact terminal) broadcast here; the single UI controller (ADR-001) subscribes.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "FAIHTerminalEvents.generated.h"

class APlayerController;
class UTextureRenderTarget2D;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FFAIHTerminalUsed, FName, TerminalId, APlayerController*, Player,
                                               UTextureRenderTarget2D*, WorldScreen);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FFAIHTerminalPowerChanged, FName, TerminalId, bool, bHasPower);

UCLASS()
class FICSITAIHELPER_API UFAIHTerminalEvents : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	/** E pressed on a powered terminal: open the full UMG screen (preset "slots-3", §6.1) for this player. */
	UPROPERTY(BlueprintAssignable, Category = "FAIH|Terminal")
	FFAIHTerminalUsed OnTerminalUsed;

	/** Power state changed: the world display (render target) can pause / resume rendering. */
	UPROPERTY(BlueprintAssignable, Category = "FAIH|Terminal")
	FFAIHTerminalPowerChanged OnTerminalPowerChanged;
};
