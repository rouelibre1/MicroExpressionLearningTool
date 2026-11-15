#!/usr/bin/env python3
"""Construit assets/head.glb à partir des maillages de BodyParts3D.

Sources des maillages, (c) The Database Center for Life Science, licence
CC BY-SA 2.1 Japan :
- BodyParts3D 3.0, miroir STL https://github.com/Kevin-Mattheus-Moerman/BodyParts3D
- BodyParts3D 4.3, miroir OBJ https://github.com/olivercase/body_parts_3d_api
  pour le releveur de la paupière supérieure, absent de la version 3.0. Les deux
  versions n'ont pas le même repère : ce muscle est recalé sur le globe oculaire.
L'abaisseur du sourcil n'existe dans aucune des deux versions : il est modélisé
ici, de façon schématique, sur la surface osseuse du modèle.

Usage :
    pip install trimesh fast-simplification numpy
    python3 tools/build_model.py --download   # télécharge les STL puis construit
    python3 tools/build_model.py --stl DIR    # construit depuis des maillages déjà présents

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
import urllib.parse
import urllib.request

import numpy as np
import trimesh
import fast_simplification

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW_URL = ("https://raw.githubusercontent.com/Kevin-Mattheus-Moerman/BodyParts3D/"
           "main/assets/BodyParts3D_data/stl/{}.stl")

BP3D43_URL = "https://media.githubusercontent.com/media/olivercase/body_parts_3d_api/main/meshes/{}"
BP3D43_FILES = {
    "FJ1306": "FJ1306_BP20561_FMA49049_Left levator palpebrae superioris.obj",
    "FJ1357": "FJ1357_BP21297_FMA49048_Right levator palpebrae superioris.obj",
    # globes oculaires de la version 4.3 : repères du recalage
    "FJ1317": "FJ1317_BP23104_FMA58272_Left sclera.obj",
    "FJ1289": "FJ1289_BP23245_FMA58240_Left cornea.obj",
    "FJ1368": "FJ1368_BP23243_FMA58271_Right sclera.obj",
    "FJ1340": "FJ1340_BP23300_FMA58239_Right cornea.obj",
}
EYE_REF_43 = {"L": ("FJ1317", "FJ1289"), "R": ("FJ1368", "FJ1340")}
EYEBALL_30 = "FMA12513"
# os sur lesquels repose l'abaisseur du sourcil : frontal, maxillaires, os nasaux et lacrymaux
BROW_BONES = ("FMA52734", "FMA53649", "FMA53650", "FMA53647", "FMA53648", "FMA53645", "FMA53646")

# Origine du modèle (mm, repère BodyParts3D : X gauche, -Y avant, Z haut)
CENTER = np.array([0.0, -95.0, 1480.0])
SCALE = 0.1  # mm -> cm
SKIN_ID = "FMA7163"
SKIN_Z_MIN = 1335.0   # la peau est coupée sous les clavicules
CUT_Z_MIN = 1290.0    # tout le reste est coupé sous le manubrium


def read_parts():
    """Lit tools/parts.tsv : identifiant, nom anglais, source (vide = BodyParts3D 3.0)."""
    parts = []
    with open(os.path.join(HERE, "parts.tsv"), encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line or line.startswith("#"):
                continue
            cols = line.split("\t")
            parts.append((cols[0], cols[1], cols[2] if len(cols) > 2 else ""))
    return parts


def fetch(url, dst):
    if os.path.exists(dst):
        return
    print("téléchargement", os.path.basename(dst), file=sys.stderr)
    urllib.request.urlretrieve(url, dst)


def download(parts, stl_dir):
    os.makedirs(stl_dir, exist_ok=True)
    for ident, _, source in parts:
        if source == "":
            fetch(RAW_URL.format(ident), os.path.join(stl_dir, ident + ".stl"))
    for ident, filename in BP3D43_FILES.items():
        fetch(BP3D43_URL.format(urllib.parse.quote(filename)), os.path.join(stl_dir, ident + ".obj"))


def side_of(name):
    return "L" if "left " in name else "R"


def eye_sphere(vertices, side):
    """Centre et rayon du globe oculaire d'un côté (X positif = gauche du sujet)."""
    v = vertices[vertices[:, 0] > 0] if side == "L" else vertices[vertices[:, 0] < 0]
    lo, hi = v.min(axis=0), v.max(axis=0)
    # rayon mesuré en largeur et en hauteur : la cornée allonge le globe d'avant en arrière
    return (lo + hi) / 2, ((hi - lo)[0] + (hi - lo)[2]) / 4


def load_bp3d43(ident, name, stl_dir):
    """Charge un maillage 4.3 et le recale sur le globe oculaire du modèle 3.0.

    Les versions 3.0 et 4.3 diffèrent de plusieurs millimètres et n'ont pas la même
    taille de globe : similitude (translation + échelle) qui superpose les deux globes.
    """
    side = side_of(name)
    mesh = trimesh.load(os.path.join(stl_dir, ident + ".obj"), force="mesh", process=True)
    ref = np.vstack([trimesh.load(os.path.join(stl_dir, r + ".obj"), force="mesh").vertices
                     for r in EYE_REF_43[side]])
    c43, r43 = eye_sphere(ref, side)
    c30, r30 = eye_sphere(trimesh.load(os.path.join(stl_dir, EYEBALL_30 + ".stl")).vertices, side)
    mesh.vertices = c30 + (np.asarray(mesh.vertices) - c43) * (r30 / r43)
    print(f"  recalage {side} : échelle {r30 / r43:.3f}, translation {np.round(c30 - c43, 1)} mm",
          file=sys.stderr)
    return mesh


def anterior_surface(meshes):
    """Renvoie y(x, z) : la surface la plus antérieure (Y minimal) d'un ensemble de maillages."""
    tri = np.concatenate([np.asarray(m.triangles) for m in meshes])
    a, e1, e2 = tri[:, 0], tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    den = e1[:, 0] * e2[:, 2] - e1[:, 2] * e2[:, 0]
    ok = np.abs(den) > 1e-9

    def y_at(x, z):
        px, pz = x - a[:, 0], z - a[:, 2]
        with np.errstate(divide="ignore", invalid="ignore"):
            u = (px * e2[:, 2] - pz * e2[:, 0]) / den
            v = (e1[:, 0] * pz - e1[:, 2] * px) / den
            hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1)
        if not hit.any():
            return np.nan
        return float((a[hit, 1] + u[hit] * e1[hit, 1] + v[hit] * e2[hit, 1]).min())

    return y_at


def model_depressor_supercilii(name, stl_dir):
    """Modélise l'abaisseur du sourcil : absent de BodyParts3D, reconstitution schématique.

    Petit faisceau posé sur le rebord médial de l'orbite : il naît du processus frontal du
    maxillaire, au-dessus du ligament palpébral médial, longe le rebord puis s'incline en
    dehors et s'élargit jusqu'à la peau de la tête du sourcil. Repères pris sur le modèle
    (côté droit, X et Z en mm) : canthus médial (-13,6 ; 1525,7), rebord orbitaire médial
    vers X = -12, tête du sourcil (-15,1 ; 1548,2).
    """
    sign = 1.0 if side_of(name) == "L" else -1.0
    y_at = anterior_surface([trimesh.load(os.path.join(stl_dir, b + ".stl")) for b in BROW_BONES])
    nt, nu = 22, 9
    t = np.linspace(0, 1, nt)[:, None]
    u = np.linspace(-1, 1, nu)[None, :]
    width = 4.2 + 2.4 * t                       # s'élargit vers le sourcil
    x = sign * (9.5 + 5.0 * t ** 2) + u * width / 2
    z = 1531.0 + 17.5 * t + 0 * u
    with np.errstate(invalid="ignore"):
        bone = np.array([[y_at(x[i, j], z[i, j]) for j in range(nu)] for i in range(nt)])
        # un point qui tombe dans l'ouverture de l'orbite touche l'os loin en arrière : écarté
        bone[bone > np.nanmin(bone, axis=1, keepdims=True) + 9.0] = np.nan
    if np.isnan(bone).any():                    # hors de l'os : valeur du voisin le plus proche
        good = np.argwhere(~np.isnan(bone))
        for i, j in np.argwhere(np.isnan(bone)):
            k = good[np.abs(good - [i, j]).sum(axis=1).argmin()]
            bone[i, j] = bone[k[0], k[1]]
    for _ in range(2):                          # lisse le relief de l'os
        pad = np.pad(bone, 1, mode="edge")
        bone = (pad[:-2, 1:-1] + pad[2:, 1:-1] + pad[1:-1, :-2] + pad[1:-1, 2:] + 4 * bone) / 8
    lift = 0.9 + 2.6 * t ** 1.5                 # se détache de l'os pour rejoindre la peau
    thick = 1.6 * (1 - 0.6 * u ** 2) * np.clip(np.sin(np.pi * t) * 3, 0.3, 1)
    front = np.dstack([x, bone - lift - thick / 2, z]).reshape(-1, 3)
    back = np.dstack([x, bone - lift + thick / 2, z]).reshape(-1, 3)
    faces = []
    n = nt * nu
    for i in range(nt - 1):
        for j in range(nu - 1):
            p, q, r, w = i * nu + j, i * nu + j + 1, (i + 1) * nu + j, (i + 1) * nu + j + 1
            faces += [[p, q, r], [q, w, r], [n + p, n + r, n + q], [n + q, n + r, n + w]]
    rim = ([(i, 0) for i in range(nt)] + [(nt - 1, j) for j in range(1, nu)]
           + [(i, nu - 1) for i in range(nt - 2, -1, -1)] + [(0, j) for j in range(nu - 2, 0, -1)])
    for (i0, j0), (i1, j1) in zip(rim, rim[1:] + rim[:1]):
        p, q = i0 * nu + j0, i1 * nu + j1
        faces += [[p, q, n + p], [q, n + q, n + p]]
    return trimesh.Trimesh(np.vstack([front, back]), np.array(faces), process=True)


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


def load_source(ident, name, source, stl_dir):
    """Maillage d'une structure, en millimètres dans le repère de BodyParts3D 3.0."""
    if source == "bp3d43":
        return load_bp3d43(ident, name, stl_dir)
    if source == "modele":
        return model_depressor_supercilii(name, stl_dir)
    return trimesh.load(os.path.join(stl_dir, ident + ".stl"), process=True)  # soude les sommets du STL


def process(fma, mesh):
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
    body = ",".join(f"{json.dumps(ident)}: {json.dumps(name)}" for ident, name, _ in parts)
    with open(os.path.join(ROOT, "js", "parts.js"), "w", encoding="utf-8") as fh:
        fh.write("// Généré depuis tools/parts.tsv — identifiant du maillage -> nom anglais de la structure\n")
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
    for ident, name, source in parts:
        mesh = process(ident, load_source(ident, name, source, args.stl))
        total += len(mesh.faces)
        scene.add_geometry(mesh, node_name=ident, geom_name=ident)
        print(f"{ident:10s} {len(mesh.faces):6d} tri  {name}", file=sys.stderr)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    scene.export(args.out)
    print(f"{len(parts)} structures, {total} triangles -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
