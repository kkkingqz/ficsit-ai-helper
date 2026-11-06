// FICSIT AI Helper — Command Center, the flagship AI Terminal building (FR-01).
// DRAFT, not compiled yet (no UE project in this repo). Signatures CHECKED against the SML v3.12.0 FactoryGame headers
// (Buildables/FGBuildableFactory.h, Buildables/FGBuildable.h, FGUseableInterface.h): see README_UE.md, "Header check".
//
// GameFacade/ is the only place where AFG*/UFG* types are allowed (ADR-021). Everything that leaves this class goes
// through UFAIHTerminalEvents (engine types only).
#pragma once

#include "CoreMinimal.h"
#include "Buildables/FGBuildableFactory.h"
#include "FAIHCommandCenter.generated.h"

class UStaticMeshComponent;
class UTextureRenderTarget2D;
class UMaterialInstanceDynamic;

UCLASS(Blueprintable)
class FICSITAIHELPER_API AFAIHCommandCenter : public AFGBuildableFactory
{
	GENERATED_BODY()

public:
	AFAIHCommandCenter();

	// AActor
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	// IFGUseableInterface, as overridden by AFGBuildable (checked; note FactoryGame's own spelling "GetLookAtDecription")
	virtual bool IsUseable_Implementation() const override;
	virtual void OnUse_Implementation(class AFGCharacterPlayer* ByCharacter, const FUseState& State) override;
	virtual FText GetLookAtDecription_Implementation(class AFGCharacterPlayer* ByCharacter, const FUseState& State) const override;

	// AFGBuildableFactory: "producing" = powered, so the 10 MW are drawn whenever the grid can supply them
	virtual bool CanProduce_Implementation() const override;

	/** mPowerConsumption is private in AFGBuildableFactory, so the C++ side enforces the draw through this virtual;
	 *  the BP default "Power Consumption" must still be 10 (build menu reads it), --content sets it. */
	virtual float GetProducingPowerConsumptionBase() const override { return PowerConsumptionMW; }

	UFUNCTION(BlueprintPure, Category = "FAIH|Terminal")
	UTextureRenderTarget2D* GetScreenRenderTarget() const { return ScreenRT; }

	/** Stable id of this terminal (actor name is saved by the game). Terminal settings store terminalId -> screenId. */
	UFUNCTION(BlueprintPure, Category = "FAIH|Terminal")
	FName GetTerminalId() const { return GetFName(); }

protected:
	/** Main 16:9 screen (SM_CommandCenter_ScreenRT): a plain component, so it can carry a dynamic material. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "FAIH|Terminal")
	TObjectPtr<UStaticMeshComponent> MainScreen;

	/** Static hologram part (SM_CommandCenter_Holo): beams, scale ring, emitter disc, lenses. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "FAIH|Terminal")
	TObjectPtr<UStaticMeshComponent> HoloStatic;

	/** Spinning hologram part (SM_CommandCenter_HoloSpin): pivot = SOCKET_holo of the exterior mesh. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "FAIH|Terminal")
	TObjectPtr<UStaticMeshComponent> HoloSpin;

	/** Texture parameter of the screen material that receives the render target (see ue_material_map.json). */
	UPROPERTY(EditDefaultsOnly, Category = "FAIH|Terminal")
	FName ScreenRTParameter = TEXT("ScreenRT");

	/** Scalar parameter of the screen material driven 1/0 by power. */
	UPROPERTY(EditDefaultsOnly, Category = "FAIH|Terminal")
	FName ScreenPowerParameter = TEXT("Power");    // MM_CC_ScreenRT has it; a missing parameter is a no-op

	/** Draw while powered (content_spec.json building.power_consumption_mw). Keep equal to BP "Power Consumption". */
	UPROPERTY(EditDefaultsOnly, Category = "FAIH|Terminal", meta = (ClampMin = "0.0"))
	float PowerConsumptionMW = 10.f;

	UPROPERTY(EditDefaultsOnly, Category = "FAIH|Terminal")
	FIntPoint ScreenRTSize = FIntPoint(1920, 1080);

	UPROPERTY(EditDefaultsOnly, Category = "FAIH|Terminal")
	float HoloSpinDegPerSec = 12.f;

	/** Components with this tag (the interior mesh proxy) get a max draw distance; the exterior keeps its LODs. */
	UPROPERTY(EditDefaultsOnly, Category = "FAIH|Terminal")
	FName InteriorComponentTag = TEXT("Interior");

	UPROPERTY(EditDefaultsOnly, Category = "FAIH|Terminal")
	float InteriorCullDistance = 6000.f;     // cm

	/** Component with this tag (the exterior mesh proxy) carries the sockets SOCKET_holo / SOCKET_power / ... */
	UPROPERTY(EditDefaultsOnly, Category = "FAIH|Terminal")
	FName ExteriorComponentTag = TEXT("Exterior");

	UPROPERTY(Transient)
	TObjectPtr<UTextureRenderTarget2D> ScreenRT;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> ScreenMID;

private:
	void ApplyPowerVisuals(bool bPowered);
	class UFAIHTerminalEvents* Events() const;

	bool bLastPowered = false;
	bool bPowerKnown = false;
};
