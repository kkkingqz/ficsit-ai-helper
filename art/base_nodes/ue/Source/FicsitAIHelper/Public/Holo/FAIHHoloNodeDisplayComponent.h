// FICSIT AI Helper — shows base-node holograms on the Command Center projector: one node, or 2-5 nodes at once.
// DRAFT, not compiled yet. Engine types only (ADR-021: no FactoryGame types needed here).
//
// Attach to the projector socket (SOCKET_holo of SM_CommandCenter_Exterior). Numbers mirror nodes.json -> display:
// keep them in sync when the projector changes (art/base_nodes/README.md, "Projector").
#pragma once

#include "CoreMinimal.h"
#include "Components/SceneComponent.h"
#include "Holo/FAIHBaseNodeTypes.h"
#include "FAIHHoloNodeDisplayComponent.generated.h"

class UDataTable;
class UStaticMeshComponent;

UCLASS(ClassGroup = (FAIH), meta = (BlueprintSpawnableComponent))
class FICSITAIHELPER_API UFAIHHoloNodeDisplayComponent : public USceneComponent
{
	GENERATED_BODY()

public:
	UFAIHHoloNodeDisplayComponent();

	/** One node, fitted to the projector volume (per-tier ScaleSingle). Returns false if the row is missing. */
	UFUNCTION(BlueprintCallable, Category = "FAIH|Holo")
	bool ShowSingle(FName NodeId, int32 Tier, bool bDimmed = false);

	/** 2-5 nodes at one common scale (relative sizes stay true). 1 node falls back to ShowSingle; more than 5 are cut. */
	UFUNCTION(BlueprintCallable, Category = "FAIH|Holo")
	bool ShowMulti(const TArray<FFAIHBaseNodeRef>& Nodes);

	UFUNCTION(BlueprintCallable, Category = "FAIH|Holo")
	void Clear();

	/** Projector power: hides everything without power, restores the last state with it. */
	UFUNCTION(BlueprintCallable, Category = "FAIH|Holo")
	void SetPowered(bool bPowered);

	/** Row of NodeTable for a node tier (for the terminal UI: screen render, icon, names). */
	UFUNCTION(BlueprintCallable, Category = "FAIH|Holo")
	bool GetVisual(FName NodeId, int32 Tier, FFAIHBaseNodeVisual& OutVisual) const;

	const FFAIHBaseNodeVisual* FindVisual(FName NodeId, int32 Tier) const;

	/** DT_BaseNodes (row struct FFAIHBaseNodeVisual). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo")
	TObjectPtr<UDataTable> NodeTable;

	/** Ground of the hologram below the socket, cm (nodes.json display.base_z = -0.93 m: emitter disc top). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo")
	float BaseZ = -93.f;

	/** Fraction of a slot a node may fill in multi-node mode (display.multi.margin). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo")
	float SlotMargin = 0.92f;

	/** Layouts for 2..5 nodes; index = node count - 2. Defaults = display.multi.layouts. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo")
	TArray<FFAIHHoloLayout> Layouts;

	/** Yaw of every hologram relative to the socket (front of the node towards the operator). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo")
	float NodeYaw = 0.f;

	/** Material parameter scaled for dimmed nodes (MM_HoloSolid). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo")
	FName IntensityParameter = TEXT("Intensity");

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo")
	float DimmedIntensity = 0.35f;

private:
	UStaticMeshComponent* GetSlot(int32 Index);
	void Place(int32 Index, UStaticMesh* Mesh, const FVector2D& XY, float Scale, bool bDimmed);
	float LargestPlateRadius() const;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UStaticMeshComponent>> SlotComponents;

	int32 VisibleCount = 0;
	bool bPowered = true;
};
