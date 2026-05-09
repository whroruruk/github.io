/* Favoread Editor — single-page editor for data.csv
 * Auth: GitHub PAT in localStorage, commits via Contents API.
 * Aladin: JSONP (Output=JS&Callback=...) — bypasses CORS.
 */

/* -------------------- Config (localStorage) -------------------- */
const LS = {
  get(k, def = '') { return localStorage.getItem('favoread.' + k) ?? def; },
  set(k, v) { localStorage.setItem('favoread.' + k, v); },
};
const Config = {
  get repo()      { return LS.get('repo', 'hwiruruk/favoread'); },
  get branch()    { return LS.get('branch', 'main'); },
  get path()      { return LS.get('path', 'data.csv'); },
  get token()     { return LS.get('token'); },
  get ttb()       { return LS.get('ttb'); },
  get committer() { return LS.get('committer'); },
  get corsProxy() { return LS.get('corsProxy'); }, // e.g. https://corsproxy.io/?url=
};

/* -------------------- State -------------------- */
const State = {
  headers: [],          // exact header strings from CSV
  col: {},              // canonical name -> index
  celebs: new Map(),    // name -> { name, name_en, img, books:[...] }
  order: [],            // celeb name order (preserves first-appearance ordering)
  originalSha: null,
  selected: null,       // currently selected celeb name
  dirty: false,         // any unsaved change
  bookEditing: null,    // { celebName, bookIndex|null }
};

/* -------------------- Helpers -------------------- */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function toast(msg, kind='') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 3500);
}
function setStatus(msg) { $('#statusMsg').textContent = msg || ''; }
function setDirty(v) {
  State.dirty = v;
  $('#saveBtn').disabled = !v;
  const badge = $('#dirtyBadge');
  badge.classList.toggle('hidden', !v);
  if (v) badge.textContent = '미저장 변경';
  window.onbeforeunload = v ? () => '저장되지 않은 변경이 있습니다.' : null;
}

/* Unicode-safe base64 (for GitHub Contents API) */
function b64encodeUtf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decodeUtf8(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))));
}

/* -------------------- CSV mapping -------------------- */
function buildColIdx(headers) {
  const find = (pred) => {
    for (let i = 0; i < headers.length; i++) if (pred(headers[i])) return i;
    return -1;
  };
  const has = (h, kw) => h.toLowerCase().includes(kw.toLowerCase());
  return {
    name:      find(h => has(h, '연예인') && !has(h, '_en') && !has(h, '이미지')),
    name_en:   headers.indexOf('연예인_en') >= 0 ? headers.indexOf('연예인_en') : find(h => has(h, '연예인') && has(h, '_en')),
    title:     find(h => has(h, '도서명') && !has(h, '_en')),
    title_en:  headers.indexOf('도서명_en') >= 0 ? headers.indexOf('도서명_en') : find(h => has(h, '도서명') && has(h, '_en')),
    author:    find(h => has(h, '저자') && !has(h, '_en')),
    author_en: headers.indexOf('저자_en') >= 0 ? headers.indexOf('저자_en') : find(h => has(h, '저자') && has(h, '_en')),
    pub:       find(h => has(h, '출판사')),
    source:    find(h => has(h, '출처')),
    link:      find(h => has(h, '도서 정보') || has(h, '도서정보')),
    cover:     find(h => has(h, '도서 이미지') || has(h, '도서이미지') || has(h, '표지')),
    img:       find(h => has(h, '연예인 이미지') || has(h, '연예인이미지')),
    comment:   find(h => has(h, '코멘트') || has(h, '한마디')),
  };
}

function loadCsv(text) {
  const result = Papa.parse(text, { skipEmptyLines: false });
  if (!result.data.length) throw new Error('CSV가 비어있습니다.');
  const rows = result.data;
  const headers = rows[0];
  const col = buildColIdx(headers);
  if (col.name < 0 || col.title < 0) throw new Error('필수 컬럼(연예인/도서명) 헤더를 찾지 못했습니다.');

  const celebs = new Map();
  const order = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(c => !c || !String(c).trim())) continue;
    const name = (row[col.name] || '').trim();
    const title = (row[col.title] || '').trim();
    if (!name) continue;
    const get = (k) => col[k] >= 0 && row[col[k]] != null ? String(row[col[k]]).trim() : '';
    if (!celebs.has(name)) {
      celebs.set(name, {
        name,
        name_en: get('name_en'),
        img: get('img'),
        books: [],
      });
      order.push(name);
    }
    const c = celebs.get(name);
    if (!c.name_en && get('name_en')) c.name_en = get('name_en');
    if (!c.img && get('img')) c.img = get('img');
    if (!title) continue;
    c.books.push({
      title,
      title_en: get('title_en'),
      author: get('author'),
      author_en: get('author_en'),
      publisher: get('pub'),
      source: get('source'),
      link: get('link'),
      cover: get('cover'),
      comment: get('comment'),
    });
  }

  State.headers = headers;
  State.col = col;
  State.celebs = celebs;
  State.order = order;
}

function dumpCsv() {
  const { headers, col, celebs, order } = State;
  const out = [headers.slice()];
  const numCols = headers.length;
  const blank = () => Array(numCols).fill('');

  for (const name of order) {
    const c = celebs.get(name);
    if (!c) continue;
    if (!c.books.length) {
      // celeb with no books: emit one row with celeb fields only (so they survive saves)
      const row = blank();
      row[col.name] = c.name;
      if (col.name_en >= 0) row[col.name_en] = c.name_en || '';
      if (col.img    >= 0) row[col.img]    = c.img    || '';
      out.push(row);
      continue;
    }
    for (const b of c.books) {
      const row = blank();
      row[col.name] = c.name;
      if (col.name_en >= 0) row[col.name_en] = c.name_en || '';
      row[col.title] = b.title || '';
      if (col.title_en  >= 0) row[col.title_en]  = b.title_en  || '';
      row[col.author] = b.author || '';
      if (col.author_en >= 0) row[col.author_en] = b.author_en || '';
      if (col.pub     >= 0) row[col.pub]     = b.publisher || '';
      if (col.source  >= 0) row[col.source]  = b.source    || '';
      if (col.link    >= 0) row[col.link]    = b.link      || '';
      if (col.cover   >= 0) row[col.cover]   = b.cover     || '';
      if (col.img     >= 0) row[col.img]     = c.img       || '';
      if (col.comment >= 0) row[col.comment] = b.comment   || '';
      out.push(row);
    }
  }
  // PapaParse's unparse handles quoting consistently with Python csv module (quote-when-needed).
  return Papa.unparse(out, { newline: '\n' }) + '\n';
}

/* -------------------- GitHub API -------------------- */
const Gh = {
  api(path, init={}) {
    const headers = Object.assign({
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }, init.headers || {});
    if (Config.token) headers['Authorization'] = 'Bearer ' + Config.token;
    return fetch('https://api.github.com' + path, { ...init, headers });
  },
  async getFile() {
    if (!Config.token) throw new Error('GitHub Token이 설정되지 않았습니다.');
    const url = `/repos/${Config.repo}/contents/${encodeURIComponent(Config.path)}?ref=${encodeURIComponent(Config.branch)}`;
    const r = await this.api(url);
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 403) {
        throw new Error(
          'GitHub 로드 실패 (403): PAT의 Contents 읽기 권한이 없거나 저장소 접근이 빠졌습니다. ' +
          'Fine-grained PAT 재발급 시 이 저장소 + Contents: Read를 포함하세요.'
        );
      }
      if (r.status === 404) {
        throw new Error(`GitHub 로드 실패 (404): repo/branch/path 또는 PAT 저장소 권한 확인. (${Config.repo}@${Config.branch}:${Config.path})`);
      }
      throw new Error(`GitHub 로드 실패 (${r.status}): ${t}`);
    }
    const j = await r.json();
    return { content: b64decodeUtf8(j.content), sha: j.sha };
  },
  async putFile({ content, sha, message }) {
    const url = `/repos/${Config.repo}/contents/${encodeURIComponent(Config.path)}`;
    const body = {
      message,
      content: b64encodeUtf8(content),
      sha,
      branch: Config.branch,
    };
    if (Config.committer) {
      const m = Config.committer.match(/^(.+?)\s*<(.+)>$/);
      if (m) body.committer = body.author = { name: m[1].trim(), email: m[2].trim() };
    }
    const r = await this.api(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 409 || r.status === 422) {
        throw new Error('저장 실패: 원격 파일이 변경되었습니다. ↻ 불러오기로 동기화 후 다시 시도하세요.');
      }
      if (r.status === 403) {
        throw new Error(
          'GitHub 저장 실패 (403): PAT 권한이 부족합니다. ' +
          'Fine-grained PAT를 재발급하면서 ① 이 저장소 선택 ② Permissions → Contents: Read and write ' +
          '를 반드시 켜주세요. (브랜치 보호 규칙으로 main 직접 푸시가 막혀있을 수도 있음)'
        );
      }
      if (r.status === 404) {
        throw new Error(
          'GitHub 저장 실패 (404): 저장소/브랜치/경로 또는 PAT의 저장소 접근 권한을 확인하세요.'
        );
      }
      throw new Error(`GitHub 저장 실패 (${r.status}): ${t}`);
    }
    const j = await r.json();
    return { sha: j.content.sha };
  },
};

/* -------------------- Aladin API --------------------
 * Aladin TTB OpenAPI restricts requests by Referer matching the URL
 * registered with the TTBKey, so a static page on a different host
 * always gets 403 "Host not in allowlist". The proven workaround
 * (used by the BookStack repo) is to fetch via the allorigins.win
 * proxy: it returns the upstream body wrapped in {contents, status}
 * and Aladin does not see a mismatched Referer.
 *
 * Important details copied from BookStack:
 *  - param name is lowercase `output=js`
 *  - do NOT add a callback param (Aladin returns plain JSON + trailing `;`)
 *  - strip the trailing `;` before JSON.parse
 */
const Aladin = {
  // Default proxies to try in order. Each item: [name, prefix, kind].
  // kind: 'wrap' (response is {contents:..., status:...}) or 'raw' (body is upstream body)
  DEFAULT_PROXIES: [
    ['allorigins-get',  'https://api.allorigins.win/get?url=',          'wrap'],
    ['corsproxy.io',    'https://corsproxy.io/?',                        'raw' ],
    ['codetabs',        'https://api.codetabs.com/v1/proxy/?quest=',     'raw' ],
    ['allorigins-raw',  'https://api.allorigins.win/raw?url=',           'raw' ],
  ],
  _baseParams(extra) {
    const p = new URLSearchParams(extra);
    p.set('ttbkey', Config.ttb);
    p.set('output', 'js');
    p.set('Version', '20131101');
    return p;
  },
  _parseAladinBody(text) {
    let s = String(text || '').trim();
    if (!s) throw new Error('빈 응답');
    if (s.endsWith(';')) s = s.slice(0, -1);
    const m = s.match(/^[^({]*\(([\s\S]*)\)\s*$/);
    if (m) s = m[1];
    return JSON.parse(s);
  },
  async _tryProxy(name, prefix, kind, fullUrl) {
    const proxied = prefix + encodeURIComponent(fullUrl);
    const r = await fetch(proxied);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    let body;
    if (kind === 'wrap') {
      let outer;
      try { outer = JSON.parse(text); }
      catch { throw new Error('proxy JSON 파싱 실패'); }
      if (typeof outer.contents !== 'string') throw new Error('contents 필드 없음');
      body = this._parseAladinBody(outer.contents);
    } else {
      body = this._parseAladinBody(text);
    }
    if (body && body.errorCode) throw new Error(`알라딘 ${body.errorCode}: ${body.errorMessage}`);
    return body;
  },
  async _call(fullUrl) {
    if (!Config.ttb) throw new Error('알라딘 TTBKey가 설정되지 않았습니다.');
    console.log('[Aladin] →', fullUrl);
    // Build proxy list: user override (if any) first, then defaults
    const list = [];
    if (Config.corsProxy) {
      // User can specify a single override; we don't know its kind, so try wrap first then raw
      list.push(['user(wrap)', Config.corsProxy, 'wrap']);
      list.push(['user(raw)',  Config.corsProxy, 'raw']);
    }
    list.push(...this.DEFAULT_PROXIES);

    const errors = [];
    for (const [name, prefix, kind] of list) {
      try {
        const r = await this._tryProxy(name, prefix, kind, fullUrl);
        console.log(`[Aladin] ✓ ${name}`);
        return r;
      } catch (e) {
        console.warn(`[Aladin] ✗ ${name}: ${e.message}`);
        errors.push(`${name}: ${e.message}`);
      }
    }
    throw new Error('모든 프록시 실패 — ' + errors.join(' / '));
  },
  async search(query) {
    const p = this._baseParams({
      Query: query,
      QueryType: 'Keyword',
      MaxResults: '15',
      start: '1',
      SearchTarget: 'Book',
      Cover: 'Big',
    });
    const r = await this._call('https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?' + p);
    return (r && r.item) || [];
  },
  parseItemId(input) {
    const s = String(input || '').trim();
    const m = s.match(/ItemId=(\d+)/i);
    if (m) return m[1];
    if (/^\d+$/.test(s)) return s;
    return null;
  },
  async lookup(itemId) {
    const id = this.parseItemId(itemId) || itemId;
    const p = this._baseParams({
      itemIdType: 'ItemId',
      ItemId: id,
      Cover: 'Big',
    });
    const r = await this._call('https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?' + p);
    return (r && r.item && r.item[0]) || null;
  },
  bigCover(item) {
    const c = item && item.cover;
    if (!c) return '';
    return c
      .replace(/\/cover(?:150|200|s|sum)\//, '/cover500/')
      .replace('coversum', 'cover500');
  },
};

/* -------------------- Render: Sidebar -------------------- */
function applyFilter(name) {
  const c = State.celebs.get(name);
  if (!c) return false;
  const f = $('#filterSelect').value;
  if (f === 'missing-en')    return !c.name_en || c.books.some(b => !b.title_en || !b.author_en);
  if (f === 'missing-cover') return c.books.some(b => !b.cover);
  if (f === 'missing-img')   return !c.img;
  return true;
}
function renderSidebar() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const ul = $('#celebList');
  const matches = (name) => {
    if (!q) return true;
    if (name.toLowerCase().includes(q)) return true;
    const c = State.celebs.get(name);
    if ((c.name_en || '').toLowerCase().includes(q)) return true;
    return c.books.some(b =>
      (b.title || '').toLowerCase().includes(q) ||
      (b.title_en || '').toLowerCase().includes(q) ||
      (b.author || '').toLowerCase().includes(q));
  };
  let html = '';
  let nCelebs = 0, nBooks = 0, nEn = 0, nEnTotal = 0;
  for (const name of State.order) {
    const c = State.celebs.get(name);
    nCelebs++;
    nBooks += c.books.length;
    for (const b of c.books) {
      nEnTotal += 2; // title_en + author_en
      if (b.title_en) nEn++;
      if (b.author_en) nEn++;
    }
    if (!matches(name) || !applyFilter(name)) continue;
    const warnEn = !c.name_en || c.books.some(b => !b.title_en || !b.author_en);
    const warnImg = !c.img;
    html += `<li data-name="${esc(name)}" class="${name === State.selected ? 'active' : ''}">
      <div class="ci-name">
        ${esc(name)}
        ${warnImg ? '<span class="ci-warn" title="이미지 누락">📷</span>' : ''}
        ${warnEn ? '<span class="ci-warn" title="영문명 누락">EN</span>' : ''}
        <div class="ci-en">${esc(c.name_en || '')}</div>
      </div>
      <span class="ci-count">${c.books.length}</span>
    </li>`;
  }
  ul.innerHTML = html || '<li class="muted" style="padding:14px;text-align:center;">검색 결과 없음</li>';

  $('#countCelebs').textContent = nCelebs;
  $('#countBooks').textContent = nBooks;
  $('#countEn').textContent = nEnTotal ? Math.round(nEn / nEnTotal * 100) + '%' : '-';
}

$('#celebList').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-name]');
  if (!li) return;
  selectCeleb(li.dataset.name);
});

$('#searchInput').addEventListener('input', renderSidebar);
$('#filterSelect').addEventListener('change', renderSidebar);

/* -------------------- Render: Detail -------------------- */
function selectCeleb(name) {
  State.selected = name;
  renderSidebar();
  renderDetail();
}

function renderDetail() {
  const name = State.selected;
  if (!name || !State.celebs.has(name)) {
    $('#detailEmpty').classList.remove('hidden');
    $('#detailContent').classList.add('hidden');
    return;
  }
  $('#detailEmpty').classList.add('hidden');
  $('#detailContent').classList.remove('hidden');
  const c = State.celebs.get(name);
  $('#celebName').value = c.name;
  $('#celebNameEn').value = c.name_en || '';
  $('#celebImg').value = c.img || '';
  $('#celebImgPreview').src = c.img || '';
  $('#bookCount').textContent = `(${c.books.length}권)`;
  renderBooks();
}

function renderBooks() {
  const c = State.celebs.get(State.selected);
  const list = $('#booksList');
  if (!c || !c.books.length) {
    list.innerHTML = '<p class="muted">아직 추천 도서가 없습니다. 우측 상단 <b>+ 책 추가</b>로 등록하세요.</p>';
    return;
  }
  let html = '';
  c.books.forEach((b, i) => {
    const flagEn = (!b.title_en || !b.author_en) ? '<span class="flag warn">EN 누락</span>' : '';
    const flagCv = !b.cover ? '<span class="flag warn">표지 없음</span>' : '';
    const flagSrc = !b.source ? '<span class="flag warn">출처 없음</span>' : '';
    html += `<div class="book-card" data-idx="${i}">
      <div class="cv">${b.cover ? `<img src="${esc(b.cover)}" referrerpolicy="no-referrer" alt="">` : ''}</div>
      <div class="meta">
        <p class="b-title">${esc(b.title)}</p>
        <p class="b-author">${esc(b.author)} ${b.author_en ? `<span class="muted">/ ${esc(b.author_en)}</span>` : ''}</p>
        <p class="b-pub">${esc(b.publisher || '')}</p>
        <div class="b-flags">${flagEn}${flagCv}${flagSrc}</div>
        <div class="actions">
          <button class="btn small" data-act="edit">편집</button>
          ${b.link ? `<a class="btn small" href="${esc(b.link)}" target="_blank" rel="noopener">알라딘</a>` : ''}
          <button class="btn small danger" data-act="del">삭제</button>
        </div>
      </div>
    </div>`;
  });
  list.innerHTML = html;
}

$('#booksList').addEventListener('click', (e) => {
  const card = e.target.closest('.book-card'); if (!card) return;
  const idx = parseInt(card.dataset.idx, 10);
  const act = e.target.dataset.act;
  const c = State.celebs.get(State.selected);
  if (act === 'edit') openBookDialog(c.books[idx], idx);
  if (act === 'del') {
    if (!confirm(`"${c.books[idx].title}" 책을 삭제하시겠습니까?`)) return;
    c.books.splice(idx, 1);
    setDirty(true);
    renderDetail(); renderSidebar();
  }
});

/* Celeb-level field changes */
['celebName', 'celebNameEn', 'celebImg'].forEach(id => {
  $('#' + id).addEventListener('change', () => {
    const old = State.selected;
    const c = State.celebs.get(old);
    if (!c) return;
    const newName = $('#celebName').value.trim();
    const newEn = $('#celebNameEn').value.trim();
    const newImg = $('#celebImg').value.trim();
    if (!newName) { toast('연예인 이름은 비울 수 없습니다.', 'err'); $('#celebName').value = c.name; return; }
    if (newName !== old) {
      if (State.celebs.has(newName)) { toast('이미 존재하는 이름입니다.', 'err'); $('#celebName').value = c.name; return; }
      // rename: keep order position
      State.celebs.delete(old);
      c.name = newName;
      State.celebs.set(newName, c);
      const i = State.order.indexOf(old);
      if (i >= 0) State.order[i] = newName;
      State.selected = newName;
    }
    c.name_en = newEn;
    c.img = newImg;
    $('#celebImgPreview').src = newImg || '';
    setDirty(true);
    renderSidebar();
  });
});

$('#deleteCelebBtn').addEventListener('click', () => {
  const name = State.selected; if (!name) return;
  if (!confirm(`"${name}" 연예인과 모든 추천 도서를 삭제하시겠습니까?`)) return;
  State.celebs.delete(name);
  State.order = State.order.filter(n => n !== name);
  State.selected = null;
  setDirty(true);
  renderDetail(); renderSidebar();
});

$('#renameApplyBtn').addEventListener('click', () => {
  setDirty(true);
  toast('적용됨 (저장하면 모든 행에 반영됩니다)', 'ok');
});

$('#addCelebBtn').addEventListener('click', () => {
  const name = prompt('새 연예인 이름 (한글)');
  if (!name) return;
  const t = name.trim();
  if (!t) return;
  if (State.celebs.has(t)) { toast('이미 존재합니다', 'err'); return; }
  State.celebs.set(t, { name: t, name_en: '', img: '', books: [] });
  State.order.push(t);
  setDirty(true);
  selectCeleb(t);
});

$('#addBookBtn').addEventListener('click', () => {
  if (!State.selected) return;
  openBookDialog(null, null);
});

/* -------------------- Book dialog -------------------- */
const bookDlg = $('#bookDialog');
function openBookDialog(book, index) {
  State.bookEditing = { celebName: State.selected, bookIndex: index };
  $('#bookDialogTitle').textContent = book ? '책 편집' : '책 추가';
  const fields = {
    bookTitle: book?.title, bookTitleEn: book?.title_en,
    bookAuthor: book?.author, bookAuthorEn: book?.author_en,
    bookPublisher: book?.publisher, bookSource: book?.source,
    bookLink: book?.link, bookCover: book?.cover,
    bookComment: book?.comment,
  };
  for (const [id, v] of Object.entries(fields)) $('#' + id).value = v || '';
  $('#bookCoverPreview').src = book?.cover || '';
  $('#aladinResults').innerHTML = '';
  $('#aladinQuery').value = book?.title || '';
  $('#aladinItemId').value = book?.link || '';
  bookDlg.showModal();
}

$$('[data-close]').forEach(b => b.addEventListener('click', (e) => {
  e.target.closest('dialog').close();
}));

$('#bookCover').addEventListener('input', () => {
  $('#bookCoverPreview').src = $('#bookCover').value || '';
});

$('#bookForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('#bookTitle').value.trim();
  const author = $('#bookAuthor').value.trim();
  if (!title || !author) { toast('도서명과 저자는 필수', 'err'); return; }
  const data = {
    title,
    title_en: $('#bookTitleEn').value.trim(),
    author,
    author_en: $('#bookAuthorEn').value.trim(),
    publisher: $('#bookPublisher').value.trim(),
    source: $('#bookSource').value.trim(),
    link: $('#bookLink').value.trim(),
    cover: $('#bookCover').value.trim(),
    comment: $('#bookComment').value.trim(),
  };
  const ed = State.bookEditing;
  const c = State.celebs.get(ed.celebName);
  if (ed.bookIndex == null) c.books.push(data);
  else c.books[ed.bookIndex] = data;
  setDirty(true);
  bookDlg.close();
  renderDetail(); renderSidebar();
});

/* Aladin search inside dialog */
async function runAladinSearch(query) {
  const box = $('#aladinResults');
  box.innerHTML = '<div class="empty">검색 중…</div>';
  try {
    const items = await Aladin.search(query);
    if (!items.length) { box.innerHTML = '<div class="empty">결과 없음</div>'; return; }
    let html = '';
    items.forEach((it, i) => {
      const cover = Aladin.bigCover(it);
      html += `<div class="ar-item" data-i="${i}">
        <div class="ar-cover">${cover ? `<img src="${esc(cover)}" referrerpolicy="no-referrer" alt="">` : ''}</div>
        <div class="ar-meta">
          <div class="ar-title">${esc(it.title)}</div>
          <div class="ar-sub">${esc(it.author || '')} · ${esc(it.publisher || '')}</div>
          <div class="ar-sub muted">${esc(it.pubDate || '')} · ItemId ${it.itemId}</div>
        </div>
      </div>`;
    });
    box.innerHTML = html;
    box._items = items;
  } catch (err) {
    box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}
function applyAladinItem(it) {
  const cover = Aladin.bigCover(it);
  $('#bookTitle').value = it.title || $('#bookTitle').value;
  $('#bookAuthor').value = it.author || $('#bookAuthor').value;
  $('#bookPublisher').value = it.publisher || $('#bookPublisher').value;
  $('#bookLink').value = it.link || $('#bookLink').value;
  if (cover) $('#bookCover').value = cover;
  $('#bookCoverPreview').src = cover || '';
}

$('#aladinSearchBtn').addEventListener('click', () => {
  const q = $('#aladinQuery').value.trim();
  if (q) runAladinSearch(q);
});
$('#aladinQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#aladinSearchBtn').click(); }
});
$('#aladinResults').addEventListener('click', (e) => {
  const row = e.target.closest('.ar-item'); if (!row) return;
  const items = $('#aladinResults')._items || [];
  const it = items[+row.dataset.i];
  if (it) applyAladinItem(it);
});
$('#aladinLookupBtn').addEventListener('click', async () => {
  const id = Aladin.parseItemId($('#aladinItemId').value);
  if (!id) { toast('ItemId 또는 알라딘 URL을 입력하세요', 'err'); return; }
  try {
    const it = await Aladin.lookup(id);
    if (!it) { toast('해당 ItemId의 책을 찾지 못했습니다', 'err'); return; }
    applyAladinItem(it);
    toast('알라딘 정보 적용됨', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
});

/* -------------------- Settings dialog -------------------- */
const settingsDlg = $('#settingsDialog');
function loadSettingsToForm() {
  $('#cfgRepo').value = Config.repo;
  $('#cfgBranch').value = Config.branch;
  $('#cfgPath').value = Config.path;
  $('#cfgToken').value = Config.token;
  $('#cfgTtb').value = Config.ttb;
  $('#cfgCorsProxy').value = Config.corsProxy;
  $('#cfgCommitter').value = Config.committer;
}
$('#settingsBtn').addEventListener('click', () => { loadSettingsToForm(); settingsDlg.showModal(); });
$('#saveSettingsBtn').addEventListener('click', () => {
  LS.set('repo', $('#cfgRepo').value.trim());
  LS.set('branch', $('#cfgBranch').value.trim());
  LS.set('path', $('#cfgPath').value.trim() || 'data.csv');
  LS.set('token', $('#cfgToken').value.trim());
  LS.set('ttb', $('#cfgTtb').value.trim());
  LS.set('corsProxy', $('#cfgCorsProxy').value.trim());
  LS.set('committer', $('#cfgCommitter').value.trim());
  $('#branchTag').textContent = `${Config.repo} @ ${Config.branch}`;
  toast('설정 저장됨', 'ok');
  settingsDlg.close();
});

/* -------------------- Load / Save -------------------- */
async function reloadFromGithub() {
  if (State.dirty && !confirm('미저장 변경이 있습니다. 그래도 다시 불러오시겠습니까?')) return;
  setStatus('GitHub에서 불러오는 중…');
  try {
    const { content, sha } = await Gh.getFile();
    loadCsv(content);
    State.originalSha = sha;
    State.selected = null;
    setDirty(false);
    setStatus(`로드 완료 · ${State.celebs.size}명, sha ${sha.slice(0,7)}`);
    renderSidebar(); renderDetail();
    toast('불러오기 완료', 'ok');
  } catch (err) {
    setStatus('');
    toast(err.message, 'err');
  }
}

async function saveToGithub() {
  if (!State.dirty) return;
  if (!Config.token) { toast('GitHub Token을 먼저 설정하세요', 'err'); settingsDlg.showModal(); return; }
  const content = dumpCsv();
  const message = prompt('커밋 메시지', `편집기에서 데이터 업데이트 (${new Date().toISOString().slice(0,16).replace('T',' ')})`);
  if (!message) return;
  setStatus('GitHub에 저장 중…');
  $('#saveBtn').disabled = true;
  try {
    const { sha } = await Gh.putFile({ content, sha: State.originalSha, message });
    State.originalSha = sha;
    setDirty(false);
    setStatus(`저장 완료 · sha ${sha.slice(0,7)}`);
    toast('저장됨 (커밋 + push 완료)', 'ok');
  } catch (err) {
    setStatus('');
    setDirty(true);
    toast(err.message, 'err');
  }
}

$('#reloadBtn').addEventListener('click', reloadFromGithub);
$('#saveBtn').addEventListener('click', saveToGithub);

/* -------------------- Boot -------------------- */
(function init() {
  $('#branchTag').textContent = `${Config.repo} @ ${Config.branch}`;
  if (!Config.token || !Config.ttb) {
    loadSettingsToForm();
    settingsDlg.showModal();
    setStatus('설정을 입력한 뒤 ↻ 불러오기로 시작하세요.');
  } else {
    reloadFromGithub();
  }
})();
