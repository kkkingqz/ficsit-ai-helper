using UnrealBuildTool;

public class FicsitAIApi : ModuleRules
{
    public FicsitAIApi(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[] {
            "Core",
            "CoreUObject",
            // FKey в контексте экрана (клавиши действия «Назад», ревью #69).
            "InputCore"
        });

        PrivateDependencyModuleNames.AddRange(new string[] {
        });
    }
}
