using UnrealBuildTool;

public class FicsitAIApi : ModuleRules
{
    public FicsitAIApi(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[] {
            "Core",
            "CoreUObject"
        });

        PrivateDependencyModuleNames.AddRange(new string[] {
        });
    }
}
