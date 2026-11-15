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
| `assets/head.glb` | Modèle 3D : 187 structures, environ 580 000 triangles, 4 Mo |
| `vendor/three/` | three.js r170 (licence MIT) |
| `tools/` | Script qui reconstruit le modèle à partir des maillages d'origine |

## Sources et limites

- **Modèle anatomique** : [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/) 3.0,
  © The Database Center for Life Science, licence
  [CC BY-SA 2.1 Japon](https://creativecommons.org/licenses/by-sa/2.1/jp/deed.fr), via le miroir
  STL [Kevin-Mattheus-Moerman/BodyParts3D](https://github.com/Kevin-Mattheus-Moerman/BodyParts3D).
  Les maillages ont été recadrés sur la tête et le cou, simplifiés et compressés ;
  `assets/head.glb` est donc distribué sous la même licence.
- **Unités d'action** : *Facial Action Coding System* (Ekman, Friesen et Hager). Les
  combinaisons retenues sont les expressions prototypiques ; une micro-expression réelle
  n'en montre souvent qu'une partie.
- **Muscles absents du modèle** : le releveur de la paupière supérieure (AU 5) et
  l'abaisseur du sourcil (AU 4) n'existent pas dans BodyParts3D. Ils sont cités dans les
  fiches d'émotion avec la mention « absent du modèle 3D ».
- **Muscle frontal** : le modèle n'en sépare pas les fibres médiales (AU 1) et latérales (AU 2).
- **Correction apportée aux données sources** : BodyParts3D 3.0 intervertit les noms des
  parties orbitaire et palpébrale de l'orbiculaire de l'œil ; `js/data.js` les remet à l'endroit.
- **Mépris** : l'expression est unilatérale ; le côté gauche du sujet est montré par convention.

## Reconstruire le modèle

```bash
pip install trimesh fast-simplification numpy
```

```bash
python3 tools/build_model.py --download
```

```bash
npx @gltf-transform/cli meshopt build/head.raw.glb assets/head.glb --level medium
```

La liste des structures retenues est dans `tools/parts.tsv`.
