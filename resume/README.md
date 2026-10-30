# Résumé source

`public/resume.pdf` is built from this folder. Don't edit the PDF by hand.

1. Edit **`resume.yaml`**. It's plain text: one entry per job, project and bullet.
   `**double asterisks**` make text bold.
2. Run `python resume/build.py` from the repo root. It writes:
   - `resume/Cameron-Carpenter-Resume.docx`, which opens in Word or Google Docs
   - `public/resume.pdf`, the file every download button on the site serves

The build needs `pip install python-docx pyyaml` and LibreOffice (`soffice`) for the
PDF. The layout reproduces the original LibreOffice résumé: Carlito (metric-compatible
with Calibri), 10pt body, 0.5" side margins, navy headings with a rule underneath.

Keep it to one page, and remember the site's rule: every figure on the site must
agree with the résumé, so change both in the same commit.
