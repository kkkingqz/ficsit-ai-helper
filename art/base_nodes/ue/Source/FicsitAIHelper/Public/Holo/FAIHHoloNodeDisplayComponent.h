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
class USplineMeshComponent;
class UMaterialInterface;

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

	/** Connections between the shown nodes (art/base_nodes/blender/bn_links.py is the reference): one ribbon per link
	 *  on the hologram floor, chevron dashes run From -> To, width / speed from the rate. Multi-node mode: curves
	 *  between the plates, bent around a node in the way, two-way pairs keep to their right-hand lanes. Single-node
	 *  mode: stubs from the plate edge to the platform edge, incoming from the left, outgoing to the right. Links
	 *  whose ends are not shown are skipped. Kept and re-routed by ShowSingle / ShowMulti. */
	UFUNCTION(BlueprintCallable, Category = "FAIH|Holo")
	void SetLinks(const TArray<FFAIHNodeLink>& Links);

	UFUNCTION(BlueprintCallable, Category = "FAIH|Holo")
	void ClearLinks();

	/** Links actually drawn (after skipping the ones whose nodes are not shown). */
	UFUNCTION(BlueprintPure, Category = "FAIH|Holo")
	int32 GetLinkCount() const { return DrawnLinks.Num(); }

	UFUNCTION(BlueprintPure, Category = "FAIH|Holo")
	FFAIHNodeLink GetLink(int32 Index) const { return DrawnLinks.IsValidIndex(Index) ? DrawnLinks[Index] : FFAIHNodeLink(); }

	/** World position for the link's label widget (middle of the ribbon; outer end of a stub). On the projector it
	 *  is meant for the links of the selected node only - the full labelled graph lives on the terminal screen. */
	UFUNCTION(BlueprintPure, Category = "FAIH|Holo")
	FVector GetLinkLabelLocation(int32 Index) const;

	/** SM_Holo_Link: 1 m strip along +X, UV u along it (nodes.json display.links.mesh). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo|Links")
	TObjectPtr<UStaticMesh> LinkMesh;

	/** MI_HoloLink (master MM_HoloLink): reads custom primitive data 0 = start distance, 1 = segment length (cm),
	 *  2 = dash speed (cm/s). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo|Links")
	TObjectPtr<UMaterialInterface> LinkMaterial;

	/** display.links: rate range (items/min, log mapped), width and speed in hologram mm. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo|Links")
	FVector2D LinkRateRange = FVector2D(15.f, 1200.f);

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo|Links")
	FVector2D LinkWidthMM = FVector2D(18.f, 48.f);

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo|Links")
	FVector2D LinkSpeedMMs = FVector2D(30.f, 110.f);

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo|Links")
	float LinkLiftMM = 4.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo|Links")
	float LinkGapMM = 6.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo|Links")
	float LinkLaneMM = 14.f;

	/** A node closer than this (cm) to a straight link makes it bend around (display.links.obstacle_radius). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo|Links")
	float LinkObstacleRadius = 31.f;

	/** Single-node mode: stubs end at this radius (cm), just past the scale ring; spread +- degrees per side. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo|Links")
	float LinkSingleEdge = 124.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo|Links")
	float LinkSingleSpread = 45.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|Holo|Links")
	int32 LinkSamples = 12;

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
	void RebuildLinks();
	void AddRibbon(const TArray<FVector2D>& Pts, float Z, float WidthCm, float SpeedCmS);
	FVector2D Anchor(int32 Shown, const FVector2D& Towards) const;
	float RateT(float Rate) const;

	struct FShownNode
	{
		FName Id;
		FVector2D XY;
		float Scale = 1.f;
		TArray<FVector2D> Outline;       // cm, model space
	};
	TArray<FShownNode> ShownNodes;
	TArray<FFAIHNodeLink> RequestedLinks;
	TArray<FFAIHNodeLink> DrawnLinks;
	TArray<FVector> LinkLabels;          // component space

	UPROPERTY(Transient)
	TArray<TObjectPtr<USplineMeshComponent>> LinkSegments;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UStaticMeshComponent>> SlotComponents;

	int32 VisibleCount = 0;
	bool bPowered = true;
};
