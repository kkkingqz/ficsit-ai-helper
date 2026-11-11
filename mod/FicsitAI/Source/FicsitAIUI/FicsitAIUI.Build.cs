using UnrealBuildTool;

public class FicsitAIUI : ModuleRules
{
    public FicsitAIUI(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[] {
            "Core",
            "CoreUObject",
            "Engine",
            "InputCore",
            "Slate",
            "SlateCore",
            "UMG",
            "Json",
            "JsonUtilities",
            "FicsitAIApi"
        });

        PrivateDependencyModuleNames.AddRange(new string[] {
        });
    }
}
