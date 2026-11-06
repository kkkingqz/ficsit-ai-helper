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

THIS SCRIPT HAS NOT BEEN RUN IN AN EDITOR YET (written without UE access). Every call that depends on the engine or
FactoryGame version is wrapped; on failure the script prints what to do by hand instead of stopping.
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
            eal.save_loaded_asset(tex)
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
                    eal.save_loaded_asset(tex)
                except Exception:
                    pass
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
                      ("one_convex_hull_per_ucx", True), ("build_nanite", imp["nanite"]), ("import_mesh_lo_ds", False)):
        if not set_prop(sm, [prop], val):
            manual(f"FBX option '{prop}' = {val} could not be set by script; set it in the import dialog")
    try:
        sm.set_editor_property("normal_import_method", unreal.FBXNormalImportMethod.FBXNIM_IMPORT_NORMALS_AND_TANGENTS)
    except Exception:
        manual("FBX option Normal Import Method = Import Normals and Tangents")
    return ui


def import_meshes():
    sms = subsystem("StaticMeshEditorSubsystem")
    meshes = {}
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
            mesh.set_editor_property("nanite_settings", ns)
        except Exception:
            manual(f"{m['asset']}: Nanite off (Details -> Nanite Settings -> Enabled = false)")
        screen = m["screen_sizes"]
        done = False
        if sms and hasattr(sms, "set_lod_screen_sizes"):
            try:
                sms.set_lod_screen_sizes(mesh, screen)
                done = True
            except Exception:
                done = False
        if not done:
            manual(f"{m['asset']}: LOD Settings -> Auto Compute LOD Distances = off, screen sizes {screen}")
        eal.save_loaded_asset(mesh)
        meshes[key] = mesh
    log(f"meshes: {len(meshes)} imported")
    return meshes


def build_material_instances(textures):
    mp = json.load(open(os.path.join(HERE, SPEC["materials"]["map_file"]), encoding="utf-8"))
    out = {}
    for slot, cfg in mp["slots"].items():
        if not cfg.get("parent"):
            manual(f"{slot}: no parent in ue_material_map.json (run --discover, pick a game master material)")
            continue
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
            gp = p.get("game_param")
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
        eal.save_loaded_asset(mi)
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
        eal.save_loaded_asset(mesh)


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
    return unreal.get_default_object(bp.generated_class())


def item_amount(cls_path, amount):
    cls = unreal.load_class(None, cls_path.replace("VERIFY: ", ""))
    if cls is None:
        return None
    try:
        return unreal.ItemAmount(item_class=cls, amount=amount)
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
        if not set_prop(o, ["m_power_consumption", "mPowerConsumption"], b["power_consumption_mw"]):
            manual(f"{b['blueprint']}: Power Consumption = {b['power_consumption_mw']} MW")
        for k, m in SPEC["meshes"].items():                   # components are set up in the BP editor (SCS)
            manual(f"{b['blueprint']}: {m['asset']} -> {m.get('component', k)}")
        eal.save_loaded_asset(build)
    desc = make_blueprint(d["blueprint"], d["parent_class"], folder)
    if desc:
        o = cdo(desc)
        ok = set_prop(o, ["m_display_name", "mDisplayName"], unreal.Text(b["display_name"]))
        ok &= set_prop(o, ["m_description", "mDescription"], unreal.Text(b["description"]))
        if build:
            ok &= set_prop(o, ["m_buildable_class", "mBuildableClass"], build.generated_class())
        for prop, icon in ((["m_small_icon", "mSmallIcon"], d["small_icon"]), (["m_persistent_big_icon", "mPersistentBigIcon"], d["big_icon"])):
            tex = unreal.load_asset(FOLDER["icons"] + "/" + icon)
            ok &= bool(tex) and set_prop(o, prop, tex)
        if not ok:
            manual(f"{d['blueprint']}: set Display Name, Description, Buildable Class, Small/Big Icon by hand")
        manual(f"{d['blueprint']}: Build Category / Sub Categories ({d['build_category']})")
        eal.save_loaded_asset(desc)
    rec = make_blueprint(r["blueprint"], r["parent_class"], folder)
    if rec:
        o = cdo(rec)
        ings = [item_amount(i["class"], i["amount"]) for i in r["ingredients_tier2_proposal"]]
        ok = all(ings) and set_prop(o, ["m_ingredients", "mIngredients"], ings)
        if desc:
            prod = item_amount(desc.generated_class().get_path_name(), 1)
            ok &= bool(prod) and set_prop(o, ["m_product", "mProduct"], [prod])
        if not ok:
            manual(f"{r['blueprint']}: Ingredients " + ", ".join(f"{i['item']} x{i['amount']}" for i in r["ingredients_tier2_proposal"])
                   + f"; Product {d['blueprint']} x1")
        manual(f"{r['blueprint']}: Produced In = Build Gun ({r['produced_in']})")
        eal.save_loaded_asset(rec)
    sch = make_blueprint(s["blueprint"], s["parent_class"], folder)
    if sch:
        o = cdo(sch)
        set_prop(o, ["m_display_name", "mDisplayName"], unreal.Text(s["display_name"]))
        set_prop(o, ["m_tech_tier", "mTechTier"], s["tech_tier"])
        manual(f"{s['blueprint']}: Type = Milestone, Tech Tier = {s['tech_tier']}, Cost = "
               + ", ".join(f"{c['item']} x{c['amount']}" for c in s["cost_proposal"])
               + f", Unlocks -> Unlock Recipe {r['blueprint']}; register in the mod's GameWorldModule (mSchematics)")
        eal.save_loaded_asset(sch)


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
        socks = [str(x.get_editor_property("socket_name")) for x in mesh.get_editor_property("sockets")]
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
