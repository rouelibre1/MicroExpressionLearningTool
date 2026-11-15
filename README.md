# Écorché des micro-expressions

Atlas 3D interactif de la tête et du cou, peau retirée, pour apprendre les muscles
qui produisent les expressions des sept émotions universelles : joie, tristesse,
colère, peur, surprise, dégoût et mépris.

## Ce que fait l'outil

- **Explorer en 3D** : glisser pour tourner, molette ou pincement pour zoomer, clic droit (ou deux doigts) pour déplacer.
- **Nommer un muscle** : survoler une structure affiche son nom ; cliquer un muscle le met en
  surbrillance et ouvre sa fiche (nom français, nom latin, action, origine, terminaison,
  unités d'action FACS, émotions concernées).
- **Choisir une émotion** : les muscles en jeu passent en surbrillance, reliés à leur nom par
  des traits de rappel ; le panneau détaille chaque unité d'action et le muscle qui la produit.
- **Chercher** un muscle par son nom français, son nom latin ou une unité d'action (« AU 12 »).
- **Affichage** : peau en transparence, squelette, isolement de la sélection, étiquettes ; vues de face, de trois-quarts, de profil et de dos.

Un lien peut ouvrir directement une émotion : `index.html#joie`, `#tristesse`, `#colere`,
`#peur`, `#surprise`, `#degout`, `#mepris`.

## Lancer le site

Le site est statique, sans étape de compilation. Il doit être servi en HTTP
(les modules JavaScript ne se chargent pas depuis `file://`) :

```bash
python3 -m http.server 8000
```

puis ouvrir <http://localhost:8000>. Pour le mettre en ligne, n'importe quel hébergement
statique convient ; avec GitHub Pages : *Settings → Pages → Deploy from a branch*, dossier racine.

## Organisation

| Chemin | Contenu |
| --- | --- |
| `index.html`, `css/style.css` | Page et mise en forme |
| `js/app.js` | Scène 3D, sélection, étiquettes, interface |
| `js/data.js` | Muscles, unités d'action, émotions : tout le contenu pédagogique |
| `js/parts.js` | Table identifiant FMA → nom de la structure (générée) |
| `assets/head.glb` | Modèle 3D : 195 structures, environ 589 000 triangles, 4 Mo |
| | Sur un hébergement qui ne sert pas les `.glb`, encoder le fichier en base64 dans un `.txt` et l'indiquer par `data-model="…"` sur le `<canvas id="scene">` |
| `vendor/three/` | three.js r170 (licence MIT) |
| `tools/` | Script qui reconstruit le modèle à partir des maillages d'origine |

## Sources et limites

- **Modèle anatomique** : [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/),
  © The Database Center for Life Science, licence
  [CC BY-SA 2.1 Japon](https://creativecommons.org/licenses/by-sa/2.1/jp/deed.fr). Version 3.0 via le
  miroir STL [Kevin-Mattheus-Moerman/BodyParts3D](https://github.com/Kevin-Mattheus-Moerman/BodyParts3D) ;
  version 4.3 via le miroir OBJ [olivercase/body_parts_3d_api](https://github.com/olivercase/body_parts_3d_api)
  pour le releveur de la paupière supérieure. Les maillages ont été recadrés sur la tête et le
  cou, simplifiés et compressés ; `assets/head.glb` est donc distribué sous la même licence.
- **Unités d'action** : *Facial Action Coding System* (Ekman, Friesen et Hager). Les
  combinaisons retenues sont les expressions prototypiques ; une micro-expression réelle
  n'en montre souvent qu'une partie.
- **Releveur de la paupière supérieure** (AU 5) : absent de la version 3.0, il vient de la
  version 4.3. Les deux versions n'ont ni le même repère ni la même taille de globe oculaire :
  le muscle est recalé sur le globe du modèle (translation et échelle), et se loge sous le
  toit de l'orbite à 3 mm près.
- **Abaisseur du sourcil** (AU 4) : absent de BodyParts3D. C'est une **reconstitution
  schématique**, modélisée par `tools/build_model.py` sur le rebord médial de l'orbite d'après
  la description anatomique du muscle ; sa forme et sa position sont approximatives, et sa
  fiche le signale.
- **Muscle tarsal supérieur** (muscle de Müller, renfort involontaire de l'AU 5 dans la peur) :
  absent de BodyParts3D 3.0 et 4.3 comme de Z-Anatomy. C'est une **reconstitution** : une nappe
  tendue entre ses deux attaches, qui sont des maillages réels de la version 4.3 (face profonde
  du releveur de la paupière et bord supérieur du tarse). Sa forme est approximative, et sa
  fiche le signale.
- **Muscle frontal** : c'est un seul muscle, que le FACS divise en fibres médiales (AU 1) et
  latérales (AU 2). Aucune base ne les sépare ; le maillage réel du muscle est coupé en deux
  par convention à l'aplomb de la pupille.
- **Correction apportée aux données sources** : BodyParts3D 3.0 intervertit les noms des
  parties orbitaire et palpébrale de l'orbiculaire de l'œil ; `js/data.js` les remet à l'endroit.
- **Mépris** : l'expression est unilatérale ; le côté gauche du sujet est montré par convention.

## Reconstruire le modèle

```bash
pip install trimesh fast-simplification numpy shapely mapbox-earcut networkx
```

```bash
python3 tools/build_model.py --download
```

```bash
npx @gltf-transform/cli meshopt build/head.raw.glb assets/head.glb --level medium
```

La liste des structures retenues est dans `tools/parts.tsv`.
