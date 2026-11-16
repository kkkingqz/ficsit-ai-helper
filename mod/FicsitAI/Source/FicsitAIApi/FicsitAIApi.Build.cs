using UnrealBuildTool;

public class FicsitAIApi : ModuleRules
{
    public FicsitAIApi(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[] {
            "Core",
            "CoreUObject",
            // Подсистема мира (FicsitAIApiSubsystem). Только движок: без игры и SML, чтобы экраны жили и вне игры (S6).
            "Engine",
            // Каноническая форма запросов и событий: мост страниц и канал адаптера говорят JSON.
            "Json"
        });

        PrivateDependencyModuleNames.AddRange(new string[] {
        });
    }
}
