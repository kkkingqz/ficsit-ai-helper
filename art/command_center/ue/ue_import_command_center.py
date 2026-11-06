"""Command Center — UE 5.6 editor import script (stage 7). Run INSIDE the Unreal Editor of the SML 3.12 mod project.

Requires the "Python Editor Script Plugin". In the editor console (Output Log -> Cmd) run, for example:

    py "<repo>/art/command_center/ue/ue_import_command_center.py" --discover
    py "<repo>/art/command_center/ue/ue_import_command_center.py" --import
    py "<repo>/art/command_center/ue/ue_import_command_center.py" --content
    py "<repo>/art/command_center/ue/ue_import_command_center.py" --verify

Steps (see README_UE.md for the full procedure):
  --discover  list the game's master materials (path + parameter names) -> ue_material_discovery.json
  --import    import textures (sRGB / compression from textures/manifest.json), the three static meshes with their
              LODs, UCX collision and sockets (Nanite off, imported normals and tangents), create MI_CC_<slot>
              from ue_material_map.json and assign them to the mesh sections by slot name
  --content   create Desc_ / Recipe_ / Schem_ / Build_CommandCenter blueprints from content_spec.json (best effort:
              FactoryGame property names are set defensively; anything that fails is printed as a manual step)
  --verify    print what exists: meshes, LOD count, screen sizes, collision count, sockets, sections and materials

NOT RUN IN A REAL EDITOR YET. Checked so far (README_UE.md, "Checks"):
  * every unreal.* class / function / enum value and every editor property name is validated against the generated
    UE 5.6.0 stub (PyPI unreal-stub 0.3) by tools/ue_stub_dryrun.py, which also runs all four modes end to end;
  * FactoryGame property names (m_display_name, m_ingredients, ...) match the SML v3.12.0 headers.
Every call that depends on the engine or FactoryGame version is still wrapped; on failure the script prints what to do
by hand instead of stopping.
"""
import json
import os
import sys

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.normpath(os.path.join(HERE, ".."))
SPEC = json.load(open(os.path.join(HERE, "content_spec.json"), encoding="utf-8"))
MANIFEST = json.load(open(os.path.join(ART, "textures", "manifest.json"), encoding="utf-8"))
ROOT = SPEC["content_root"]
FOLDER = {k: (ROOT + "/" + v) if v else ROOT for k, v in SPEC["folders"].items()}

tools = unreal.AssetToolsHelpers.get_asset_tools()
eal = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary
MANUAL = []


def log(msg):
    unreal.log("[CommandCenter] " + msg)


def manual(msg):
    MANUAL.append(msg)
    unreal.log_warning("[CommandCenter] MANUAL STEP: " + msg)


def subsystem(cls_name):
    cls = getattr(unreal, cls_name, None)
    try:
        return unreal.get_editor_subsystem(cls) if cls else None
    except Exception:
        return None


def save(asset):
    """Save even if the package is not flagged dirty (CDO edits through set_editor_property may not flag it)."""
    try:
        return eal.save_loaded_asset(asset, False)
    except Exception as e:
        manual(f"save {asset.get_name() if asset else '?'} by hand: {e}")
        return False


def generated_class(bp):
    try:
        return unreal.BlueprintEditorLibrary.generated_class(bp)
    except Exception:
        return eal.load_blueprint_class(bp.get_path_name().split(".")[0])


def set_prop(obj, names, value):
    """Set an editor property trying the Python (snake_case) and the C++ (mCamelCase) spelling."""
    for n in names:
        try:
            obj.set_editor_property(n, value)
            return True
        except Exception:
            continue
    return False


# ---------------------------------------------------------------------------------------------------------------------
# --discover
# ---------------------------------------------------------------------------------------------------------------------
KEYWORDS = ("factory", "building", "buildable", "paint", "custom", "metal", "glass", "window", "emissive", "light",
            "holo", "screen", "monitor", "decal", "hazard", "rubber", "concrete", "floor", "grate", "tread")


def discover():
    ar = unreal.AssetRegistryHelpers.get_asset_registry()
    out = []
    for cls in ("Material", "MaterialInstanceConstant"):
        try:
            flt = unreal.ARFilter(class_paths=[unreal.TopLevelAssetPath("/Script/Engine", cls)],
                                  package_paths=["/Game/FactoryGame"], recursive_paths=True)
            assets = ar.get_assets(flt)
        except Exception as e:                                  # older filter API
            manual(f"asset registry filter failed ({e}); browse /Game/FactoryGame materials by hand")
            assets = []
        for ad in assets:
            name = str(ad.asset_name)
            if not any(k in name.lower() for k in KEYWORDS):
                continue
            path = str(ad.package_name) + "." + name
            entry = {"path": path, "class": cls}
            try:
                mat = unreal.load_asset(path)
                base = mat if cls == "Material" else mat.get_base_material()
                entry["parent"] = base.get_path_name() if base and cls != "Material" else ""
                entry["scalars"] = [str(p) for p in mel.get_scalar_parameter_names(mat)]
                entry["vectors"] = [str(p) for p in mel.get_vector_parameter_names(mat)]
                entry["textures"] = [str(p) for p in mel.get_texture_parameter_names(mat)]
                entry["switches"] = [str(p) for p in mel.get_static_switch_parameter_names(mat)]
            except Exception as e:
                entry["error"] = str(e)
            out.append(entry)
    dst = os.path.join(HERE, SPEC["materials"]["discovery_output"])
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    log(f"discovery: {len(out)} materials -> {dst}. Fill ue_material_map.json (parent + game_param) and run --import.")


# ---------------------------------------------------------------------------------------------------------------------
# --import
# ---------------------------------------------------------------------------------------------------------------------
COMPRESSION = {"Normalmap": "TC_NORMALMAP", "Masks": "TC_MASKS", "Grayscale": "TC_GRAYSCALE", "Default": "TC_DEFAULT"}


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


def import_textures():
    done = {}
    for name, t in MANIFEST["textures"].items():
        src = os.path.join(ART, "textures", name + ".png")
        if not os.path.exists(src):
            manual(f"texture {src} missing (run blender/stage5_textures.py)")
            continue
        tex = import_file(src, FOLDER["textures"], name)
        if tex is None:
            manual(f"texture import failed: {name}")
            continue
        comp = next((v for k, v in COMPRESSION.items() if t.get("compression", "").startswith(k)), "TC_DEFAULT")
        try:
            tex.set_editor_property("compression_settings", getattr(unreal.TextureCompressionSettings, comp))
            tex.set_editor_property("srgb", bool(t.get("srgb", False)))
            if comp == "TC_NORMALMAP":
                tex.set_editor_property("flip_green_channel", False)     # already DirectX
            save(tex)
        except Exception as e:
            manual(f"set compression/sRGB on {name} by hand ({comp}, sRGB={t.get('srgb')}): {e}")
        done[name] = tex
    for size in (512, 256):
        icon = os.path.join(HERE, "icons", f"IconDesc_CommandCenter_{size}.png")
        if os.path.exists(icon):
            tex = import_file(icon, FOLDER["icons"], f"IconDesc_CommandCenter_{size}")
            if tex:
                try:
                    tex.set_editor_property("lod_group", unreal.TextureGroup.TEXTUREGROUP_UI)
                    tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_EDITOR_ICON)
                    save(tex)
                except Exception:
                    manual(f"IconDesc_CommandCenter_{size}: Texture Group = UI, Compression = UserInterface2D")
                done[f"IconDesc_CommandCenter_{size}"] = tex
    log(f"textures: {len(done)} imported")
    return done


def fbx_options():
    ui = unreal.FbxImportUI()
    ui.set_editor_property("import_mesh", True)
    ui.set_editor_property("import_as_skeletal", False)
    ui.set_editor_property("import_materials", False)
    ui.set_editor_property("import_textures", False)
    ui.set_editor_property("import_animations", False)
    ui.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_STATIC_MESH)
    sm = ui.get_editor_property("static_mesh_import_data")
    imp = SPEC["import"]
    for prop, val in (("combine_meshes", imp["combine_meshes"]), ("generate_lightmap_u_vs", imp["generate_lightmap_uvs"]),
                      ("auto_generate_collision", imp["auto_generate_collision"]), ("convert_scene", imp["convert_scene"]),
                      ("force_front_x_axis", imp["force_front_x_axis"]), ("remove_degenerates", True),
                      ("one_convex_hull_per_ucx", True), ("build_nanite", imp["nanite"]), ("import_mesh_lods", False)):
        if not set_prop(sm, [prop], val):
            manual(f"FBX option '{prop}' = {val} could not be set by script; set it in the import dialog")
    try:
        sm.set_editor_property("normal_import_method", unreal.FBXNormalImportMethod.FBXNIM_IMPORT_NORMALS_AND_TANGENTS)
    except Exception:
        manual("FBX option Normal Import Method = Import Normals and Tangents")
    return ui


LEGACY_FBX_CVAR = "Interchange.FeatureFlags.Import.FBX"


def legacy_fbx(enable_legacy):
    """UE 5.5+ may route .fbx through Interchange, which ignores FbxImportUI. Switch to the legacy importer for the
    mesh imports and restore the previous value afterwards. Returns the previous value (None if unknown)."""
    try:
        prev = unreal.SystemLibrary.get_console_variable_bool_value(LEGACY_FBX_CVAR)
        unreal.SystemLibrary.execute_console_command(None, f"{LEGACY_FBX_CVAR} {0 if enable_legacy else 1}")
        return prev
    except Exception:
        manual(f"could not switch {LEGACY_FBX_CVAR}; if the FBX options were ignored, run '{LEGACY_FBX_CVAR} 0' "
               f"in the console and re-run --import")
        return None


def import_meshes():
    sms = subsystem("StaticMeshEditorSubsystem")
    meshes = {}
    prev = legacy_fbx(True)
    try:
        _import_meshes(sms, meshes)
    finally:
        if prev is not None:
            unreal.SystemLibrary.execute_console_command(None, f"{LEGACY_FBX_CVAR} {1 if prev else 0}")
    log(f"meshes: {len(meshes)} imported")
    return meshes


def _import_meshes(sms, meshes):
    for key, m in SPEC["meshes"].items():
        src = os.path.join(ART, "export", "ue", m["lod0"])
        mesh = import_file(src, FOLDER["meshes"], m["asset"], fbx_options())
        if mesh is None:
            manual(f"mesh import failed: {src}")
            continue
        for i, lod in enumerate(m["lods"], start=1):
            ok = False
            if sms:
                try:
                    ok = sms.import_lod(mesh, i, os.path.join(ART, "export", "ue", lod)) == i
                except Exception:
                    ok = False
            if not ok:
                manual(f"{m['asset']}: import LOD{i} from {lod} (Static Mesh Editor -> LOD Settings -> Import LOD Level {i})")
        try:
            ns = mesh.get_editor_property("nanite_settings")
            ns.set_editor_property("enabled", False)
            if sms:
                sms.set_nanite_settings(mesh, ns, True)
            else:
                mesh.set_editor_property("nanite_settings", ns)
        except Exception:
            manual(f"{m['asset']}: Nanite off (Details -> Nanite Settings -> Enabled = false)")
        screen = m["screen_sizes"]
        done = False
        if sms and len(screen) > 1:
            try:
                done = bool(sms.set_lod_screen_sizes(mesh, screen))
            except Exception:
                done = False
        elif len(screen) <= 1:
            done = True
        if not done:
            manual(f"{m['asset']}: LOD Settings -> Auto Compute LOD Distances = off, screen sizes {screen}")
        save(mesh)
        meshes[key] = mesh


# Fallback masters: used when ue_material_map.json has no game master for a slot ("fallback" key). Built node by node
# with MaterialEditingLibrary, parameter names are the "fallback_param" values of the map.
def _expr(mat, cls, x, y, **props):
    e = mel.create_material_expression(mat, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    return e


def _scalar(mat, name, value, x, y):
    return _expr(mat, unreal.MaterialExpressionScalarParameter, x, y, parameter_name=name, default_value=value)


def _mul(mat, a, a_out, b, b_out, x, y):
    m = _expr(mat, unreal.MaterialExpressionMultiply, x, y)
    mel.connect_material_expressions(a, a_out, m, "A")
    mel.connect_material_expressions(b, b_out, m, "B")
    return m


def _build_mm_screen(mat):
    """Lit, black glossy base; Emissive = ScreenRT.rgb * Emissive * Power. ScreenRT is the render target at runtime
    (AFAIHCommandCenter MID) or the static screen atlas in MI_CC_ScreenStatic."""
    tex = _expr(mat, unreal.MaterialExpressionTextureSampleParameter2D, -900, 0, parameter_name="ScreenRT",
                sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_COLOR)
    default = unreal.load_asset("/Engine/EngineResources/DefaultTexture.DefaultTexture")
    if default:
        tex.set_editor_property("texture", default)
    m1 = _mul(mat, tex, "RGB", _scalar(mat, "Emissive", 3.0, -900, 300), "", -500, 100)
    m2 = _mul(mat, m1, "", _scalar(mat, "Power", 1.0, -500, 350), "", -250, 150)
    mel.connect_material_property(m2, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.connect_material_property(_scalar(mat, "Roughness", 0.15, -500, 500), "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.connect_material_property(_expr(mat, unreal.MaterialExpressionConstant3Vector, -500, -200,
                                        constant=unreal.LinearColor(0.0, 0.0, 0.0, 1.0)), "",
                                  unreal.MaterialProperty.MP_BASE_COLOR)


def _build_mm_holo(mat):
    """Unlit additive two-sided: Emissive = HoloColor * Intensity * (Fresnel(Exponent) + Core)."""
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    mat.set_editor_property("two_sided", True)
    col = _expr(mat, unreal.MaterialExpressionVectorParameter, -1000, 0, parameter_name="HoloColor",
                default_value=unreal.LinearColor(0.1, 0.55, 1.0, 1.0))
    fres = _expr(mat, unreal.MaterialExpressionFresnel, -1000, 250, exponent=2.5, base_reflect_fraction=0.0)
    mel.connect_material_expressions(_scalar(mat, "FresnelExponent", 2.5, -1300, 250), "", fres, "ExponentIn")
    add = _expr(mat, unreal.MaterialExpressionAdd, -700, 300)
    mel.connect_material_expressions(fres, "", add, "A")
    mel.connect_material_expressions(_scalar(mat, "Core", 0.25, -1000, 450), "", add, "B")
    m1 = _mul(mat, col, "", add, "", -450, 100)
    m2 = _mul(mat, m1, "", _scalar(mat, "Intensity", 4.0, -450, 350), "", -200, 150)
    mel.connect_material_property(m2, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)


FALLBACK_BUILDERS = {"MM_CC_ScreenRT": _build_mm_screen, "MM_CC_Holo": _build_mm_holo}
_fallbacks = {}


def fallback_master(name):
    if name in _fallbacks:
        return _fallbacks[name]
    path = FOLDER["materials"] + "/" + name
    mat = unreal.load_asset(path) if eal.does_asset_exist(path) else None
    if mat is None:
        try:
            mat = tools.create_asset(name, FOLDER["materials"], unreal.Material, unreal.MaterialFactoryNew())
            FALLBACK_BUILDERS[name](mat)
            mel.recompile_material(mat)
            save(mat)
            log(f"fallback master {name} created")
        except Exception as e:
            manual(f"fallback master {name} could not be built by script ({e}); build it by hand (README_UE.md)")
            mat = None
    _fallbacks[name] = mat
    return mat


def build_material_instances(textures):
    mp = json.load(open(os.path.join(HERE, SPEC["materials"]["map_file"]), encoding="utf-8"))
    out = {}
    for slot, cfg in mp["slots"].items():
        use_fallback = not cfg.get("parent") and cfg.get("fallback")
        if use_fallback:
            parent = fallback_master(cfg["fallback"])
            if parent is None:
                continue
        elif not cfg.get("parent"):
            manual(f"{slot}: no parent in ue_material_map.json (run --discover, pick a game master material)")
            continue
        else:
            parent = unreal.load_asset(cfg["parent"])
        if parent is None:
            manual(f"{slot}: parent '{cfg['parent']}' not found")
            continue
        name = "MI_CC_" + slot[2:]
        path = FOLDER["materials"] + "/" + name
        mi = unreal.load_asset(path) if eal.does_asset_exist(path) else \
            tools.create_asset(name, FOLDER["materials"], unreal.MaterialInstanceConstant,
                               unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(mi, parent)
        for key, p in cfg["params"].items():
            gp = p.get("fallback_param") if use_fallback else p.get("game_param")
            if not gp:
                continue
            try:
                if p["type"] == "vector":
                    mel.set_material_instance_vector_parameter_value(mi, gp, unreal.LinearColor(*p["value"]))
                elif p["type"] == "scalar":
                    mel.set_material_instance_scalar_parameter_value(mi, gp, float(p["value"]))
                elif p["type"] == "texture" and p["value"] in textures:
                    mel.set_material_instance_texture_parameter_value(mi, gp, textures[p["value"]])
            except Exception as e:
                manual(f"{name}: parameter {gp} ({key}) failed: {e}")
        mel.update_material_instance(mi)
        save(mi)
        out[slot] = mi
    log(f"material instances: {len(out)} of {len(mp['slots'])}")
    return out


def assign_materials(meshes, mis):
    for key, mesh in meshes.items():
        slots = mesh.get_editor_property("static_materials")
        for i, sm_ in enumerate(slots):
            slot = str(sm_.get_editor_property("material_slot_name"))
            if slot in mis:
                mesh.set_material(i, mis[slot])
            else:
                manual(f"{mesh.get_name()}: section {i} '{slot}' has no MI")
        save(mesh)


def do_import():
    for f in FOLDER.values():
        eal.make_directory(f)
    textures = import_textures()
    meshes = import_meshes()
    mis = build_material_instances(textures)
    assign_materials(meshes, mis)


# ---------------------------------------------------------------------------------------------------------------------
# --content
# ---------------------------------------------------------------------------------------------------------------------
def make_blueprint(name, parent_path, folder):
    path = folder + "/" + name
    if eal.does_asset_exist(path):
        return unreal.load_asset(path)
    parent = unreal.load_class(None, parent_path)
    if parent is None:
        manual(f"{name}: parent class {parent_path} not found — create the blueprint by hand")
        return None
    fac = unreal.BlueprintFactory()
    fac.set_editor_property("parent_class", parent)
    return tools.create_asset(name, folder, None, fac)


def cdo(bp):
    return unreal.get_default_object(generated_class(bp))


def game_class(path):
    """Load a game / mod class by path. Spec values may carry a 'VERIFY: ' prefix (asset paths of the game content,
    which cannot be checked from the C++ headers)."""
    return unreal.load_class(None, path.replace("VERIFY: ", "").strip())


ITEM_CLASS = {i["item"]: i["class"] for i in SPEC["recipe"]["ingredients_tier2_proposal"]}


def item_amount(cls_or_path, amount):
    cls = game_class(cls_or_path) if isinstance(cls_or_path, str) else cls_or_path
    if cls is None:
        return None
    try:
        return unreal.ItemAmount(item_class=cls, amount=amount)          # FItemAmount: ItemClass, Amount (checked)
    except Exception:
        return None


def do_content():
    b, d, r, s = SPEC["building"], SPEC["descriptor"], SPEC["recipe"], SPEC["schematic"]
    folder = FOLDER["blueprints"]
    build_parent = "/Script/FicsitAIHelper.FAIHCommandCenter"
    if unreal.load_class(None, build_parent) is None:
        manual("C++ class AFAIHCommandCenter not compiled yet (Source/ draft) — Build_ parented to FGBuildableFactory")
        build_parent = "/Script/FactoryGame.FGBuildableFactory"
    build = make_blueprint(b["blueprint"], build_parent, folder)
    if build:
        o = cdo(build)
        mw = b["power_consumption_mw"]
        # mPowerConsumption is private in C++ but EditDefaultsOnly, so it is reachable through reflection
        if not set_prop(o, ["m_power_consumption"], mw):
            manual(f"{b['blueprint']}: Class Defaults -> Power -> Power Consumption = {mw}")
        set_prop(o, ["power_consumption_mw"], mw)                       # AFAIHCommandCenter::PowerConsumptionMW
        if not set_prop(o, ["m_can_change_potential"], False):
            manual(f"{b['blueprint']}: Productivity -> Can Change Potential = false")
        box = b["clearance_box_cm"]
        manual(f"{b['blueprint']}: Clearance Data (mClearanceData) -> one entry, Type Default, box min {box['min']} "
               f"max {box['max']} cm")
        for k, m in SPEC["meshes"].items():                   # components are set up in the BP editor (SCS)
            manual(f"{b['blueprint']}: {m['asset']} -> {m.get('component', k)}")
        save(build)
    desc = make_blueprint(d["blueprint"], d["parent_class"], folder)
    if desc:
        o = cdo(desc)
        ok = set_prop(o, ["m_display_name"], unreal.Text(b["display_name"]))
        ok &= set_prop(o, ["m_description"], unreal.Text(b["description"]))
        ok &= set_prop(o, ["m_menu_priority"], float(d["build_menu_priority"]))
        if build:
            ok &= set_prop(o, ["m_buildable_class"], generated_class(build))
        for prop, icon in (("m_small_icon", d["small_icon"]), ("m_persistent_big_icon", d["big_icon"])):
            tex = unreal.load_asset(FOLDER["icons"] + "/" + icon)
            ok &= bool(tex) and set_prop(o, [prop], tex)
        if not ok:
            manual(f"{d['blueprint']}: set Display Name, Description, Menu Priority, Buildable Class, Small/Big Icon by hand")
        manual(f"{d['blueprint']}: Organization -> Category / Sub Categories ({d['build_category']})")
        save(desc)
    rec = make_blueprint(r["blueprint"], r["parent_class"], folder)
    if rec:
        o = cdo(rec)
        ings = [item_amount(i["class"], i["amount"]) for i in r["ingredients_tier2_proposal"]]
        ok = all(ings) and set_prop(o, ["m_ingredients"], ings)
        if desc:
            prod = item_amount(generated_class(desc), 1)
            ok &= bool(prod) and set_prop(o, ["m_product"], [prod])
        if not ok:
            manual(f"{r['blueprint']}: Ingredients " + ", ".join(f"{i['item']} x{i['amount']}" for i in r["ingredients_tier2_proposal"])
                   + f"; Product {d['blueprint']} x1")
        gun = game_class(r["produced_in"])
        # mProducedIn is TArray<TSoftClassPtr<UObject>>: try the class, then a soft class path
        if not (gun and (set_prop(o, ["m_produced_in"], [gun]) or
                         set_prop(o, ["m_produced_in"], [unreal.SoftClassPath(gun.get_path_name())]))):
            manual(f"{r['blueprint']}: Produced In = Build Gun ({r['produced_in']})")
        save(rec)
    sch = make_blueprint(s["blueprint"], s["parent_class"], folder)
    if sch:
        o = cdo(sch)
        ok = set_prop(o, ["m_display_name"], unreal.Text(s["display_name"]))
        ok &= set_prop(o, ["m_tech_tier"], s["tech_tier"])
        try:
            ok &= set_prop(o, ["m_type"], getattr(unreal.SchematicType, "EST_" + s["type"].upper()))
        except Exception:
            ok = False
        cost = [item_amount(ITEM_CLASS.get(c["item"], ""), c["amount"]) for c in s["cost_proposal"]]
        ok &= all(cost) and set_prop(o, ["m_cost"], cost)
        unlocked = False
        unlock_cls = game_class(s["unlock_recipe_class"])
        if rec and unlock_cls:
            try:
                u = unreal.new_object(unlock_cls, outer=o)
                unlocked = set_prop(u, ["m_recipes"], [generated_class(rec)]) and set_prop(o, ["m_unlocks"], [u])
            except Exception:
                unlocked = False
        if not ok:
            manual(f"{s['blueprint']}: Type = {s['type']}, Tech Tier = {s['tech_tier']}, Display Name, Cost = "
                   + ", ".join(f"{c['item']} x{c['amount']}" for c in s["cost_proposal"]))
        if not unlocked:
            manual(f"{s['blueprint']}: Unlocks -> + {s['unlock_recipe_class'].split('.')[-1]} -> Recipes = {r['blueprint']}")
        manual(f"{s['blueprint']}: register in the mod's GameWorldModule blueprint (UGameWorldModule::mSchematics)")
        save(sch)


# ---------------------------------------------------------------------------------------------------------------------
# --verify
# ---------------------------------------------------------------------------------------------------------------------
def do_verify():
    sms = subsystem("StaticMeshEditorSubsystem")
    for key, m in SPEC["meshes"].items():
        mesh = unreal.load_asset(FOLDER["meshes"] + "/" + m["asset"])
        if mesh is None:
            log(f"{m['asset']}: MISSING")
            continue
        lods = sms.get_lod_count(mesh) if sms else "?"
        coll = sms.get_convex_collision_count(mesh) if sms and hasattr(sms, "get_convex_collision_count") else "?"
        # StaticMesh.sockets is not exposed to Python in 5.6: look the expected sockets up one by one
        want = m.get("sockets", [])
        found = [n for n in want if mesh.find_socket(n)]
        socks = f"{len(found)}/{len(want)}" + (f" missing {sorted(set(want) - set(found))}" if len(found) < len(want) else "")
        mats = [(str(x.get_editor_property("material_slot_name")),
                 x.get_editor_property("material_interface").get_name() if x.get_editor_property("material_interface") else None)
                for x in mesh.get_editor_property("static_materials")]
        try:
            nanite = mesh.get_editor_property("nanite_settings").get_editor_property("enabled")
        except Exception:
            nanite = "?"
        bounds = mesh.get_bounds()
        log(f"{m['asset']}: LODs {lods} (want {1 + len(m['lods'])}), UCX {coll}, sockets {socks}, nanite {nanite}, "
            f"box extent {bounds.box_extent} (want ~800 x 400 cm half-size for the exterior)")
        for slot, mi in mats:
            log(f"    section {slot}: {mi}")


def main(argv):
    if "--discover" in argv:
        discover()
    if "--import" in argv:
        do_import()
    if "--content" in argv:
        do_content()
    if "--verify" in argv or len(argv) == 0:
        do_verify()
    if MANUAL:
        log(f"{len(MANUAL)} manual step(s):")
        for i, m in enumerate(MANUAL, 1):
            log(f"  {i}. {m}")
        with open(os.path.join(HERE, "ue_manual_steps.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(MANUAL) + "\n")


main(sys.argv[1:])
