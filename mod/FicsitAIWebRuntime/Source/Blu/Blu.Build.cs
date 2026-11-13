using System.Collections.Generic;
using UnrealBuildTool;
using System.IO;
using System;

public class Blu : ModuleRules
{

	private string ThirdPartyPath
	{
		get { return Path.GetFullPath(Path.Combine(ModuleDirectory, "../../ThirdParty/")); }
	}

	private void stageFiles(String[] FilesToStage)
	{
		foreach (var File in FilesToStage)
		{
			RuntimeDependencies.Add(File);
		}
	}

	public Blu(ReadOnlyTargetRules Target) : base(Target)
	{
        PublicDependencyModuleNames.AddRange(
			new string[] {
				"Core",
				"CoreUObject",
				"Engine",
				"Projects",
				"InputCore",
				"RenderCore",
				"RHI",
				"Slate",
				"SlateCore",
				"UMG",
				"Json",
				"RenderCore"
			});

		PrivateIncludePaths.AddRange(
			new string[] {
				Path.Combine(ModuleDirectory, "Private"),
			});

		if(Target.Platform == UnrealTargetPlatform.Win64)
		{

			// BLUI's CEF runtime is renamed (libcef.dll -> blucef.dll, chrome_elf.dll -> blucef_elf.dll, see builder/isolate_cef.ps1)
			// so it can't collide with the engine's own CEF (WebBrowser module) which is loaded into the same process by name.
			PublicAdditionalLibraries.Add(Path.Combine(ThirdPartyPath, "cef/Win/lib", "blucef.lib"));
			PublicAdditionalLibraries.Add(Path.Combine(ThirdPartyPath, "cef/Win/lib", "libcef_dll_wrapper.lib"));

			PublicDelayLoadDLLs.Add("blucef.dll");

			PublicIncludePaths.AddRange(
				new string[] {
					Path.Combine(ThirdPartyPath, "cef/Win")
				});

			// Add our runtime dependencies
			var FilesToStage = Directory.GetFiles(Path.Combine(ThirdPartyPath, "cef/Win/shipping"), "*", SearchOption.AllDirectories);
			stageFiles(FilesToStage);

		} else if(Target.Platform == UnrealTargetPlatform.Linux)
		{

			PublicAdditionalLibraries.Add(Path.Combine(ThirdPartyPath, "cef/Linux/lib", "libcef.so"));
			PublicAdditionalLibraries.Add(Path.Combine(ThirdPartyPath, "cef/Linux/lib", "libcef_dll_wrapper.a"));

			PublicIncludePaths.AddRange(
				new string[] {
					Path.Combine(ThirdPartyPath, "cef/Linux")
				});

		} else if(Target.Platform == UnrealTargetPlatform.Mac)
		{
			
			var FrameworkPath = Path.Combine(ThirdPartyPath, "cef/Mac/lib", "Chromium Embedded Framework.framework");

			PublicFrameworks.Add(FrameworkPath);
			PublicAdditionalLibraries.Add(Path.Combine(ThirdPartyPath, "cef/Mac/lib", "libcef_dll_wrapper.a"));

			PublicIncludePaths.AddRange(
				new string[] {
					Path.Combine(ThirdPartyPath, "cef", "Mac")
				});

			var FilesToStage = Directory.GetFiles(Path.Combine(ThirdPartyPath, "cef/Mac/shipping"), "*", SearchOption.AllDirectories);
			stageFiles(FilesToStage);

			FilesToStage = Directory.GetFiles(Path.Combine(ThirdPartyPath, "cef/Mac/lib"), "*", SearchOption.AllDirectories);
			stageFiles(FilesToStage);

			if(!Target.bBuildEditor)
			{
				AdditionalBundleResources.Add(new BundleResource(Path.Combine(FrameworkPath, "Chromium Embedded Framework"), "MacOS", false));
			}
		}
		else
		{
			throw new BuildException("BLUI: Platform not supported");
		}
	}
}
