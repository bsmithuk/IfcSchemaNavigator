#!/usr/bin/env python3
import re
import json
import os
import io
import glob
import zipfile
import xml.etree.ElementTree as ET

SCHEMA_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR    = os.path.join(os.path.dirname(__file__), '..', 'data')

FILES = [
    ('IFC2X3_TC1.exp',  'IFC2X3',      'IFC 2x3 TC1'),
    ('IFC4.exp',        'IFC4',         'IFC 4 ADD2 TC1'),
    ('IFC4X3_ADD2.exp', 'IFC4X3_ADD2',  'IFC 4X3 ADD2'),
]

PSET_SOURCES = {
    'IFC2X3':      os.path.join(SCHEMA_DIR, 'IFC2X3_TC1.zip'),
    'IFC4':        os.path.join(SCHEMA_DIR, 'IFC4.zip'),
    'IFC4X3_ADD2': (os.path.join(SCHEMA_DIR, 'IFC4X3_ADD2.zip'), 'IFC4_3/HTML/annex-a-psd.zip'),
}

# ── helpers ────────────────────────────────────────────────────────────────────

def strip_comments(text):
    return re.sub(r'\(\*.*?\*\)', '', text, flags=re.DOTALL)

def clean_expr(s):
    return ' '.join(s.split())

# ── type parser ────────────────────────────────────────────────────────────────

def parse_type(block):
    m = re.match(r'TYPE\s+(\w+)\s*=(.*)', block, re.DOTALL)
    if not m:
        return None, None
    name = m.group(1)
    body = m.group(2).strip()

    if re.search(r'\bENUMERATION\s+OF\b', body):
        vals = re.findall(r'\b([A-Z][A-Z0-9_]*)\b', re.search(r'\((.*?)\)', body, re.DOTALL).group(1))
        return name, {'k': 'E', 'v': vals}

    if re.match(r'\s*SELECT\s*\(', body):
        vals = re.findall(r'\bIfc\w+\b', body)
        return name, {'k': 'S', 'v': vals}

    base = re.split(r'\bWHERE\b|;', body)[0].strip()
    result = {'k': 'D', 'b': clean_expr(base)}

    whr_m = re.search(r'\bWHERE\b(.*)', body, re.DOTALL)
    if whr_m:
        result['whr'] = parse_where_rules(whr_m.group(1))

    return name, result

# ── entity parser ──────────────────────────────────────────────────────────────

SECTION_KEYWORDS = re.compile(r'^\s*(DERIVE|INVERSE|WHERE|UNIQUE)\s*$', re.MULTILINE)

def parse_entity(block):
    lines = block.splitlines()
    header_line = lines[0]
    name_m = re.match(r'ENTITY\s+(\w+)', header_line)
    if not name_m:
        return None, None
    name = name_m.group(1)

    full = '\n'.join(lines)

    abs_flag = bool(re.search(r'\bABSTRACT\s+SUPERTYPE\b', full))

    sup_m = re.search(r'\bSUBTYPE\s+OF\s*\(\s*(\w+)\s*\)', full)
    sup = sup_m.group(1) if sup_m else None

    subs_m = re.search(r'\bSUPERTYPE\s+OF\s*\(ONEOF\s*\((.*?)\)\)', full, re.DOTALL)
    if not subs_m:
        subs_m = re.search(r'\bSUPERTYPE\s+OF\s*\(\s*(\w+)\s*\)', full)
        subs = re.findall(r'\bIfc\w+\b', subs_m.group(0)) if subs_m else []
    else:
        subs = re.findall(r'\bIfc\w+\b', subs_m.group(1))

    body_lines = []
    in_header = True
    for line in lines[1:]:
        if in_header and not line.startswith('\t') and not line.strip().startswith('(') and not re.match(r'^\s*(DERIVE|INVERSE|WHERE|UNIQUE)', line):
            continue
        in_header = False
        body_lines.append(line)

    attrs, inv, der, whr, unq = parse_entity_sections(body_lines)

    result = {'abs': abs_flag, 'a': attrs, 'inv': inv, 'der': der, 'whr': whr, 'unq': unq}
    if sup:
        result['sup'] = sup
    if subs:
        result['subs'] = subs
    return name, result

def parse_entity_sections(lines):
    SECTIONS = {'DERIVE', 'INVERSE', 'WHERE', 'UNIQUE'}
    section = 'ATTR'
    attrs, inv, der, whr, unq = [], [], [], [], []
    pending_rule = None

    def flush_pending():
        nonlocal pending_rule
        if pending_rule:
            target, item = pending_rule
            target.append(item)
            pending_rule = None

    for line in lines:
        stripped = line.strip()
        upper = stripped.upper()

        if upper in SECTIONS:
            flush_pending()
            section = upper
            continue

        if not stripped:
            continue

        if section == 'ATTR':
            m = re.match(r'\t\s*(\w+)\s*:\s*(OPTIONAL\s+)?(.*)', line)
            if m:
                attr_name = m.group(1).strip()
                optional  = bool(m.group(2))
                attr_type = clean_expr(m.group(3).rstrip(';'))
                attrs.append({'n': attr_name, 'o': optional, 't': attr_type})

        elif section == 'INVERSE':
            m = re.match(r'\t\s*(\w+)\s*:\s*(.*)', line)
            if m:
                inv.append({'n': m.group(1).strip(), 't': clean_expr(m.group(2).rstrip(';'))})

        elif section == 'DERIVE':
            m = re.match(r'\t\s*(\w+)\s*:\s*(.*)', line)
            if m:
                der.append({'n': m.group(1).strip(), 't': clean_expr(m.group(2).rstrip(';'))})

        elif section == 'WHERE':
            m = re.match(r'\t\s*(\w+)\s*:(.*)', line)
            if m:
                flush_pending()
                rule_name = m.group(1).strip()
                expr = clean_expr(m.group(2).rstrip(';'))
                pending_rule = (whr, {'n': rule_name, 'e': expr})
            elif pending_rule and (line.startswith('\t') or line.startswith('  ')):
                pending_rule[1]['e'] += ' ' + stripped.rstrip(';')

        elif section == 'UNIQUE':
            m = re.match(r'\t\s*(\w+)\s*:(.*)', line)
            if m:
                flush_pending()
                rule_name = m.group(1).strip()
                expr = clean_expr(m.group(2).rstrip(';'))
                pending_rule = (unq, {'n': rule_name, 'e': expr})
            elif pending_rule and (line.startswith('\t') or line.startswith('  ')):
                pending_rule[1]['e'] += ' ' + stripped.rstrip(';')

    flush_pending()
    return attrs, inv, der, whr, unq

def parse_where_rules(text):
    rules = []
    pending = None
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        m = re.match(r'\s*(\w+)\s*:(.*)', line)
        if m:
            if pending:
                rules.append(pending)
            pending = {'n': m.group(1).strip(), 'e': clean_expr(m.group(2).rstrip(';'))}
        elif pending:
            pending['e'] += ' ' + stripped.rstrip(';')
    if pending:
        rules.append(pending)
    return rules

# ── pset parser ────────────────────────────────────────────────────────────────

def extract_prop_type(pt):
    if pt is None:
        return ''
    if pt.find('TypePropertySingleValue') is not None:
        dt = pt.find('TypePropertySingleValue/DataType')
        return dt.get('type', '') if dt is not None else ''
    if pt.find('TypePropertyEnumeratedValue') is not None:
        return 'ENUM'
    if pt.find('TypePropertyBoundedValue') is not None:
        dt = pt.find('TypePropertyBoundedValue/DataType')
        return dt.get('type', '') if dt is not None else ''
    if pt.find('TypePropertyListValue') is not None:
        dt = pt.find('TypePropertyListValue/ListValue/DataType')
        t = dt.get('type', '') if dt is not None else ''
        return f'LIST:{t}' if t else 'LIST'
    if pt.find('TypePropertyTableValue') is not None:
        return 'TABLE'
    if pt.find('TypeComplexProperty') is not None:
        return 'COMPLEX'
    if pt.find('TypePropertyReferenceValue') is not None:
        return 'REF'
    return ''

def parse_pset_xml(content):
    if isinstance(content, bytes):
        content = content.decode('utf-8', errors='replace')
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        return None, None

    name_el = root.find('Name')
    if name_el is None or not name_el.text:
        return None, None
    name = name_el.text.strip()
    if not name.startswith('Pset_'):
        return None, None

    def_el = root.find('Definition')
    definition = (def_el.text or '').strip() if def_el is not None else ''

    cls_els = root.findall('ApplicableClasses/ClassName')
    classes = [c.text.strip() for c in cls_els if c.text and c.text.strip()]

    props = []
    for pd in root.findall('PropertyDefs/PropertyDef'):
        pname_el = pd.find('Name')
        if pname_el is None or not pname_el.text:
            continue
        pname = pname_el.text.strip()
        pdef_el = pd.find('Definition')
        pdef = (pdef_el.text or '').strip() if pdef_el is not None else ''
        ptype = extract_prop_type(pd.find('PropertyType'))
        props.append({'n': pname, 't': ptype, 'd': pdef})

    return name, {'d': definition, 'cls': classes, 'p': props}

def _read_psets_from_zip(zf):
    psets = {}
    for entry in zf.namelist():
        base = os.path.basename(entry)
        if base.startswith('Pset_') and base.endswith('.xml'):
            name, data = parse_pset_xml(zf.read(entry))
            if name:
                psets[name] = data
    return psets

def parse_psets(source):
    if isinstance(source, tuple):
        outer_path, inner_path = source
        if not os.path.exists(outer_path):
            print(f'  ZIP not found: {outer_path}')
            return {}
        with zipfile.ZipFile(outer_path) as zf_outer:
            with zipfile.ZipFile(io.BytesIO(zf_outer.read(inner_path))) as zf_inner:
                return _read_psets_from_zip(zf_inner)
    if not os.path.exists(source):
        print(f'  ZIP not found: {source}')
        return {}
    with zipfile.ZipFile(source) as zf:
        return _read_psets_from_zip(zf)

# ── main ───────────────────────────────────────────────────────────────────────

def parse_exp(filepath, key):
    with open(filepath, encoding='utf-8', errors='replace') as f:
        content = f.read()

    content = strip_comments(content)

    entities = {}
    types    = {}

    for block in re.findall(r'^ENTITY\s+\w+.*?^END_ENTITY;', content, re.MULTILINE | re.DOTALL):
        n, data = parse_entity(block)
        if n:
            entities[n] = data

    for block in re.findall(r'^TYPE\s+\w+.*?^END_TYPE;', content, re.MULTILINE | re.DOTALL):
        n, data = parse_type(block)
        if n:
            types[n] = data

    for ename, edata in entities.items():
        sup = edata.get('sup')
        if sup and sup in entities:
            parent = entities[sup]
            if 'subs' not in parent:
                parent['subs'] = []
            if ename not in parent['subs']:
                parent['subs'].append(ename)

    psets = parse_psets(PSET_SOURCES[key]) if key in PSET_SOURCES else {}

    return {'schema': key, 'entities': entities, 'types': types, 'psets': psets}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    all_data = {}

    for filename, key, label in FILES:
        path = os.path.join(SCHEMA_DIR, filename)
        if not os.path.exists(path):
            print(f'SKIP (not found): {path}')
            continue
        print(f'Parsing {filename}...', end=' ')
        data = parse_exp(path, key)
        all_data[key] = data
        ec = len(data['entities'])
        tc = len(data['types'])
        pc = len(data['psets'])
        print(f'{ec} entities, {tc} types, {pc} psets')

        out_path = os.path.join(OUT_DIR, f'ifc_{key}.js')
        js = f'// Auto-generated by parse_schemas.py\n(function(){{if(!window.IFC_SCHEMAS)window.IFC_SCHEMAS={{}};window.IFC_SCHEMAS["{key}"]={json.dumps(data, separators=(",",":"))};}})();\n'
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(js)
        print(f'  -> {out_path} ({os.path.getsize(out_path)//1024} KB)')

    # ── assertions ──────────────────────────────────────────────────────────────
    print('\nRunning assertions...')

    IFC4X3 = all_data.get('IFC4X3_ADD2', {})
    assert len(IFC4X3.get('entities', {})) >= 800, f"IFC4X3 entity count low: {len(IFC4X3.get('entities', {}))}"
    assert len(IFC4X3.get('types', {}))    >= 400, f"IFC4X3 type count low"

    wall = IFC4X3['entities'].get('IfcWall')
    assert wall is not None, 'IfcWall not found in IFC4X3'
    assert wall.get('sup') in ('IfcBuiltElement', 'IfcBuildingElement'), f"IfcWall sup unexpected: {wall.get('sup')}"
    assert any(a['n'] == 'PredefinedType' for a in wall.get('a', [])), 'IfcWall missing PredefinedType attr'

    wte = IFC4X3['types'].get('IfcWallTypeEnum')
    assert wte is not None, 'IfcWallTypeEnum not found'
    assert wte['k'] == 'E', 'IfcWallTypeEnum not an enum'
    assert 'NOTDEFINED' in wte['v'], 'NOTDEFINED missing from IfcWallTypeEnum'

    actor = IFC4X3['types'].get('IfcActorSelect')
    assert actor is not None, 'IfcActorSelect not found'
    assert actor['k'] == 'S', 'IfcActorSelect not a select'
    assert 'IfcPerson' in actor['v'], 'IfcPerson missing from IfcActorSelect'

    IFC2X3 = all_data.get('IFC2X3', {})
    assert len(IFC2X3.get('entities', {})) >= 600, f"IFC2X3 entity count low: {len(IFC2X3.get('entities', {}))}"

    psets_4x3 = IFC4X3.get('psets', {})
    assert len(psets_4x3) >= 600, f"IFC4X3 pset count low: {len(psets_4x3)}"
    assert 'Pset_WallCommon' in psets_4x3, 'Pset_WallCommon missing from IFC4X3'
    assert 'IfcWall' in psets_4x3['Pset_WallCommon']['cls'], 'Pset_WallCommon missing IfcWall in cls'

    psets_ifc4 = all_data.get('IFC4', {}).get('psets', {})
    assert len(psets_ifc4) >= 400, f"IFC4 pset count low: {len(psets_ifc4)}"

    psets_2x3 = IFC2X3.get('psets', {})
    assert len(psets_2x3) >= 300, f"IFC2X3 pset count low: {len(psets_2x3)}"

    print('All assertions passed.')


if __name__ == '__main__':
    main()
