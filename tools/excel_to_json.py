"""One-time migration: KUL_VRAKSH Excel chart -> tree.json + photos.

The Excel sheets are hand-drawn charts: person "cards" are bordered cell boxes,
photos sit just above each card, and parent->child links are drawn connector
lines. This script reads all three and rebuilds the family relationships.
Usage: python3 excel_to_json.py <xlsx> <out_dir>
"""
import sys, os, re, json, zipfile, hashlib, collections
import xml.etree.ElementTree as ET
import openpyxl
from openpyxl.utils import get_column_letter

NS = {
    'xdr': 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'rel': 'http://schemas.openxmlformats.org/package/2006/relationships',
    'm': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
}
EMU_PX = 9525

PLACEHOLDERS = {'dob', 'dop', 'pob', 'dod', 'pod', 'dom', 'date of death', 'placeof death', 'place of death',
                'name', 'wife name', 'husband name', 'date of birth', 'place of birth', '', '-'}
DATE_RE = re.compile(r'^\s*([_\d]{1,3})\s*[./-]\s*([_\d]{1,3})\s*[./-]\s*(\d{2,4})\s*$')
YEAR_RE = re.compile(r'^\s*(1[6-9]\d\d|20\d\d)\s*$')
TITLE_RE = re.compile(r'^\s*(retd\.?|lt\.?|col\.?|dr\.?|maj\.?|capt\.?|brig\.?|gen\.?|ias|ips|irs)\b', re.I)
LABEL_RE = re.compile(r'&|\bsons?\b|\bsisters?\b|family tree|today|read comment|^\d+$', re.I)


def is_placeholder_image(data):
    """The sheets use a plain beige texture where no photo is available."""
    try:
        from PIL import Image, ImageStat
        import io
        im = Image.open(io.BytesIO(data)).convert('RGB').resize((32, 32))
        st = ImageStat.Stat(im)
        mean, std = st.mean, sum(st.stddev) / 3
        return abs(mean[0] - 210) < 10 and abs(mean[1] - 168) < 10 and abs(mean[2] - 136) < 10 and std < 24
    except Exception:
        return False


def parse_date(s):
    s = str(s).strip()
    m = DATE_RE.match(s)
    if m:
        d, mo, y = m.groups()
        if len(y) == 2:
            y = ('19' if int(y) > 30 else '20') + y
        y = int(y)
        try:
            d = int(d) if '_' not in d else None
            mo = int(mo) if '_' not in mo else None
        except ValueError:
            d = mo = None
        if mo and not 1 <= mo <= 12: mo = None
        if d and not 1 <= d <= 31: d = None
        if mo and d: return f'{y:04d}-{mo:02d}-{d:02d}'
        if mo: return f'{y:04d}-{mo:02d}'
        return f'{y:04d}'
    m = YEAR_RE.match(s)
    if m: return m.group(1)
    return None


def is_placeholder(s):
    s = str(s).strip().lower()
    # blank date templates such as "_._.__DOB" or "_._.__" left in the sheet
    return s.rstrip('.:') in PLACEHOLDERS or re.sub(r'[_.\s/-]', '', s) in PLACEHOLDERS or '__' in s


class Sheet:
    def __init__(self, ws, zf, sheet_path):
        self.ws = ws
        self.zf = zf
        self.path = sheet_path
        self._colw = {}
        for key, dim in ws.column_dimensions.items():
            if dim.width:
                for c in range(dim.min or 1, (dim.max or dim.min or 1) + 1):
                    self._colw[c] = dim.width
        self.default_w = ws.sheet_format.defaultColWidth or 9.14
        self.default_h = ws.sheet_format.defaultRowHeight or 15

    def col_emu(self, c):  # c is 1-based
        w = self._colw.get(c, self.default_w)
        return max(1, int(w * 7 + 5)) * EMU_PX

    def row_emu(self, r):
        h = self.ws.row_dimensions[r].height if r in self.ws.row_dimensions else None
        return (h or self.default_h) * 12700

    def frac(self, col0, colOff, row0, rowOff):
        """Anchor (0-based) -> fractional 1-based (x=col, y=row) coordinates."""
        return (col0 + 1 + colOff / self.col_emu(col0 + 1), row0 + 1 + rowOff / self.row_emu(row0 + 1))

    # ---------- borders / boxes ----------
    def edge(self, r, c, side):
        ws = self.ws
        if r < 1 or c < 1: return False
        b = ws.cell(r, c).border
        if side == 'L':
            return bool(b.left.style) or (c > 1 and bool(ws.cell(r, c - 1).border.right.style))
        if side == 'R':
            return bool(b.right.style) or bool(ws.cell(r, c + 1).border.left.style)
        if side == 'T':
            return bool(b.top.style) or (r > 1 and bool(ws.cell(r - 1, c).border.bottom.style))
        if side == 'B':
            return bool(b.bottom.style) or bool(ws.cell(r + 1, c).border.top.style)

    def boxes(self):
        ws = self.ws
        out = []
        maxr, maxc = ws.max_row, ws.max_column
        for r in range(1, maxr + 1):
            for c in range(1, maxc + 1):
                if not (self.edge(r, c, 'L') and self.edge(r, c, 'T')):
                    continue
                if self.edge(r - 1, c, 'L'):
                    continue  # not the top of a box (inner divider, e.g. DOM row)
                # right edge along top row
                c2 = c
                while c2 <= maxc and not self.edge(r, c2, 'R'):
                    c2 += 1
                if c2 > maxc or c2 - c > 20:
                    continue
                r2 = r
                while r2 + 1 <= maxr and self.edge(r2 + 1, c, 'L') and self.edge(r2 + 1, c2, 'R'):
                    r2 += 1
                out.append((r, c, r2, c2))
        return out

    # ---------- drawings ----------
    def drawing(self):
        rels = self.path.replace('worksheets/', 'worksheets/_rels/') + '.rels'
        if rels not in self.zf.namelist(): return None, {}
        rx = ET.fromstring(self.zf.read(rels))
        target = None
        for rel in rx.findall('rel:Relationship', NS):
            if rel.get('Type').endswith('/drawing'):
                target = rel.get('Target')
        if not target: return None, {}
        dpath = os.path.normpath(os.path.join(os.path.dirname(self.path), target)).replace('\\', '/')
        drel = dpath.replace('drawings/', 'drawings/_rels/') + '.rels'
        media = {}
        if drel in self.zf.namelist():
            for rel in ET.fromstring(self.zf.read(drel)).findall('rel:Relationship', NS):
                media[rel.get('Id')] = os.path.normpath(os.path.join(os.path.dirname(dpath), rel.get('Target'))).replace('\\', '/')
        return ET.fromstring(self.zf.read(dpath)), media

    def shapes(self):
        root, media = self.drawing()
        segs, pics, texts = [], [], []
        if root is None: return segs, pics, texts
        for anc in root:
            fr, to = anc.find('xdr:from', NS), anc.find('xdr:to', NS)
            if fr is None or to is None: continue
            g = lambda e, t: int(e.find('xdr:' + t, NS).text)
            p1 = self.frac(g(fr, 'col'), g(fr, 'colOff'), g(fr, 'row'), g(fr, 'rowOff'))
            p2 = self.frac(g(to, 'col'), g(to, 'colOff'), g(to, 'row'), g(to, 'rowOff'))
            for el in anc:
                tag = el.tag.split('}')[1]
                if tag == 'pic':
                    blip = el.find('.//a:blip', NS)
                    rid = blip.get('{%s}embed' % NS['r']) if blip is not None else None
                    if rid in media: pics.append((p1, p2, media[rid]))
                elif tag in ('cxnSp', 'sp'):
                    prst = el.find('.//a:prstGeom', NS)
                    prst = prst.get('prst') if prst is not None else ''
                    xfrm = el.find('.//a:xfrm', NS)
                    flipV = xfrm is not None and xfrm.get('flipV') == '1'
                    flipH = xfrm is not None and xfrm.get('flipH') == '1'
                    txt = ' '.join(t.text or '' for t in el.findall('.//a:t', NS)).strip()
                    if prst in ('line', 'straightConnector1') or tag == 'cxnSp':
                        rot = int(xfrm.get('rot', '0')) if xfrm is not None else 0
                        ends = []
                        for (ux, uy) in ((0.0, 0.0), (1.0, 1.0)):
                            if flipH: ux = 1 - ux
                            if flipV: uy = 1 - uy
                            for _ in range(round(rot / 5400000) % 4):  # 90 deg clockwise steps
                                dx, dy = ux - 0.5, uy - 0.5
                                ux, uy = 0.5 - dy, 0.5 + dx
                            ends.append((p1[0] + ux * (p2[0] - p1[0]), p1[1] + uy * (p2[1] - p1[1])))
                        segs.append((ends[0], ends[1], prst))
                    elif prst == 'downArrow':
                        xm = (p1[0] + p2[0]) / 2
                        segs.append(((xm, p1[1]), (xm, p2[1]), 'downArrow'))
                    elif txt:
                        texts.append((p1, p2, txt))
        return segs, pics, texts


def card_from_box(sh, box, dom_offsets):
    r1, c1, r2, c2 = box
    ws = sh.ws
    rows = []
    for r in range(r1, r2 + 1):
        vals = []
        for c in range(c1, c2 + 1):
            cell = ws.cell(r, c)
            v = cell.value
            if v is None or (isinstance(v, str) and v.startswith('=')): continue
            if isinstance(v, (int, float)) and not isinstance(v, bool): v = str(v)
            if hasattr(v, 'strftime'): v = v.strftime('%d.%m.%Y')
            v = str(v).strip()
            if not v: continue
            col = cell.font.color
            red = bool(col is not None and isinstance(col.rgb, str) and col.rgb.upper().endswith('FF0000'))
            vals.append((v, red))
        boxed = r > r1 and sh.edge(r, c1 + 1, 'T') and sh.edge(r, c1 + 1, 'B') and r != r2
        rows.append({'r': r, 'vals': vals, 'boxed': boxed})
    return rows


def explicit_dom(rows):
    for i, row in enumerate(rows):
        if row['boxed']: return i
    for i, row in enumerate(rows):
        if any(v.strip().upper() == 'DOM' for v, _ in row['vals']): return i
    return None


def interpret(rows, default_dom=None):
    """Turn card rows into person + spouse dicts."""
    texts = [(i, v, red) for i, row in enumerate(rows) for (v, red) in row['vals']]
    if not texts: return None
    name = texts[0][1]
    rest = [(i, v, red) for (i, v, red) in texts[1:]]
    title = None
    if TITLE_RE.match(name) and rest and not parse_date(rest[0][1]) and not is_placeholder(rest[0][1]):
        title, name = name, rest[0][1]
        rest = rest[1:]
    if name.strip().upper() in ('NAME', 'WIFE NAME', 'HUSBAND NAME'):
        name = 'Unknown'
    dom_idx = explicit_dom(rows)
    if dom_idx is None and default_dom is not None and default_dom < len(rows):
        dom_idx = default_dom
    has_data = any(parse_date(v) for (_, v, _) in rest) or any(is_placeholder(v) for (_, v, _) in rest)
    person = {'name': name, 'notes': [title] if title else []}
    spouse = None
    marriage = None
    if not has_data:
        if rest: person['notes'].append(' '.join(v for (_, v, _) in rest))
        return person, None, None
    def fill(target, items):
        for (i, v, red) in items:
            if is_placeholder(v): continue
            d = parse_date(v)
            if d:
                key = 'death' if red else 'birth'
                if target.get(key, {}).get('date'):
                    target['notes'].append(v)
                else:
                    target.setdefault(key, {})['date'] = d
            else:
                key = 'death' if red else 'birth'
                if target.get(key, {}).get('place') or (not red and not target.get('birth') and False):
                    target['notes'].append(v)
                else:
                    target.setdefault(key, {})['place'] = v
    if dom_idx is None:
        fill(person, rest)
        return person, None, None
    before = [t for t in rest if t[0] < dom_idx]
    at = [t for t in rest if t[0] == dom_idx]
    after = [t for t in rest if t[0] > dom_idx]
    fill(person, before)
    for (_, v, _) in at:
        if parse_date(v): marriage = parse_date(v)
    if after:
        sname = after[0][1]
        if not is_placeholder(sname) and not parse_date(sname):
            spouse = {'name': sname, 'notes': []}
            fill(spouse, after[1:])
    return person, spouse, marriage


import difflib

def norm(n): return re.sub(r'\(.*?\)|\{.*?\}', '', n.lower()).replace(' ', '').strip()
def normx(n): return re.sub(r'[^a-z]', '', norm(n))

def sim(a, b):
    a, b = normx(a), normx(b)
    if not a or not b: return 0
    if a == b or a.startswith(b) or b.startswith(a): return 1
    return difflib.SequenceMatcher(None, a, b).ratio()

def best_label_match(cards, a, b):
    best = (0, None)
    for cd in cards:
        sc = sim(cd['person']['name'], a)
        if b.strip() and cd['spouse']:
            sc = sc + 0.5 * sim(cd['spouse']['name'], b)
        elif b.strip():
            sc = sc + 0.5 * sim(cd['person']['name'], b) * 0  # no spouse on card
        if sc > best[0]: best = (sc, cd)
    return best[1] if best[0] >= 0.8 else None

def compatible(p, q):
    for k in ('birth', 'death'):
        a, b = (p.get(k) or {}).get('date'), (q.get(k) or {}).get('date')
        if a and b and not (a.startswith(b) or b.startswith(a)): return False
    return True

def merge_duplicates(people, report):
    merged = 0
    changed = True
    while changed:
        changed = False
        byname = collections.defaultdict(list)
        for i, p in people.items(): byname[normx(p['name'])].append(i)
        kids = collections.defaultdict(set)
        for i, p in people.items():
            for pp in p['parents']: kids[pp].add(i)
        for name, ids in byname.items():
            if len(ids) < 2 or name in ('unknown', 'sister', 'brother'): continue
            for x in range(len(ids)):
                for y in range(x + 1, len(ids)):
                    a, b = ids[x], ids[y]
                    if a not in people or b not in people: continue
                    p, q = people[a], people[b]
                    if not compatible(p, q): continue
                    sp_a = {s['id'] for s in p['spouses']}; sp_b = {s['id'] for s in q['spouses']}
                    spn_a = {normx(people[s]['name']) for s in sp_a}; spn_b = {normx(people[s]['name']) for s in sp_b}
                    kn_a = {normx(people[k]['name']) for k in kids[a]}; kn_b = {normx(people[k]['name']) for k in kids[b]}
                    pn_a = {normx(people[k]['name']) for k in p['parents']}; pn_b = {normx(people[k]['name']) for k in q['parents']}
                    if (set(p['parents']) & set(q['parents'])) or (sp_a & sp_b) or (spn_a & spn_b) \
                            or (kn_a & kn_b) or (pn_a & pn_b):
                        fold(people, a, b); merged += 1; changed = True
    report.append(f'merged duplicates across sheets: {merged}')

ALIAS = {}
def resolve(i):
    while i in ALIAS: i = ALIAS[i]
    return i

def fold(people, a, b):
    ALIAS[b] = a
    p, q = people[a], people.pop(b)
    for k in ('birth', 'death'):
        for kk, vv in (q.get(k) or {}).items():
            cur = p.setdefault(k, {}).get(kk)
            if not cur or (kk == 'date' and len(vv) > len(cur)): p[k][kk] = vv
    if not p.get('photo') and q.get('photo'): p['photo'] = q['photo']
    for n in q['notes']:
        if n not in p['notes']: p['notes'].append(n)
    for pp in q['parents']:
        if pp not in p['parents'] and pp != a: p['parents'].append(pp)
    for s in q['spouses']:
        if s['id'] != a and not any(t['id'] == s['id'] for t in p['spouses']): p['spouses'].append(s)
    p['sources'] = sorted(set(p['sources']) | set(q['sources']))
    for r in people.values():
        r['parents'] = list(dict.fromkeys(a if x == b else x for x in r['parents']))
        seen = set(); new = []
        for s in r['spouses']:
            sid = a if s['id'] == b else s['id']
            if sid in seen or sid == r.get('id'): continue
            seen.add(sid); new.append({**s, 'id': sid})
        r['spouses'] = new


def main(xlsx, out):
    os.makedirs(os.path.join(out, 'photos'), exist_ok=True)
    zf = zipfile.ZipFile(xlsx)
    wb = openpyxl.load_workbook(xlsx)
    wbx = ET.fromstring(zf.read('xl/workbook.xml'))
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(zf.read('xl/_rels/workbook.xml.rels')).findall('rel:Relationship', NS)}
    sheet_paths = {}
    for s in wbx.find('m:sheets', NS):
        sheet_paths[s.get('name')] = 'xl/' + rels[s.get('{%s}id' % NS['r'])].lstrip('/').replace('xl/', '')

    # blank placeholder photos: the most common image hashes
    hashes = collections.Counter()
    for n in zf.namelist():
        if n.startswith('xl/media/'):
            hashes[hashlib.md5(zf.read(n)).hexdigest()] += 1

    people = {}      # id -> person
    trees = []
    report = []
    pid = [0]
    def new_id():
        pid[0] += 1
        return 'P%04d' % pid[0]
    dedupe = {}      # (normname, birthdate) -> id
    photo_hash_to_file = {}


    def register(p, sheet):
        key = object()
        if key in dedupe:
            ex = people[dedupe[key]]
            for k in ('birth', 'death'):
                for kk, vv in (p.get(k) or {}).items():
                    ex.setdefault(k, {}).setdefault(kk, vv)
            if not ex.get('photo') and p.get('photo'): ex['photo'] = p['photo']
            for n in p['notes']:
                if n not in ex['notes']: ex['notes'].append(n)
            return dedupe[key]
        i = new_id()
        p['id'] = i
        p.setdefault('parents', [])
        p.setdefault('spouses', [])
        p['sources'] = [sheet]
        people[i] = p
        dedupe[key] = i
        return i

    first_sheet = [None]
    for sname, spath in sheet_paths.items():
        ws = wb[sname]
        sh = Sheet(ws, zf, spath)
        segs, pics, txts = sh.shapes()
        boxes = sh.boxes()
        cards = []
        labels = []
        band_dom = collections.defaultdict(collections.Counter)
        box_rows = {}
        for b in boxes:
            box_rows[b] = card_from_box(sh, b, None)
            d = explicit_dom(box_rows[b])
            if d is not None: band_dom[b[0]][d] += 1
        for b in boxes:
            rows = box_rows[b]
            texts = [v for row in rows for (v, _) in row['vals']]
            if not texts: continue
            if LABEL_RE.search(texts[0]) or (len(texts) == 1 and LABEL_RE.search(texts[0])):
                labels.append({'box': b, 'text': ' '.join(texts)})
                continue
            dd = band_dom[b[0]].most_common(1)
            res = interpret(rows, dd[0][0] if dd else None)
            if not res: continue
            person, spouse, marriage = res
            if person['name'].strip().upper() in ('FORMAT', 'DOM', 'DOB', 'POB'):
                continue
            if person['name'] == 'Unknown' and not (person.get('birth') or person.get('death') or spouse):
                continue
            cards.append({'box': b, 'person': person, 'spouse': spouse, 'marriage': marriage})
        if not cards:
            continue
        # photos -> cards: picture centre above card top, horizontally within card
        for (p1, p2, media) in pics:
            data = zf.read(media)
            h = hashlib.md5(data).hexdigest()
            placeholder = hashes[h] >= 8 or is_placeholder_image(data)
            cx, by = (p1[0] + p2[0]) / 2, p2[1]
            best = None
            for cd in cards:
                r1, c1, r2, c2 = cd['box']
                if c1 - 0.5 <= cx <= c2 + 1.5 and r1 - 2.5 <= by <= r1 + 1.5:
                    d = abs(by - r1)
                    if best is None or d < best[0]: best = (d, cd)
            if best:
                best[1].setdefault('pics', []).append((p1[0], h, data, media, p1[1], placeholder))
        # assign photos: leftmost = person, next = spouse
        for cd in cards:
            ps = sorted(cd.get('pics', []), key=lambda t: t[0])
            targets = [cd['person'], cd['spouse']] if cd['spouse'] else [cd['person']]
            for tgt, (_, h, data, media, _y, placeholder) in zip(targets, ps):
                if placeholder:  # the beige "no photo yet" picture keeps its slot but is not imported
                    continue
                if h not in photo_hash_to_file:
                    ext = os.path.splitext(media)[1].lower() or '.jpg'
                    fn = 'photos/img_%s%s' % (h[:10], ext)
                    with open(os.path.join(out, fn), 'wb') as f: f.write(data)
                    photo_hash_to_file[h] = fn
                tgt['photo'] = photo_hash_to_file[h]
        # register people
        for cd in cards:
            cd['pid'] = register(cd['person'], sname)
            cd['sid'] = None
            if cd['spouse']:
                cd['sid'] = register(cd['spouse'], sname)
                a, b = people[cd['pid']], people[cd['sid']]
                if not any(s['id'] == cd['sid'] for s in a['spouses']):
                    a['spouses'].append({'id': cd['sid'], **({'married': cd['marriage']} if cd['marriage'] else {})})
                if not any(s['id'] == cd['pid'] for s in b['spouses']):
                    b['spouses'].append({'id': cd['pid'], **({'married': cd['marriage']} if cd['marriage'] else {})})

        # ---------- connector graph ----------
        tol = 0.6
        n = len(segs)
        parent = list(range(n))
        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]; i = parent[i]
            return i
        def crosses(a, b):
            def orient(s):
                (x1, y1), (x2, y2) = s[0], s[1]
                return 'h' if abs(y2 - y1) < 0.6 and abs(x2 - x1) > 1 else ('v' if abs(x2 - x1) < 1.2 else None)
            oa, ob = orient(a), orient(b)
            if not oa or not ob or oa == ob: return False
            h, v = (a, b) if oa == 'h' else (b, a)
            hy = (h[0][1] + h[1][1]) / 2; vx = (v[0][0] + v[1][0]) / 2
            return (min(h[0][0], h[1][0]) - 0.3 <= vx <= max(h[0][0], h[1][0]) + 0.3 and
                    min(v[0][1], v[1][1]) - 0.3 <= hy <= max(v[0][1], v[1][1]) + 0.3)
        def near_seg(p, s, tx=0.45, ty=0.6):
            (x1, y1), (x2, y2) = s[0], s[1]
            lox, hix = min(x1, x2) - tx, max(x1, x2) + tx
            loy, hiy = min(y1, y2) - ty, max(y1, y2) + ty
            return lox <= p[0] <= hix and loy <= p[1] <= hiy
        for i in range(n):
            for j in range(i + 1, n):
                si, sj = segs[i], segs[j]
                if any(near_seg(p, sj) for p in si[:2]) or any(near_seg(p, si) for p in sj[:2]) or crosses(si, sj):
                    parent[find(i)] = find(j)
        comps = collections.defaultdict(list)
        for i in range(n): comps[find(i)].append(segs[i])

        def card_at_bottom(p):
            for cd in cards:
                r1, c1, r2, c2 = cd['box']
                if c1 - 0.3 <= p[0] <= c2 + 1.3 and r2 + 0.3 <= p[1] <= r2 + 2.5:
                    return cd
            return None
        def card_at_top(p):
            best = None
            for cd in cards:
                r1, c1, r2, c2 = cd['box']
                top = min([r1 - 3.5] + [pt[4] for pt in cd.get('pics', [])])
                if c1 - 0.3 <= p[0] <= c2 + 1.3 and top - 2.5 <= p[1] <= r1 + 0.5:
                    d = r1 - p[1]
                    if best is None or d < best[0]: best = (d, cd)
            return best[1] if best else None
        def label_near(p):
            for lb in labels:
                r1, c1, r2, c2 = lb['box']
                if c1 - 1.5 <= p[0] <= c2 + 2.5 and r1 - 1.5 <= p[1] <= r2 + 2.5:
                    return lb
            return None

        links = 0
        for comp in comps.values():
            pts = [p for s in comp for p in s[:2]]
            top = min(pts, key=lambda p: p[1])
            # parent: a card whose bottom touches the topmost point, or a label "A & B"
            par = None
            for p in sorted(pts, key=lambda p: p[1])[:3]:
                par = card_at_bottom(p)
                if par: break
            if not par:
                lb = None
                for p in sorted(pts, key=lambda p: p[1])[:4]:
                    lb = label_near(p)
                    if lb: break
                if not lb:
                    for sg in comp:
                        (x1, y1), (x2, y2) = sg[0], sg[1]
                        if abs(y1 - y2) > 0.6: continue
                        for cand in labels:
                            r1, c1, r2, c2 = cand['box']
                            if min(x1, x2) - 1 <= (c1 + c2) / 2 <= max(x1, x2) + 1 and r2 - 0.5 <= y1 <= r2 + 3:
                                lb = cand; break
                        if lb: break
                if lb:
                    a_, _, b_ = lb['text'].partition('&')
                    par = best_label_match(cards, a_, b_)
                    if not par:
                        report.append(f'[{sname}] label "{lb["text"]}" did not match a card')
            if not par:
                continue
            # children: arrow end points (lower ends) landing above a card
            kids = []
            for s in comp:
                end = max(s[:2], key=lambda p: p[1])
                cd = card_at_top(end)
                if cd and cd is not par and cd not in kids and cd['box'][0] > par['box'][2]:
                    kids.append(cd)
            for cd in kids:
                child = people[cd['pid']]
                pars = [par['pid']] + ([par['sid']] if par['sid'] else [])
                for pp in pars:
                    if pp not in child['parents'] and pp != cd['pid']:
                        child['parents'].append(pp); links += 1
        report.append(f'[{sname}] cards={len(cards)} labels={len(labels)} connectors={len(segs)} groups={len(comps)} photos={sum(len(c.get("pics", [])) for c in cards)} parent-links={links}')
        root_card = next((cd for cd in cards if norm(cd['person']['name']) == norm(sname)), None)
        if root_card is None:
            continue
        if first_sheet[0] is None:
            first_sheet[0] = sname
        else:
            # Every sheet repeats the ancestors and the generation of the branch head.
            # Keep those only from the first sheet; here drop them and attach this
            # sheet's branch head to the matching person from the first sheet.
            header = [cd for cd in cards if cd['box'][0] <= root_card['box'][0] and cd is not root_card]
            drop = set()
            for cd in header:
                drop.add(cd['pid'])
                if cd['sid']: drop.add(cd['sid'])
            for d in drop:
                people.pop(d, None)
            for q in people.values():
                q['parents'] = [x for x in q['parents'] if x not in drop]
                q['spouses'] = [x for x in q['spouses'] if x['id'] not in drop]
            main = [i for i, q in people.items() if normx(q['name']) == normx(sname) and q['sources'] == [first_sheet[0]]]
            if main:
                fold(people, main[0], root_card['pid'])
                head_spouse = root_card['sid']
                if head_spouse:  # spouse of the head may also exist in the first sheet
                    for i, q in list(people.items()):
                        if i != head_spouse and q['sources'] == [first_sheet[0]] and normx(q['name']) == normx(people[head_spouse]['name']):
                            fold(people, i, head_spouse); break
            report.append(f'[{sname}] dropped {len(drop)} repeated header people; branch head attached to main tree: {bool(main)}')
        trees.append({'sheet': sname, 'root': root_card['pid']})

    merge_duplicates(people, report)
    # clean up
    for p in people.values():
        if len(p['parents']) > 2:
            report.append(f'CHECK: {p["name"]} had {len(p["parents"])} parents drawn; kept the first two')
            p['parents'] = p['parents'][:2]
        nm = re.sub(r'\s+', ' ', p['name']).strip()
        if nm.isupper(): nm = nm.title()
        p['name'] = nm
        p['notes'] = '; '.join(dict.fromkeys(p['notes'])) or None
        if not p.get('notes'): p.pop('notes', None)
        for k in ('birth', 'death'):
            if k in p and not p[k]: p.pop(k)
    # whole-family tree root = topmost ancestor without parents that has most descendants
    kids = collections.defaultdict(list)
    for p in people.values():
        for pp in p['parents']: kids[pp].append(p['id'])
    def count(i, seen=None):
        seen = seen or set()
        if i in seen: return 0
        seen.add(i)
        return 1 + sum(count(k, seen) for k in kids[i])
    roots = [p['id'] for p in people.values() if not p['parents']]
    top = max(roots, key=count)
    tree_list = [{'id': 'whole-family', 'title': 'Whole family', 'root': top, 'order': 0, 'visible': True,
                  'show': {'dob': False, 'address': False}}]
    for i, t in enumerate(trees):
        if t['root']:
            tree_list.append({'id': re.sub(r'[^a-z0-9]+', '-', t['sheet'].lower()).strip('-'), 'title': t['sheet'],
                              'root': resolve(t['root']), 'order': i + 1, 'visible': True,
                              'show': {'dob': False, 'address': False}})
    out_people = {}
    for i, p in people.items():
        q = {'name': p['name']}
        for k in ('birth', 'death', 'photo', 'notes'):
            if p.get(k): q[k] = p[k]
        q['parents'] = p['parents']; q['spouses'] = p['spouses']
        q['show'] = {'dob': None, 'address': None}
        out_people[i] = q
    reach = set()
    def walk(i):
        if i in reach: return
        reach.add(i)
        for s in people[i]['spouses']: reach.add(s['id'])
        for k in kids[i]: walk(k)
    walk(top)
    orphans = [p['name'] for i, p in people.items() if i not in reach]
    for i, p in people.items():
        if i not in reach:
            out_people[i]['notes'] = ((out_people[i].get('notes') or '') + ' [Imported from Excel but not linked to a parent - please check]').strip()
    for q in out_people.values():  # location starts as the place of birth
        bp = (q.get('birth') or {}).get('place')
        if bp and not q.get('location'): q['location'] = bp
    data = {'version': 1, 'trees': tree_list, 'people': out_people}
    with open(os.path.join(out, 'tree.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    report.append(f'people={len(people)} trees={len(tree_list)} photos={len(photo_hash_to_file)} whole-family-root={people[top]["name"]} ({count(top)} descendants incl.)')
    report.append(f'unlinked people ({len(orphans)}): ' + ', '.join(orphans))
    with open(os.path.join(out, 'import-report.txt'), 'w') as f: f.write('\n'.join(report) + '\n')
    print('\n'.join(report))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
