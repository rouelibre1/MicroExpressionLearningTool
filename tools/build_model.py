#!/usr/bin/env python3
"""Construit assets/head.glb à partir des maillages STL de BodyParts3D.

Source des maillages : BodyParts3D 3.0, (c) The Database Center for Life
Science, licence CC BY-SA 2.1 Japan — récupérés depuis le miroir STL
https://github.com/Kevin-Mattheus-Moerman/BodyParts3D

Usage :
    pip install trimesh fast-simplification numpy
    python3 tools/build_model.py --download   # télécharge les STL puis construit
    python3 tools/build_model.py --stl DIR    # construit depuis des STL déjà présents

Le GLB produit contient un maillage par structure, nommé par son identifiant
FMA (ex. « FMA46812 » = grand zygomatique droit). Repère : Y vers le haut,
visage tourné vers +Z, gauche du sujet vers +X, unité = 1 cm.
Le fichier publié est ensuite compressé (Meshopt) :
    npx @gltf-transform/cli meshopt build/head.raw.glb assets/head.glb --level medium
"""
import argparse
import json
import os
import sys
import urllib.request

import numpy as np
import trimesh
import fast_simplification

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW_URL = ("https://raw.githubusercontent.com/Kevin-Mattheus-Moerman/BodyParts3D/"
           "main/assets/BodyParts3D_data/stl/{}.stl")

# Origine du modèle (mm, repère BodyParts3D : X gauche, -Y avant, Z haut)
CENTER = np.array([0.0, -95.0, 1480.0])
SCALE = 0.1  # mm -> cm
SKIN_ID = "FMA7163"
SKIN_Z_MIN = 1335.0   # la peau est coupée sous les clavicules
CUT_Z_MIN = 1290.0    # tout le reste est coupé sous le manubrium


def read_parts():
    parts = []
    with open(os.path.join(HERE, "parts.tsv"), encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line or line.startswith("#"):
                continue
            fma, name = line.split("\t")[:2]
            parts.append((fma, name))
    return parts


def download(parts, stl_dir):
    os.makedirs(stl_dir, exist_ok=True)
    for fma, _ in parts:
        dst = os.path.join(stl_dir, fma + ".stl")
        if os.path.exists(dst):
            continue
        print("téléchargement", fma, file=sys.stderr)
        urllib.request.urlretrieve(RAW_URL.format(fma), dst)


def target_faces(fma, n_faces):
    if fma == SKIN_ID:
        return 60000
    return int(min(max(n_faces * 0.22, 1200), 9000))


def crop_below(mesh, z_min):
    """Supprime les triangles entièrement situés sous z_min."""
    keep = (mesh.vertices[:, 2][mesh.faces] > z_min).any(axis=1)
    mesh.update_faces(keep)
    mesh.remove_unreferenced_vertices()
    return mesh


def process(fma, path):
    mesh = trimesh.load(path, process=True)  # soude les sommets dupliqués du STL
    if fma == SKIN_ID:
        crop_below(mesh, SKIN_Z_MIN)
    elif mesh.bounds[0][2] < CUT_Z_MIN:
        crop_below(mesh, CUT_Z_MIN)
    n = len(mesh.faces)
    tgt = target_faces(fma, n)
    if n > tgt:
        v, f = fast_simplification.simplify(
            np.asarray(mesh.vertices, dtype=np.float32),
            np.asarray(mesh.faces, dtype=np.int32),
            target_count=tgt, agg=5)
        mesh = trimesh.Trimesh(v, f, process=True)
    # mm (Z haut, -Y avant) -> cm (Y haut, +Z avant)
    p = (np.asarray(mesh.vertices, dtype=np.float64) - CENTER) * SCALE
    mesh.vertices = np.column_stack([p[:, 0], p[:, 2], -p[:, 1]])
    if fma != SKIN_ID:
        mesh.fix_normals()  # faces orientées vers l'extérieur
    _ = mesh.vertex_normals
    mesh.visual = trimesh.visual.ColorVisuals(mesh)
    return mesh


def write_parts_js(parts):
    """Écrit js/parts.js : la table identifiant FMA -> nom anglais lue par l'application."""
    body = ",".join(f"{json.dumps(fma)}: {json.dumps(name)}" for fma, name in parts)
    with open(os.path.join(ROOT, "js", "parts.js"), "w", encoding="utf-8") as fh:
        fh.write("// Généré depuis tools/parts.tsv — identifiant FMA -> nom anglais BodyParts3D\n")
        fh.write("export const PARTS = {" + body + "};\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stl", default=os.path.join(ROOT, "build", "stl"))
    ap.add_argument("--download", action="store_true")
    ap.add_argument("--out", default=os.path.join(ROOT, "build", "head.raw.glb"))
    args = ap.parse_args()

    parts = read_parts()
    write_parts_js(parts)
    if args.download:
        download(parts, args.stl)

    scene = trimesh.Scene()
    total = 0
    for fma, name in parts:
        path = os.path.join(args.stl, fma + ".stl")
        mesh = process(fma, path)
        total += len(mesh.faces)
        scene.add_geometry(mesh, node_name=fma, geom_name=fma)
        print(f"{fma:10s} {len(mesh.faces):6d} tri  {name}", file=sys.stderr)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    scene.export(args.out)
    print(f"{len(parts)} structures, {total} triangles -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
