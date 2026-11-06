"""Build-menu icon for the Command Center (stage 7): transparent background, three-quarter view from the front-left.

    python render_icon.py [--out ../ue/icons] [--samples 64]

Writes IconDesc_CommandCenter_512.png and _256.png (Satisfactory uses 256 small / 512 big icons, transparent).
Uses the stage-5 preview materials (atlases, hologram look); reference objects (foundations, capsules) are hidden.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: F401

import build_model
import cc_lib

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "..", "ue", "icons"))
    ap.add_argument("--samples", type=int, default=64)
    a = ap.parse_args(sys.argv[1:])
    cc_lib.reset_scene()
    mats = cc_lib.make_materials()
    exp = cc_lib.collection("EXPORT")
    ref = cc_lib.collection("REF_NOT_EXPORTED")
    build_model.build(mats, exp, ref)
    for ob in ref.objects:
        ob.hide_render = True
    for hook in cc_lib.PREVIEW_HOOKS:
        hook()
    cc_lib.setup_render(res=(512, 512), samples=a.samples)
    s = bpy.context.scene
    s.render.film_transparent = True
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGBA"
    s.camera = cc_lib.camera("CAM_icon", (-15.5, -19.0, 9.5), (-0.9, 0.0, 3.4), None, 43)
    os.makedirs(a.out, exist_ok=True)
    p512 = os.path.join(a.out, "IconDesc_CommandCenter_512.png")
    s.render.filepath = p512
    bpy.ops.render.render(write_still=True)
    s.render.resolution_x = s.render.resolution_y = 256
    s.render.filepath = os.path.join(a.out, "IconDesc_CommandCenter_256.png")
    bpy.ops.render.render(write_still=True)
    print("[icon] written", a.out)


if __name__ == "__main__":
    main()
