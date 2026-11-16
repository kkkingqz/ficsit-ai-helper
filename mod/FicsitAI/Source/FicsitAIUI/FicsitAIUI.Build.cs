using System.IO;
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
            "RenderCore",
            "RHI",
            "Projects"
        });

        // Веб-экраны (ADR-032, S8 3.4): браузер FicsitAIWebRuntime есть только в клиенте Win64. В Linux-редакторе
        // для cook и на сервере модуль собирается без него, веб-модули показывают «браузер недоступен».
        bool bWithWeb = Target.Platform == UnrealTargetPlatform.Win64 && Target.Type != TargetType.Server;
        if (bWithWeb)
        {
            PrivateDependencyModuleNames.Add("Blu");
            // Страницы экранов — каталог Web/ мода (собирается из web/ и third_party/ перед сборкой мода, в
            // репозитории его нет) — едут в архив вместе с модом. Без каталога мод собирается, экраны пишут 404.
            string WebDir = Path.GetFullPath(Path.Combine(ModuleDirectory, "../../Web"));
            if (Directory.Exists(WebDir))
            {
                foreach (string File in Directory.GetFiles(WebDir, "*", SearchOption.AllDirectories))
                {
                    RuntimeDependencies.Add(File);
                }
            }
        }
        PublicDefinitions.Add("WITH_FICSITAI_WEB=" + (bWithWeb ? "1" : "0"));
    }
}
