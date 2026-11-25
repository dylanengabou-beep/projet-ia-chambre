"""Génère la documentation Word du projet à partir des fichiers Markdown (README + docs/).

Utilisation : python scripts/generer-word.py
Résultat     : docs/Documentation_Projet_IA_Chambre.docx
"""
import re
from datetime import date
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

RACINE = Path(__file__).resolve().parent.parent
SORTIE = RACINE / "docs" / "Documentation_Projet_IA_Chambre.docx"
PARTIES = ["01-installation-vm.md", "02-integration-claude.md", "03-assistant-vocal.md",
           "04-voix-elevenlabs-et-led-govee.md", "05-sarah-programme-bureau.md"]
BLEU = RGBColor(0x1F, 0x4E, 0x79)
LARGEUR_UTILE = Cm(16)

doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
for m in ("left_margin", "right_margin"):
    setattr(sec, m, Cm(2.5))
sec.top_margin = sec.bottom_margin = Cm(2.2)

st = doc.styles
st["Normal"].font.name = "Calibri"
st["Normal"].font.size = Pt(11)
st["Normal"].paragraph_format.space_after = Pt(6)
for nom, taille in (("Title", 30), ("Heading 1", 20), ("Heading 2", 15), ("Heading 3", 12.5)):
    s = st[nom]
    s.font.name = "Calibri"
    s.font.size = Pt(taille)
    s.font.bold = True
    s.font.color.rgb = BLEU
    s.paragraph_format.keep_with_next = True
    s.paragraph_format.space_before = Pt(14 if nom != "Title" else 0)
    s.paragraph_format.space_after = Pt(6)


def ombrer(cellule, couleur):
    tcPr = cellule._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), couleur)
    tcPr.append(shd)


def bordure_gauche(paragraphe, couleur="1F4E79"):
    pPr = paragraphe._p.get_or_add_pPr()
    b = OxmlElement("w:pBdr")
    g = OxmlElement("w:left")
    for k, v in (("val", "single"), ("sz", "18"), ("space", "8"), ("color", couleur)):
        g.set(qn("w:" + k), v)
    b.append(g)
    pPr.append(b)


def texte_riche(paragraphe, texte):
    """Gère **gras**, `code` et [liens](url) (le lien devient du texte)."""
    texte = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", texte)
    for morceau in re.split(r"(\*\*[^*]+\*\*|`[^`]+`)", texte):
        if not morceau:
            continue
        if morceau.startswith("**"):
            paragraphe.add_run(morceau[2:-2]).bold = True
        elif morceau.startswith("`"):
            r = paragraphe.add_run(morceau[1:-1])
            r.font.name = "Consolas"
            r.font.size = Pt(9.5)
            r.font.color.rgb = RGBColor(0xA3, 0x15, 0x15)
        else:
            paragraphe.add_run(morceau)


def image(chemin, legende, largeur=LARGEUR_UTILE):
    if not chemin.exists():
        return
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_with_next = True
    p.add_run().add_picture(str(chemin), width=largeur)
    c = doc.add_paragraph()
    c.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = c.add_run(legende)
    r.italic = True
    r.font.size = Pt(9)
    r.font.color.rgb = RGBColor(0x59, 0x59, 0x59)


def tableau(lignes, dossier):
    cellules = [[c.strip() for c in l.strip().strip("|").split("|")] for l in lignes]
    cellules = [l for l in cellules if not all(re.fullmatch(r":?-{3,}:?", c) for c in l)]
    # tableau de deux images côte à côte
    if all(re.match(r"!\[", c) for c in cellules[-1]):
        t = doc.add_table(rows=2, cols=len(cellules[0]))
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        for j, titre in enumerate(cellules[0]):
            t.cell(0, j).paragraphs[0].add_run(titre).bold = True
            t.cell(0, j).paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            m = re.match(r"!\[[^\]]*\]\(([^)]+)\)", cellules[-1][j])
            t.cell(1, j).paragraphs[0].add_run().add_picture(
                str((dossier / m.group(1)).resolve()), width=Cm(7.8))
        doc.add_paragraph()
        return
    n = max(len(l) for l in cellules)
    t = doc.add_table(rows=len(cellules), cols=n)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, l in enumerate(cellules):
        for j in range(n):
            cel = t.cell(i, j)
            p = cel.paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            texte_riche(p, l[j] if j < len(l) else "")
            for r in p.runs:
                r.font.size = Pt(10)
                if i == 0:
                    r.bold = True
                    r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
            if i == 0:
                ombrer(cel, "1F4E79")
            elif i % 2 == 0:
                ombrer(cel, "EAF1F8")
    doc.add_paragraph()


def code(lignes):
    t = doc.add_table(rows=1, cols=1)
    trPr = t.rows[0]._tr.get_or_add_trPr()
    trPr.append(OxmlElement("w:cantSplit"))  # le bloc ne se coupe pas entre deux pages
    cel = t.cell(0, 0)
    ombrer(cel, "F2F2F2")
    p = cel.paragraphs[0]
    for i, l in enumerate(lignes):
        r = p.add_run(l)
        r.font.name = "Consolas"
        r.font.size = Pt(9)
        if i < len(lignes) - 1:
            r.add_break()
    doc.add_paragraph()


def markdown(fichier, niveau_titre=1):
    dossier = fichier.parent
    lignes = fichier.read_text(encoding="utf-8").splitlines()
    i = 0
    while i < len(lignes):
        l = lignes[i]
        s = l.strip()
        if s.startswith("```"):
            bloc = []
            i += 1
            while i < len(lignes) and not lignes[i].strip().startswith("```"):
                bloc.append(lignes[i])
                i += 1
            code(bloc)
        elif s.startswith("|"):
            bloc = []
            while i < len(lignes) and lignes[i].strip().startswith("|"):
                bloc.append(lignes[i])
                i += 1
            tableau(bloc, dossier)
            continue
        elif s.startswith("#"):
            n = len(s) - len(s.lstrip("#"))
            titre = s.lstrip("#").strip()
            doc.add_heading(titre, level=min(3, n - 1 + niveau_titre))
        elif m := re.match(r"!\[([^\]]*)\]\(([^)]+)\)", s):
            image((dossier / m.group(2)).resolve(), m.group(1))
        elif s.startswith(">"):
            p = doc.add_paragraph()
            bordure_gauche(p)
            texte_riche(p, s.lstrip("> ").strip())
            for r in p.runs:
                r.italic = True
        elif re.match(r"^(\s*)[-*] ", l):
            retrait = len(l) - len(l.lstrip())
            p = doc.add_paragraph(style="List Bullet 2" if retrait >= 2 else "List Bullet")
            texte_riche(p, re.sub(r"^\s*[-*] ", "", l))
        elif m := re.match(r"^(\s*)(\d+)\. (.*)", l):
            # numérotation écrite à la main : chaque liste repart de 1 comme dans le Markdown
            retrait = Cm(1.6 if len(m.group(1)) >= 2 else 0.9)
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = retrait
            p.paragraph_format.first_line_indent = Cm(-0.6)
            p.paragraph_format.space_after = Pt(3)
            p.add_run(m.group(2) + ".\t")
            p.paragraph_format.tab_stops.add_tab_stop(retrait)
            texte_riche(p, m.group(3))
        elif s == "---" or not s or s.startswith("[←") or s.startswith("[Retour"):
            pass
        else:
            texte_riche(doc.add_paragraph(), s)
        i += 1


# ---------------------------------------------------------------- page de titre
for _ in range(5):
    doc.add_paragraph()
t = doc.add_paragraph(style="Title")
t.alignment = WD_ALIGN_PARAGRAPH.CENTER
t.add_run("Une IA pour ma chambre")
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("Home Assistant + Claude + ElevenLabs + LED Govee\nSarah, une assistante vocale toujours active, avec un visage")
r.font.size = Pt(14)
r.font.color.rgb = RGBColor(0x59, 0x59, 0x59)
image(RACINE / "captures" / "13_Sarah_repond_plein_ecran.png", "Sarah répond à voix haute après avoir changé la couleur des LED", Cm(14))
for _ in range(3):
    doc.add_paragraph()
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.add_run("Joris Dylane Touossock Ngabou\n").bold = True
p.add_run("Projet personnel — Collège Boréal\n")
p.add_run(f"Mis à jour le {date.today().strftime('%d/%m/%Y')}\n")
p.add_run("github.com/dylanengabou-beep/projet-ia-chambre")
doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

# ---------------------------------------------------------------- sommaire
doc.add_heading("Sommaire", level=1)
for n, f in enumerate(PARTIES, 1):
    titre = (RACINE / "docs" / f).read_text(encoding="utf-8").splitlines()[0].lstrip("# ").strip()
    doc.add_paragraph(titre, style="List Number")

# ---------------------------------------------------------------- présentation
doc.add_heading("Présentation du projet", level=1)
readme = (RACINE / "README.md").read_text(encoding="utf-8").split("## Documentation")[0]
readme = "\n".join(l for l in readme.splitlines()[1:] if not l.startswith("!["))  # sans titre ni image (déjà en couverture)
tmp = RACINE / "docs" / "_presentation.md"
tmp.write_text(readme.replace("captures/", "../captures/"), encoding="utf-8")
markdown(tmp, niveau_titre=1)
tmp.unlink()

# ---------------------------------------------------------------- parties
for f in PARTIES:
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    markdown(RACINE / "docs" / f, niveau_titre=1)

# pied de page : numéro de page
pied = sec.footer.paragraphs[0]
pied.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = pied.add_run()
for tag, txt in (("begin", None), (None, "PAGE"), ("end", None)):
    if tag:
        e = OxmlElement("w:fldChar")
        e.set(qn("w:fldCharType"), tag)
    else:
        e = OxmlElement("w:instrText")
        e.set(qn("xml:space"), "preserve")
        e.text = txt
    run._r.append(e)

doc.save(SORTIE)
print("Document créé :", SORTIE)
