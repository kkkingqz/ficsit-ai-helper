// FICSIT AI Helper — base-node hologram display. DRAFT, not compiled yet (see header).
#include "Holo/FAIHHoloNodeDisplayComponent.h"

#include "Components/SplineMeshComponent.h"
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
	ShownNodes = {{NodeId, FVector2D::ZeroVector, Row->ScaleSingle, Row->PlateOutline}};
	RebuildLinks();
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
	ShownNodes.Reset();
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
		ShownNodes.Add({Nodes[i].NodeId, L.Slots[i], Scale, Row->PlateOutline});
		++Shown;
	}
	for (int32 i = N; i < SlotComponents.Num(); ++i)
	{
		SlotComponents[i]->SetVisibility(false);
	}
	VisibleCount = N;
	RebuildLinks();
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
	ShownNodes.Reset();
	RebuildLinks();
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
	for (USplineMeshComponent* C : LinkSegments)
	{
		if (C)
		{
			C->SetVisibility(bPowered);
		}
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// links (mirrors art/base_nodes/blender/bn_links.py)
// ---------------------------------------------------------------------------------------------------------------------
namespace
{
	FVector2D Left(const FVector2D& V) { return FVector2D(-V.Y, V.X); }

	float SegDist(const FVector2D& P, const FVector2D& A, const FVector2D& B)
	{
		const FVector2D AB = B - A;
		const float T = FMath::Clamp(FVector2D::DotProduct(P - A, AB) / FMath::Max(AB.SizeSquared(), 1e-6f), 0.f, 1.f);
		return FVector2D::Distance(P, A + AB * T);
	}

	/** Distance from the plate centre to its outline along D (outline star-shaped about the centre). */
	float RayExit(const TArray<FVector2D>& Outline, const FVector2D& D)
	{
		float Best = 0.f;
		bool bHit = false;
		for (int32 i = 0; i < Outline.Num(); ++i)
		{
			const FVector2D P = Outline[i];
			const FVector2D E = Outline[(i + 1) % Outline.Num()] - P;
			const float Den = D.X * E.Y - D.Y * E.X;
			if (FMath::Abs(Den) < 1e-9f)
			{
				continue;
			}
			const float T = (P.X * E.Y - P.Y * E.X) / Den;
			const float U = (P.X * D.Y - P.Y * D.X) / Den;
			if (T > 0.f && U >= -1e-4f && U <= 1.f + 1e-4f && (!bHit || T < Best))
			{
				Best = T;
				bHit = true;
			}
		}
		return Best;
	}

	FVector2D Bezier(const FVector2D& P0, const FVector2D& C, const FVector2D& P1, float T)
	{
		return P0 * FMath::Square(1.f - T) + C * (2.f * (1.f - T) * T) + P1 * (T * T);
	}
}

float UFAIHHoloNodeDisplayComponent::RateT(float Rate) const
{
	const float Lo = FMath::Max(LinkRateRange.X, 1e-3f), Hi = FMath::Max(LinkRateRange.Y, Lo * 1.01f);
	return FMath::Clamp(FMath::Loge(FMath::Max(Rate, Lo) / Lo) / FMath::Loge(Hi / Lo), 0.f, 1.f);
}

FVector2D UFAIHHoloNodeDisplayComponent::Anchor(int32 Shown, const FVector2D& Towards) const
{
	const FShownNode& N = ShownNodes[Shown];
	const FVector2D D = (Towards - N.XY).GetSafeNormal();
	const FVector2D Local = D.GetRotated(-NodeYaw);               // outline is in the node's own frame
	return N.XY + D * (RayExit(N.Outline, Local) * N.Scale + LinkGapMM * 0.1f);
}

void UFAIHHoloNodeDisplayComponent::SetLinks(const TArray<FFAIHNodeLink>& Links)
{
	RequestedLinks = Links;
	RebuildLinks();
}

void UFAIHHoloNodeDisplayComponent::ClearLinks()
{
	RequestedLinks.Reset();
	RebuildLinks();
}

FVector UFAIHHoloNodeDisplayComponent::GetLinkLabelLocation(int32 Index) const
{
	return LinkLabels.IsValidIndex(Index) ? GetComponentTransform().TransformPosition(LinkLabels[Index])
	                                      : GetComponentLocation();
}

void UFAIHHoloNodeDisplayComponent::AddRibbon(const TArray<FVector2D>& Pts, float Z, float WidthCm, float SpeedCmS)
{
	float Dist = 0.f;
	for (int32 i = 0; i + 1 < Pts.Num(); ++i)
	{
		const FVector P0(Pts[i], Z), P1(Pts[i + 1], Z);
		const float Len = FVector::Dist(P0, P1);
		if (Len < 0.01f)
		{
			continue;
		}
		// tangents along the polyline (averaged at inner points), magnitude = segment length (Hermite)
		const FVector2D T0 = (Pts[i + 1] - Pts[FMath::Max(i - 1, 0)]).GetSafeNormal() * Len;
		const FVector2D T1 = (Pts[FMath::Min(i + 2, Pts.Num() - 1)] - Pts[i]).GetSafeNormal() * Len;
		USplineMeshComponent* C = NewObject<USplineMeshComponent>(GetOwner(), NAME_None, RF_Transient);
		C->SetMobility(EComponentMobility::Movable);
		C->SetupAttachment(this);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->SetCastShadow(false);
		C->SetStaticMesh(LinkMesh);
		if (LinkMaterial)
		{
			C->SetMaterial(0, LinkMaterial);
		}
		C->SetStartAndEnd(P0, FVector(T0, 0.f), P1, FVector(T1, 0.f), false);
		// SM_Holo_Link is 100 cm wide along Y: the cross-section scale X (-> mesh Y for forward axis X) = width / 100
		C->SetStartScale(FVector2D(WidthCm / 100.f, 1.f), false);
		C->SetEndScale(FVector2D(WidthCm / 100.f, 1.f), false);
		C->RegisterComponent();
		C->UpdateMesh();
		// MM_HoloLink: continuous dashes over the whole link
		C->SetCustomPrimitiveDataFloat(0, Dist);
		C->SetCustomPrimitiveDataFloat(1, Len);
		C->SetCustomPrimitiveDataFloat(2, SpeedCmS);
		C->SetVisibility(bPowered);
		LinkSegments.Add(C);
		Dist += Len;
	}
}

void UFAIHHoloNodeDisplayComponent::RebuildLinks()
{
	for (USplineMeshComponent* C : LinkSegments)
	{
		if (C)
		{
			C->DestroyComponent();
		}
	}
	LinkSegments.Reset();
	DrawnLinks.Reset();
	LinkLabels.Reset();
	if (!LinkMesh || ShownNodes.Num() == 0 || RequestedLinks.Num() == 0)
	{
		return;
	}
	auto Find = [this](FName Id) { return ShownNodes.IndexOfByPredicate([Id](const FShownNode& N) { return N.Id == Id; }); };
	auto HasReverse = [this](const FFAIHNodeLink& L)
	{
		return RequestedLinks.ContainsByPredicate([&L](const FFAIHNodeLink& O) { return O.From == L.To && O.To == L.From; });
	};
	const int32 Samples = FMath::Max(LinkSamples, 2);

	if (ShownNodes.Num() == 1)
	{
		// single node: stubs, incoming from the left (180 deg), outgoing to the right (0 deg)
		const FShownNode& N = ShownNodes[0];
		TArray<const FFAIHNodeLink*> Ins, Outs;
		for (const FFAIHNodeLink& L : RequestedLinks)
		{
			if (L.To == N.Id && L.From != N.Id) Ins.Add(&L);
			if (L.From == N.Id && L.To != N.Id) Outs.Add(&L);
		}
		for (int32 G = 0; G < 2; ++G)
		{
			const TArray<const FFAIHNodeLink*>& Group = G == 0 ? Ins : Outs;
			const float Base = G == 0 ? 180.f : 0.f;
			for (int32 i = 0; i < Group.Num(); ++i)
			{
				const FFAIHNodeLink& L = *Group[i];
				const float Spread = Group.Num() == 1 ? 0.f
					: FMath::Lerp(-LinkSingleSpread, LinkSingleSpread, float(i) / (Group.Num() - 1)) * (G == 0 ? -1.f : 1.f);
				const FVector2D D = FVector2D(1.f, 0.f).GetRotated(Base + Spread);
				const FVector2D Inner = D * (RayExit(N.Outline, D.GetRotated(-NodeYaw)) * N.Scale + LinkGapMM * 0.1f);
				const FVector2D Outer = D * LinkSingleEdge;
				const FVector2D P0 = G == 0 ? Outer : Inner, P1 = G == 0 ? Inner : Outer;
				TArray<FVector2D> Pts;
				for (int32 k = 0; k <= 6; ++k) Pts.Add(FMath::Lerp(P0, P1, k / 6.f));
				const float T = RateT(L.RatePerMin);
				const float Z = BaseZ + LinkLiftMM * 0.1f;
				AddRibbon(Pts, Z, FMath::Lerp(LinkWidthMM.X, LinkWidthMM.Y, T) * 0.1f, FMath::Lerp(LinkSpeedMMs.X, LinkSpeedMMs.Y, T) * 0.1f);
				DrawnLinks.Add(L);
				LinkLabels.Add(FVector(Outer, Z));
			}
		}
		return;
	}

	for (const FFAIHNodeLink& L : RequestedLinks)
	{
		const int32 IA = Find(L.From), IB = Find(L.To);
		if (IA == INDEX_NONE || IB == INDEX_NONE || IA == IB)
		{
			continue;
		}
		const FVector2D A = ShownNodes[IA].XY, B = ShownNodes[IB].XY;
		const float T = RateT(L.RatePerMin);
		const float WidthCm = FMath::Lerp(LinkWidthMM.X, LinkWidthMM.Y, T) * 0.1f;
		const FVector2D Mid = (A + B) * 0.5f;
		FVector2D Ctrl = Mid;
		for (int32 k = 0; k < ShownNodes.Num(); ++k)                // bend around a node standing in the way
		{
			if (k == IA || k == IB) continue;
			const FVector2D C = ShownNodes[k].XY;
			if (SegDist(C, A, B) < LinkObstacleRadius + WidthCm)
			{
				FVector2D Nrm = Mid - C;
				Nrm = Nrm.Size() > 0.01f ? Nrm.GetSafeNormal() : Left(B - A).GetSafeNormal();
				const FVector2D Through = C + Nrm * (LinkObstacleRadius * 1.15f);
				Ctrl = Through * 2.f - Mid;
			}
		}
		FVector2D P0 = Anchor(IA, Ctrl), P1 = Anchor(IB, Ctrl);
		const bool bPair = HasReverse(L);
		if (bPair)                                                  // two-way pair: right-hand lanes
		{
			const FVector2D Off = Left(P1 - P0).GetSafeNormal() * (-LinkLaneMM * 0.1f);
			P0 += Off; P1 += Off; Ctrl += Off;
		}
		TArray<FVector2D> Pts;
		for (int32 k = 0; k <= Samples; ++k) Pts.Add(Bezier(P0, Ctrl, P1, float(k) / Samples));
		const float Z = BaseZ + 30.f * ShownNodes[IA].Scale + LinkLiftMM * 0.1f;   // plate top (0.3 m model) + lift
		AddRibbon(Pts, Z, WidthCm, FMath::Lerp(LinkSpeedMMs.X, LinkSpeedMMs.Y, T) * 0.1f);
		DrawnLinks.Add(L);
		LinkLabels.Add(FVector(Pts[bPair ? int32(Pts.Num() * 0.32f) : Pts.Num() / 2], Z));
	}
}
