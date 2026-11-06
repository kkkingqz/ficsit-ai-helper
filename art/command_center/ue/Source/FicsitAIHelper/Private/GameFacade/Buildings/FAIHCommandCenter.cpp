// FICSIT AI Helper — Command Center (FR-01). DRAFT, not compiled yet — see the header.
#include "GameFacade/Buildings/FAIHCommandCenter.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Engine/World.h"
#include "FGCharacterPlayer.h"                     // VERIFY include path in SML 3.12
#include "GameFacade/Buildings/FAIHTerminalEvents.h"
#include "Kismet/KismetRenderingLibrary.h"
#include "Materials/MaterialInstanceDynamic.h"

#define LOCTEXT_NAMESPACE "FAIHCommandCenter"

AFAIHCommandCenter::AFAIHCommandCenter()
{
	// 10 MW, no overclocking: the terminal is a consumer, not a production machine (content_spec.json)
	mPowerConsumption = 10.f;                      // VERIFY member name in AFGBuildableFactory
	mCanChangePotential = false;                   // VERIFY

	PrimaryActorTick.bCanEverTick = true;          // hologram spin + power watch (cheap)
	PrimaryActorTick.TickInterval = 0.f;

	if (!RootComponent)
	{
		RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	}
	MainScreen = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("MainScreen"));
	MainScreen->SetupAttachment(RootComponent);
	MainScreen->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	MainScreen->SetCullDistance(6000.f);

	HoloStatic = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HoloStatic"));
	HoloStatic->SetupAttachment(RootComponent);
	HoloStatic->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	HoloStatic->SetCastShadow(false);
	HoloStatic->SetCullDistance(4000.f);

	HoloSpin = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("HoloSpin"));
	HoloSpin->SetupAttachment(RootComponent);      // re-attached to SOCKET_holo in BeginPlay
	HoloSpin->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	HoloSpin->SetCastShadow(false);
	HoloSpin->SetCullDistance(4000.f);
}

void AFAIHCommandCenter::BeginPlay()
{
	Super::BeginPlay();

	// World display: render target on the main screen's dynamic material (§6.6: rendered in-process, no image pipeline)
	ScreenRT = UKismetRenderingLibrary::CreateRenderTarget2D(this, ScreenRTSize.X, ScreenRTSize.Y, RTF_RGBA8);
	if (MainScreen && MainScreen->GetNumMaterials() > 0)
	{
		ScreenMID = MainScreen->CreateDynamicMaterialInstance(0);
		if (ScreenMID && ScreenRT)
		{
			ScreenMID->SetTextureParameterValue(ScreenRTParameter, ScreenRT);
		}
	}

	TArray<UActorComponent*> Tagged = GetComponentsByTag(UPrimitiveComponent::StaticClass(), InteriorComponentTag);
	for (UActorComponent* C : Tagged)
	{
		Cast<UPrimitiveComponent>(C)->SetCullDistance(InteriorCullDistance);
	}

	// Spinning hologram: snap to SOCKET_holo of the exterior mesh (its pivot was exported at that socket)
	TArray<UActorComponent*> Ext = GetComponentsByTag(UStaticMeshComponent::StaticClass(), ExteriorComponentTag);
	if (Ext.Num() > 0 && HoloSpin)
	{
		HoloSpin->AttachToComponent(Cast<USceneComponent>(Ext[0]),
		                            FAttachmentTransformRules::SnapToTargetNotIncludingScale, TEXT("SOCKET_holo"));
	}

	ApplyPowerVisuals(HasPower());                 // VERIFY: HasPower() on AFGBuildableFactory
}

void AFAIHCommandCenter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	const bool bPowered = HasPower();
	if (!bPowerKnown || bPowered != bLastPowered)
	{
		ApplyPowerVisuals(bPowered);
	}
	if (bPowered && HoloSpin && HoloSpin->IsVisible())
	{
		HoloSpin->AddLocalRotation(FRotator(0.f, HoloSpinDegPerSec * DeltaSeconds, 0.f));
	}
}

bool AFAIHCommandCenter::CanProduce_Implementation() const
{
	return HasPower();
}

bool AFAIHCommandCenter::IsUseable_Implementation() const
{
	return true;                                   // look-at text explains "no power"; OnUse checks power
}

void AFAIHCommandCenter::OnUse_Implementation(AFGCharacterPlayer* ByCharacter, const FUseState& State)
{
	// Deliberately NOT calling Super: the factory interact widget is replaced by the mod's own UMG screen.
	if (!HasPower() || !ByCharacter)
	{
		return;
	}
	APlayerController* PC = Cast<APlayerController>(ByCharacter->GetController());
	if (UFAIHTerminalEvents* E = Events())
	{
		E->OnTerminalUsed.Broadcast(GetTerminalId(), PC, ScreenRT);
	}
}

FText AFAIHCommandCenter::GetLookAtDecription_Implementation(AFGCharacterPlayer* ByCharacter, const FUseState& State) const
{
	return HasPower()
		? LOCTEXT("UsePowered", "Command Center — press E to open the AI terminal")
		: LOCTEXT("UseNoPower", "Command Center — no power (10 MW)");
}

void AFAIHCommandCenter::ApplyPowerVisuals(bool bPowered)
{
	bPowerKnown = true;
	bLastPowered = bPowered;
	if (HoloStatic) { HoloStatic->SetVisibility(bPowered); }
	if (HoloSpin) { HoloSpin->SetVisibility(bPowered); }
	if (ScreenMID && ScreenPowerParameter != NAME_None)
	{
		ScreenMID->SetScalarParameterValue(ScreenPowerParameter, bPowered ? 1.f : 0.f);
	}
	if (UFAIHTerminalEvents* E = Events())
	{
		E->OnTerminalPowerChanged.Broadcast(GetTerminalId(), bPowered);
	}
}

UFAIHTerminalEvents* AFAIHCommandCenter::Events() const
{
	const UWorld* World = GetWorld();
	return World ? World->GetSubsystem<UFAIHTerminalEvents>() : nullptr;
}

#undef LOCTEXT_NAMESPACE
