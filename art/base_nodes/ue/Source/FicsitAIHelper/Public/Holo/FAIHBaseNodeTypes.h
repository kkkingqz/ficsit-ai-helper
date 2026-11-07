// FICSIT AI Helper — base nodes: visual data of one node tier (hologram meshes, screen render, icon).
// DRAFT, not compiled yet. Engine types only (no FactoryGame), so it lives outside GameFacade/ (ADR-021).
// Rows come from art/base_nodes/ue/base_nodes_table.json (written by blender/build_nodes.py), table DT_BaseNodes.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataTable.h"
#include "FAIHBaseNodeTypes.generated.h"

class UStaticMesh;
class UTexture2D;

/** Row of DT_BaseNodes; row name = "<NodeId>_T<Tier>" (e.g. central_hub_T2). Lengths in cm. */
USTRUCT(BlueprintType)
struct FICSITAIHELPER_API FFAIHBaseNodeVisual : public FTableRowBase
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|BaseNode")
	FName NodeId;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|BaseNode")
	int32 Tier = 1;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|BaseNode")
	FText DisplayName;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|BaseNode")
	FText TypeLabel;

	/** Single-node projector mode (rims sized for this tier's fit scale). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|BaseNode")
	TSoftObjectPtr<UStaticMesh> HoloMesh;

	/** Multi-node mode (2-5 nodes): no railings / crates / pipes, thicker masts, rims sized for the small scale. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|BaseNode")
	TSoftObjectPtr<UStaticMesh> HoloMeshMini;

	/** Prepared render for the terminal screens (iso view, transparent, 1280 x 800). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|BaseNode")
	TSoftObjectPtr<UTexture2D> ScreenImage;

	/** Pictogram from the concept (transparent, 256; the _512 texture sits next to it). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|BaseNode")
	TSoftObjectPtr<UTexture2D> Icon;

	/** Largest radius of the ground plate around the pivot, cm (model scale). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|BaseNode")
	float PlateRadius = 0.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|BaseNode")
	float Height = 0.f;

	/** Uniform scale that fits this tier into the projector volume in single-node mode. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|BaseNode")
	float ScaleSingle = 1.f;

	/** Ground plate outline, cm, model space (after the tier yaw): links start on this edge. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|BaseNode")
	TArray<FVector2D> PlateOutline;
};

/** One connection between two nodes: ONE line, whatever number of resources it carries (Label lists them,
 *  RatePerMin is the sum). Direction From -> To and the rate are what the ribbon shows. */
USTRUCT(BlueprintType)
struct FICSITAIHELPER_API FFAIHNodeLink
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "FAIH|BaseNode")
	FName From;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "FAIH|BaseNode")
	FName To;

	/** Items per minute, all resources of the link together: ribbon width and dash speed grow with log(rate). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "FAIH|BaseNode")
	float RatePerMin = 0.f;

	/** "Iron Ingot, Copper Ingot · 240/min" - drawn by the UI at GetLinkLabelLocation(). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "FAIH|BaseNode")
	FText Label;
};

/** One node to show in multi-node mode. */
USTRUCT(BlueprintType)
struct FICSITAIHELPER_API FFAIHBaseNodeRef
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "FAIH|BaseNode")
	FName NodeId;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "FAIH|BaseNode")
	int32 Tier = 1;

	/** Dimmed (e.g. no power / not built yet): scales the Intensity parameter. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "FAIH|BaseNode")
	bool bDimmed = false;
};

/** Slot layout for N nodes (nodes.json display.multi.layouts): positions in cm from the socket axis. */
USTRUCT(BlueprintType)
struct FICSITAIHELPER_API FFAIHHoloLayout
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|BaseNode")
	float SlotRadius = 0.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "FAIH|BaseNode")
	TArray<FVector2D> Slots;
};
