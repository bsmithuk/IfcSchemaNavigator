# IFC Schema Navigator

A lightweight, offline-capable reference browser for IFC (Industry Foundation Classes) schemas. Browse entities, types, and property sets across three IFC versions with full inheritance chains, attribute details, and links to official documentation.

## Usage

Open `index.html` in any modern browser. No build step or server required.

## Structure

```
index.html          entry point
app.js              navigator logic
style.css           styles
data/               pre-parsed schema data (JS modules, ~2.5 MB)
schema/
  parse_schemas.py  parser — regenerates data/ from source schemas
  *.exp / *.zip     schema source files (not committed — see DOWNLOADS.txt)
README.md
.gitignore
```

## Regenerating schema data

Schema source files (`.exp` and `.zip`) are not included. Refer to text file within [`schema`](schema/Download_Schemas.txt) for download links.


Once downloaded, run the parser:

```bash
cd schema
python3 parse_schemas.py
```

Requires Python 3 (stdlib only). Output is written to `data/`.

## IFC versions

| Key | Label | Entities |
|-----|-------|----------|
| `IFC2X3` | IFC 2x3 TC1 | 653 |
| `IFC4` | IFC 4 ADD2 TC1 | 776 |
| `IFC4X3_ADD2` | IFC 4X3 ADD2 | 876 |

## License

This tool is MIT licensed. buildingSMART International IFC schema source files are not included in this repository. Refer to text file within [`schema`](schema/Download_Schemas.txt).
