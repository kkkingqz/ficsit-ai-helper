"""Base nodes — UE 5.6 editor import script. Run INSIDE the Unreal Editor of the SML 3.12 mod project
(Python Editor Script Plugin), from the Output Log -> Cmd:

    py "<repo>/art/base_nodes/ue/ue_import_base_nodes.py" --import
    py "<repo>/art/base_nodes/ue/ue_import_base_nodes.py" --table      (after the C++ module is compiled)
    py "<repo>/art/base_nodes/ue/ue_import_base_nodes.py" --verify

  --import  master material MM_HoloSolid (built by script: unlit, vertex-colour channels R edge / G glow / B dim / A accent, see
            README_UE.md) + MI_HoloSolid; hologram meshes SM_Holo_<Node>_T<n>[_Mini] (vertex colours REPLACE, no
            Nanite, no collision, MI_HoloSolid on slot 0); terminal-screen renders T_Node_<Node>_T<n>_Screen and icons
            T_Node_<Node>_T<n>_Icon_256 / _512 (UI texture group, no mips)
  --table   DT_BaseNodes (row struct FFAIHBaseNodeVisual) filled from base_nodes_table.json (written by the build)
  --verify  print what exists and what is missing

NOT RUN IN A REAL EDITOR YET: every unreal.* name is checked against the UE 5.6.0 Python stub by
../../command_center/ue/tools/ue_stub_dryrun.py --script (README_UE.md, "Checks"). Engine-version dependent calls are
wrapped; on failure the script prints a manual step instead of stopping.
"""
import json
import os
import sys

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.normpath(os.path.join(HERE, ".."))
SPEC = json.load(open(os.path.join(ART, "nodes.json"), encoding="utf-8"))
UE = SPEC["ue"]
FOLDER = {k: (UE["content_root"] + "/" + v) if v else UE["content_root"] for k, v in UE["folders"].items()}

tools = unreal.AssetToolsHelpers.get_asset_tools()
eal = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary
MANUAL = []
LEGACY_FBX_CVAR = "Interchange.FeatureFlags.Import.FBX"


def log(msg):
    unreal.log("[BaseNodes] " + msg)


def manual(msg):
    MANUAL.append(msg)
    unreal.log_warning("[BaseNodes] MANUAL STEP: " + msg)


def save(asset):
    try:
        return eal.save_loaded_asset(asset, False)
    except Exception as e:
        manual(f"save {asset.get_name() if asset else '?'} by hand: {e}")
        return False


def import_file(filename, dest, name, options=None):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", filename)
    task.set_editor_property("destination_path", dest)
    task.set_editor_property("destination_name", name)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    if options is not None:
        task.set_editor_property("options", options)
    tools.import_asset_tasks([task])
    paths = task.get_editor_property("imported_object_paths")
    return unreal.load_asset(paths[0]) if paths else None


def mesh_names():
    for node in SPEC["nodes"].values():
        for tk in node["tiers"]:
            for suffix in ("", "_Mini"):
                yield f"SM_Holo_{node['asset']}_T{tk}{suffix}"


def texture_names():
    for node in SPEC["nodes"].values():
        for tk in node["tiers"]:
            yield "screens", os.path.join(HERE, "screens"), f"T_Node_{node['asset']}_T{tk}_Screen"
            for size in (256, 512):
                yield "icons", os.path.join(ART, "icons"), f"T_Node_{node['asset']}_T{tk}_Icon_{size}"


# ---------------------------------------------------------------------------------------------------------------------
# material: MM_HoloSolid (one Custom node does the hologram look; parameters below are what MI_HoloSolid exposes)
# ---------------------------------------------------------------------------------------------------------------------
HOLO_HLSL = r"""
// R = edge rim, G = glow, B = dim, A = accent (vertex colour, written by blender/bn_geom.py)
float3 cell = abs(frac(P / max(Grid, 1.0) + 0.5) - 0.5);
float3 w = step(0.5, 1.0 - abs(NL));
float grid = max(max(step(cell.x, Line) * w.x, step(cell.y, Line) * w.y), step(cell.z, Line) * w.z);
float lit = dot(NW, normalize(LightDir.xyz)) * 0.825 + 1.075;
float dimf = 1.0 - 0.75 * VB;
float fres = pow(saturate(1.0 - abs(dot(NW, V))), 3.0) * dimf;
float scan = 1.0 - ScanStrength * step(0.5, frac(PW.z / max(ScanSize, 1.0) - T * ScanSpeed));
float3 e = FillColor.rgb * (lit + 0.45 * grid) * dimf + EdgeColor.rgb * (1.3 * VR + 0.9 * fres) + GlowColor.rgb * 2.6 * VG;
float3 acc = AccentColor.rgb * (0.2 * lit + 0.8 * VR + 1.4 * VG + 0.25);
e = lerp(e, acc, VA);
return e * Intensity * Power * scan;
"""
SCALARS = {"Intensity": 1.0, "Power": 1.0, "Grid": 200.0, "Line": 0.025, "ScanStrength": 0.06, "ScanSize": 6.0,
           "ScanSpeed": 0.15}
VECTORS = {"FillColor": (0.016, 0.10, 0.34), "EdgeColor": (0.16, 0.62, 1.0), "GlowColor": (0.55, 0.88, 1.0),
           "LightDir": (-0.35, -0.5, 0.8), "AccentColor": (0.913, 0.328, 0.011)}


def _expr(mat, cls, x, y, **props):
    e = mel.create_material_expression(mat, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    return e


def build_master(mat):
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
    custom = _expr(mat, unreal.MaterialExpressionCustom, -300, 0, code=HOLO_HLSL,
                   output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT3, description="HoloSolid")
    names = ["VR", "VG", "VB", "VA", "NW", "NL", "P", "PW", "V", "T"] + list(SCALARS) + list(VECTORS)
    inputs = []
    for n in names:
        ci = unreal.CustomInput()
        ci.set_editor_property("input_name", n)
        inputs.append(ci)
    custom.set_editor_property("inputs", inputs)
    vc = _expr(mat, unreal.MaterialExpressionVertexColor, -900, -400)
    for ch, pin in (("R", "VR"), ("G", "VG"), ("B", "VB"), ("A", "VA")):
        mel.connect_material_expressions(vc, ch, custom, pin)
    nw = _expr(mat, unreal.MaterialExpressionVertexNormalWS, -900, -250)
    mel.connect_material_expressions(nw, "", custom, "NW")
    nl = _expr(mat, unreal.MaterialExpressionTransform, -700, -150,
               transform_source_type=unreal.MaterialVectorCoordTransformSource.TRANSFORMSOURCE_WORLD,
               transform_type=unreal.MaterialVectorCoordTransform.TRANSFORM_LOCAL)
    mel.connect_material_expressions(nw, "", nl, "")
    mel.connect_material_expressions(nl, "", custom, "NL")
    mel.connect_material_expressions(_expr(mat, unreal.MaterialExpressionLocalPosition, -900, -50), "", custom, "P")
    mel.connect_material_expressions(_expr(mat, unreal.MaterialExpressionWorldPosition, -900, 50), "", custom, "PW")
    mel.connect_material_expressions(_expr(mat, unreal.MaterialExpressionCameraVectorWS, -900, 150), "", custom, "V")
    mel.connect_material_expressions(_expr(mat, unreal.MaterialExpressionTime, -900, 250), "", custom, "T")
    y = 350
    for n, v in SCALARS.items():
        p = _expr(mat, unreal.MaterialExpressionScalarParameter, -900, y, parameter_name=n, default_value=v)
        mel.connect_material_expressions(p, "", custom, n)
        y += 90
    for n, (r, g, b) in VECTORS.items():
        p = _expr(mat, unreal.MaterialExpressionVectorParameter, -900, y, parameter_name=n,
                  default_value=unreal.LinearColor(r, g, b, 1.0))
        mel.connect_material_expressions(p, "", custom, n)
        y += 130
    mel.connect_material_property(custom, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)


def material_instance():
    mfolder = FOLDER["materials"]
    mpath = f"{mfolder}/{UE['master']}"
    master = unreal.load_asset(mpath) if eal.does_asset_exist(mpath) else None
    if master is None:
        try:
            master = tools.create_asset(UE["master"], mfolder, unreal.Material, unreal.MaterialFactoryNew())
            build_master(master)
            mel.recompile_material(master)
            save(master)
            log(f"master {UE['master']} created")
        except Exception as e:
            manual(f"{UE['master']} could not be built by script ({e}); build it by hand (README_UE.md §2)")
            return None
    ipath = f"{mfolder}/{UE['material']}"
    mi = unreal.load_asset(ipath) if eal.does_asset_exist(ipath) else None
    if mi is None:
        mi = tools.create_asset(UE["material"], mfolder, unreal.MaterialInstanceConstant,
                                unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(mi, master)
    save(mi)
    return mi


# ---------------------------------------------------------------------------------------------------------------------
def fbx_options():
    ui = unreal.FbxImportUI()
    ui.set_editor_property("import_mesh", True)
    ui.set_editor_property("import_as_skeletal", False)
    ui.set_editor_property("import_materials", False)
    ui.set_editor_property("import_textures", False)
    ui.set_editor_property("import_animations", False)
    ui.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_STATIC_MESH)
    sm = ui.get_editor_property("static_mesh_import_data")
    for prop, val in (("combine_meshes", True), ("generate_lightmap_u_vs", False), ("auto_generate_collision", False),
                      ("convert_scene", True), ("force_front_x_axis", False), ("remove_degenerates", True),
                      ("build_nanite", False), ("import_mesh_lods", False)):
        try:
            sm.set_editor_property(prop, val)
        except Exception:
            manual(f"FBX option '{prop}' = {val}: set it in the import dialog")
    try:
        sm.set_editor_property("vertex_color_import_option", unreal.VertexColorImportOption.REPLACE)
        sm.set_editor_property("normal_import_method", unreal.FBXNormalImportMethod.FBXNIM_IMPORT_NORMALS)
    except Exception:
        manual("FBX options: Vertex Color Import Option = Replace, Normal Import Method = Import Normals")
    return ui


def import_meshes(mi):
    prev = None
    try:
        prev = unreal.SystemLibrary.get_console_variable_bool_value(LEGACY_FBX_CVAR)
        unreal.SystemLibrary.execute_console_command(None, f"{LEGACY_FBX_CVAR} 0")
    except Exception:
        manual(f"if the FBX options were ignored (Interchange), run '{LEGACY_FBX_CVAR} 0' and re-run --import")
    done = 0
    try:
        for name in mesh_names():
            src = os.path.join(ART, "export", name + ".fbx")
            if not os.path.exists(src):
                manual(f"{src} missing: run blender/build_nodes.py")
                continue
            mesh = import_file(src, FOLDER["meshes"], name, fbx_options())
            if mesh is None:
                manual(f"mesh import failed: {src}")
                continue
            if mi is not None:
                try:
                    mesh.set_material(0, mi)
                except Exception:
                    manual(f"{name}: material slot 0 = {UE['material']}")
            save(mesh)
            done += 1
    finally:
        if prev is not None:
            unreal.SystemLibrary.execute_console_command(None, f"{LEGACY_FBX_CVAR} {1 if prev else 0}")
    log(f"meshes: {done} imported")


def import_textures():
    done = 0
    for kind, folder, name in texture_names():
        src = os.path.join(folder, name + ".png")
        if not os.path.exists(src):
            manual(f"{src} missing: run blender/build_nodes.py --screens ../ue/screens / tools/make_icons.py")
            continue
        tex = import_file(src, FOLDER[kind], name)
        if tex is None:
            manual(f"texture import failed: {src}")
            continue
        try:
            tex.set_editor_property("lod_group", unreal.TextureGroup.TEXTUREGROUP_UI)
            tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_EDITOR_ICON)
            tex.set_editor_property("mip_gen_settings", unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
            tex.set_editor_property("srgb", True)
            save(tex)
        except Exception:
            manual(f"{name}: Texture Group = UI, Compression = UserInterface2D, Mip Gen = NoMipmaps, sRGB on")
        done += 1
    log(f"textures: {done} imported")


def do_import():
    mi = material_instance()
    import_meshes(mi)
    import_textures()


# ---------------------------------------------------------------------------------------------------------------------
def do_table():
    struct = unreal.load_object(None, UE["row_struct"])
    if struct is None:
        manual(f"row struct {UE['row_struct']} not found: compile the C++ module (Source/.../Holo) first")
        return
    path = f"{FOLDER['data']}/{UE['table']}"
    table = unreal.load_asset(path) if eal.does_asset_exist(path) else None
    if table is None:
        factory = unreal.DataTableFactory()
        factory.set_editor_property("struct", struct)
        table = tools.create_asset(UE["table"], FOLDER["data"], unreal.DataTable, factory)
    rows = open(os.path.join(HERE, "base_nodes_table.json"), encoding="utf-8").read()
    if not unreal.DataTableFunctionLibrary.fill_data_table_from_json_string(table, rows, struct):
        manual(f"{UE['table']}: fill from base_nodes_table.json failed; use Reimport / paste the JSON by hand")
        return
    save(table)
    names = unreal.DataTableFunctionLibrary.get_data_table_row_names(table)
    log(f"{UE['table']}: {len(names)} rows")


def do_verify():
    for name in mesh_names():
        p = f"{FOLDER['meshes']}/{name}"
        ok = eal.does_asset_exist(p)
        extra = ""
        if ok:
            mesh = unreal.load_asset(p)
            try:
                extra = f" material={mesh.get_material(0).get_name() if mesh.get_material(0) else None}"
                extra += f" nanite={mesh.get_editor_property('nanite_settings').get_editor_property('enabled')}"
            except Exception:
                pass
        log(f"  {'OK ' if ok else 'MISSING'} {p}{extra}")
    for kind, _, name in texture_names():
        p = f"{FOLDER[kind]}/{name}"
        log(f"  {'OK ' if eal.does_asset_exist(p) else 'MISSING'} {p}")
    for n in (UE["master"], UE["material"]):
        p = f"{FOLDER['materials']}/{n}"
        log(f"  {'OK ' if eal.does_asset_exist(p) else 'MISSING'} {p}")
    p = f"{FOLDER['data']}/{UE['table']}"
    log(f"  {'OK ' if eal.does_asset_exist(p) else 'MISSING'} {p}")


def main(argv):
    if "--import" in argv:
        do_import()
    if "--table" in argv:
        do_table()
    if "--verify" in argv or len(argv) == 0:
        do_verify()
    if MANUAL:
        log(f"{len(MANUAL)} manual step(s):")
        for i, m in enumerate(MANUAL, 1):
            log(f"  {i}. {m}")
        with open(os.path.join(HERE, "ue_manual_steps.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(MANUAL) + "\n")


main(sys.argv[1:])
