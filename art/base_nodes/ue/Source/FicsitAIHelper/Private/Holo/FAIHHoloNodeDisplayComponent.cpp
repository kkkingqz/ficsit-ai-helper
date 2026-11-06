// FICSIT AI Helper — base-node hologram display. DRAFT, not compiled yet (see header).
#include "Holo/FAIHHoloNodeDisplayComponent.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/DataTable.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"

namespace
{
	constexpr int32 MaxNodes = 5;

	FFAIHHoloLayout MakeLayout(float SlotRadiusM, std::initializer_list<FVector2D> SlotsM)
	{
		FFAIHHoloLayout L;
		L.SlotRadius = SlotRadiusM * 100.f;
		for (const FVector2D& S : SlotsM)
		{
			L.Slots.Add(S * 100.f);
		}
		return L;
	}

	FName RowName(FName NodeId, int32 Tier)
	{
		return FName(*FString::Printf(TEXT("%s_T%d"), *NodeId.ToString(), Tier));
	}
}

UFAIHHoloNodeDisplayComponent::UFAIHHoloNodeDisplayComponent()
{
	PrimaryComponentTick.bCanEverTick = false;
	// nodes.json display.multi.layouts (metres -> cm). Slot 0 of the 5-layout is the centre (the hub).
	Layouts.Add(MakeLayout(0.5f, {{-0.5f, 0.f}, {0.5f, 0.f}}));
	Layouts.Add(MakeLayout(0.464f, {{0.f, -0.536f}, {0.464f, 0.268f}, {-0.464f, 0.268f}}));
	Layouts.Add(MakeLayout(0.414f, {{-0.414f, -0.414f}, {0.414f, -0.414f}, {0.414f, 0.414f}, {-0.414f, 0.414f}}));
	Layouts.Add(MakeLayout(0.333f, {{0.f, 0.f}, {0.f, -0.667f}, {0.667f, 0.f}, {0.f, 0.667f}, {-0.667f, 0.f}}));
}

const FFAIHBaseNodeVisual* UFAIHHoloNodeDisplayComponent::FindVisual(FName NodeId, int32 Tier) const
{
	return NodeTable ? NodeTable->FindRow<FFAIHBaseNodeVisual>(RowName(NodeId, Tier), TEXT("FAIH Holo")) : nullptr;
}

bool UFAIHHoloNodeDisplayComponent::GetVisual(FName NodeId, int32 Tier, FFAIHBaseNodeVisual& OutVisual) const
{
	const FFAIHBaseNodeVisual* Row = FindVisual(NodeId, Tier);
	if (Row)
	{
		OutVisual = *Row;
	}
	return Row != nullptr;
}

float UFAIHHoloNodeDisplayComponent::LargestPlateRadius() const
{
	float R = 0.f;
	if (NodeTable)
	{
		NodeTable->ForeachRow<FFAIHBaseNodeVisual>(TEXT("FAIH Holo"),
			[&R](const FName&, const FFAIHBaseNodeVisual& Row) { R = FMath::Max(R, Row.PlateRadius); });
	}
	return R;
}

UStaticMeshComponent* UFAIHHoloNodeDisplayComponent::GetSlot(int32 Index)
{
	while (SlotComponents.Num() <= Index)
	{
		UStaticMeshComponent* C = NewObject<UStaticMeshComponent>(GetOwner(), NAME_None, RF_Transient);
		C->SetupAttachment(this);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->SetCastShadow(false);
		C->SetMobility(EComponentMobility::Movable);
		C->RegisterComponent();
		SlotComponents.Add(C);
	}
	return SlotComponents[Index];
}

void UFAIHHoloNodeDisplayComponent::Place(int32 Index, UStaticMesh* Mesh, const FVector2D& XY, float Scale, bool bDimmed)
{
	UStaticMeshComponent* C = GetSlot(Index);
	C->SetStaticMesh(Mesh);
	C->SetRelativeLocationAndRotation(FVector(XY.X, XY.Y, BaseZ), FRotator(0.f, NodeYaw, 0.f));
	C->SetRelativeScale3D(FVector(Scale));
	// every hologram mesh uses MI_HoloSolid on slot 0, so one MID per slot survives mesh swaps
	UMaterialInstanceDynamic* MID = Cast<UMaterialInstanceDynamic>(C->GetMaterial(0));
	if (!MID)
	{
		MID = C->CreateDynamicMaterialInstance(0);
	}
	if (MID)
	{
		MID->SetScalarParameterValue(IntensityParameter, bDimmed ? DimmedIntensity : 1.f);
	}
	C->SetVisibility(bPowered);
}

bool UFAIHHoloNodeDisplayComponent::ShowSingle(FName NodeId, int32 Tier, bool bDimmed)
{
	const FFAIHBaseNodeVisual* Row = FindVisual(NodeId, Tier);
	UStaticMesh* Mesh = Row ? Row->HoloMesh.LoadSynchronous() : nullptr;
	if (!Mesh)
	{
		Clear();
		return false;
	}
	Place(0, Mesh, FVector2D::ZeroVector, Row->ScaleSingle, bDimmed);
	for (int32 i = 1; i < SlotComponents.Num(); ++i)
	{
		SlotComponents[i]->SetVisibility(false);
	}
	VisibleCount = 1;
	return true;
}

bool UFAIHHoloNodeDisplayComponent::ShowMulti(const TArray<FFAIHBaseNodeRef>& Nodes)
{
	if (Nodes.Num() == 1)
	{
		return ShowSingle(Nodes[0].NodeId, Nodes[0].Tier, Nodes[0].bDimmed);
	}
	const int32 N = FMath::Min(Nodes.Num(), MaxNodes);
	if (N < 2 || !Layouts.IsValidIndex(N - 2))
	{
		Clear();
		return false;
	}
	const FFAIHHoloLayout& L = Layouts[N - 2];
	const float RMax = LargestPlateRadius();
	if (RMax <= 0.f || L.Slots.Num() < N)
	{
		Clear();
		return false;
	}
	// one scale for every node of this layout: the largest plate of ALL nodes and tiers fills a slot
	const float Scale = L.SlotRadius * SlotMargin / RMax;
	int32 Shown = 0;
	for (int32 i = 0; i < N; ++i)
	{
		const FFAIHBaseNodeVisual* Row = FindVisual(Nodes[i].NodeId, Nodes[i].Tier);
		UStaticMesh* Mesh = Row ? Row->HoloMeshMini.LoadSynchronous() : nullptr;
		if (!Mesh)
		{
			GetSlot(i)->SetVisibility(false);
			continue;
		}
		Place(i, Mesh, L.Slots[i], Scale, Nodes[i].bDimmed);
		++Shown;
	}
	for (int32 i = N; i < SlotComponents.Num(); ++i)
	{
		SlotComponents[i]->SetVisibility(false);
	}
	VisibleCount = N;
	return Shown > 0;
}

void UFAIHHoloNodeDisplayComponent::Clear()
{
	for (UStaticMeshComponent* C : SlotComponents)
	{
		if (C)
		{
			C->SetVisibility(false);
		}
	}
	VisibleCount = 0;
}

void UFAIHHoloNodeDisplayComponent::SetPowered(bool bInPowered)
{
	bPowered = bInPowered;
	for (int32 i = 0; i < SlotComponents.Num(); ++i)
	{
		if (SlotComponents[i])
		{
			SlotComponents[i]->SetVisibility(bPowered && i < VisibleCount && SlotComponents[i]->GetStaticMesh() != nullptr);
		}
	}
}
