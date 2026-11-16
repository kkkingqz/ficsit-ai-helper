using UnrealBuildTool;

public class FicsitAICore : ModuleRules
{
    public FicsitAICore(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[] {
            "Core",
            "CoreUObject",
            "Engine",
            "InputCore",
            "EnhancedInput",
            "FactoryGame",
            "SML",
            "FicsitAIApi",
            "FicsitAIUI",
            // Канал к адаптеру (Sidecar/): публичный заголовок отдаёт типы запроса HTTP и JSON.
            "HTTP",
            "Json"
        });

        PrivateDependencyModuleNames.AddRange(new string[] {
        });
    }
}
