import csv, datetime, os, json, re
from urllib.parse import quote

BASE  = "https://hwiruruk.github.io/favoread/"
TODAY = datetime.date.today().isoformat()
LINK_CLASS = (
    'inline-block px-3 py-1.5 border-2 border-ink rounded-none '
    'bg-white hover:bg-neo-yellow shadow-neo-sm hover:shadow-neo '
    'hover:-translate-y-0.5 transition-all text-[11px] sm:text-xs '
    'font-bold font-sans text-ink'
)

# ── 1. CSV 파싱 ──────────────────────────────────────────────────────
celebs = {}

with open("data.csv", encoding="utf-8") as f:
    reader = csv.reader(f)
    headers = next(reader)

    def find_col(keywords, fallback):
        for i, h in enumerate(headers):
            if any(w in h.lower() for w in keywords):
                return i
        return fallback

    C = {
        'name':    find_col(['연예인', '이름', '인물'], 0),
        'title':   find_col(['도서명', '제목', '책'],   1),
        'author':  find_col(['저자', '작가'],            2),
        'pub':     find_col(['출판사'],                  3),
        'src':     find_col(['출처', '근거'],            4),
        'link':    find_col(['도서 정보', '링크', 'url'], 5),
        'cover':   find_col(['도서 이미지', '표지'],     6),
        'img':     find_col(['연예인이미지', 'photo', '이미지주소'], 7),
        'comment': find_col(['코멘트', '한마디'],        8),
    }

    for row in reader:
        if not row or not row[C['name']].strip():
            continue
        name  = row[C['name']].strip()
        title = row[C['title']].strip() if len(row) > C['title'] else ''
        if not title:
            continue

        def get(col):
            return row[col].strip() if len(row) > col else ''

        img_url = get(C['img'])
        if not img_url.startswith('http'):
            img_url = BASE + 'og-image.jpg'

        if name not in celebs:
            celebs[name] = {'img': img_url, 'books': []}

        celebs[name]['books'].append({
            'title':     title,
            'author':    get(C['author']),
            'publisher': get(C['pub']),
            'source':    get(C['src']),
            'link':      get(C['link']),
            'coverUrl':  get(C['cover']),
            'comment':   get(C['comment']),
        })

print(f"CSV 파싱 완료: {len(celebs)}명")

# ── 2. data.json 생성 ────────────────────────────────────────────────
data_json = {
    'generated': TODAY,
    'celebs': {
        name: {
            'imageUrl': info['img'],
            'books':    info['books'],
        }
        for name, info in celebs.items()
    }
}
with open('data.json', 'w', encoding='utf-8') as f:
    json.dump(data_json, f, ensure_ascii=False, separators=(',', ':'))
print(f"✅ data.json 생성: {os.path.getsize('data.json') // 1024}KB")

# ── 3. index.html 정적 셀럽 목록 갱신 ───────────────────────────────
sorted_names = sorted(celebs.keys(), key=lambda x: x.lower())

new_links = '\n'.join(
    '      <a href="share/' + quote(n.replace('/', '_').replace('\\', '_'), safe='') + '.html" class="' + LINK_CLASS + '">' + n + '</a>'
    for n in sorted_names
)

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

html = re.sub(
    r'등록된 셀럽 · 아이돌 · 배우 전체 목록 \d+명',
    '등록된 셀럽 · 아이돌 · 배우 전체 목록 ' + str(len(celebs)) + '명',
    html
)
html = re.sub(
    r'(<div id="all-celebs-container"[^>]*>).*?(</div>\s*</section>\s*</main>)',
    lambda m: m.group(1) + '\n' + new_links + '\n    ' + m.group(2),
    html,
    flags=re.DOTALL
)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print(f"✅ index.html 정적 목록 갱신: {len(sorted_names)}명")

# ── 4. share 페이지 생성 ─────────────────────────────────────────────
os.makedirs('share', exist_ok=True)

for name, info in celebs.items():
    img       = info['img']
    books     = info['books']
    safe      = quote(name, safe='')
    file_name = name.replace('/', '_').replace('\\', '_')
    page_url  = BASE + 'share/' + quote(file_name, safe='') + '.html'

    json_ld = {
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        'name': name + '의 독서 리스트 | 최애의 독서',
        'url': page_url,
        'mainEntity': {
            '@type': 'Person',
            'name': name,
            'image': img,
            'description': name + '이(가) 읽거나 추천한 책 ' + str(len(books)) + '권',
            'knowsAbout': {
                '@type': 'ItemList',
                'numberOfItems': len(books),
                'itemListElement': [
                    {'@type': 'ListItem', 'position': i + 1, 'name': b['title']}
                    for i, b in enumerate(books)
                ]
            }
        }
    }

    book_rows = '\n'.join(
        '      <tr><td>' + str(i+1) + '</td><td>' + b['title'] + '</td>'
        '<td>' + b['author'] + '</td><td>' + b['publisher'] + '</td></tr>'
        for i, b in enumerate(books)
    )

    redirect_url = BASE + '?celeb=' + safe

    page = (
        '<!DOCTYPE html>\n'
        '<html lang="ko">\n'
        '<head>\n'
        '  <meta charset="utf-8">\n'
        '  <title>' + name + '의 독서 리스트 | 최애의 독서</title>\n'
        '  <meta name="description" content="' + name + '의 읽은 책이 궁금하다면? ✨ 총 ' + str(len(books)) + '권의 읽은 책과 추천하는 책, 인생책까지 확인해 보세요. #' + name + ' #책추천 #읽은책 #독서 #도서">\n'
        '  <meta property="og:title" content="' + name + ' | 최애의 독서">\n'
        '  <meta property="og:description" content="' + name + '의 읽은 책이 궁금하다면? ✨ 총 ' + str(len(books)) + '권의 읽은 책과 추천하는 책, 인생책까지 확인해 보세요. #' + name + ' #책추천 #읽은책 #독서 #도서">\n'
        '  <meta property="og:image" content="' + img + '">\n'
        '  <meta property="og:url" content="' + page_url + '">\n'
        '  <meta property="og:type" content="profile">\n'
        '  <meta name="twitter:card" content="summary_large_image">\n'
        '  <link rel="canonical" href="' + page_url + '">\n'
        '  <script type="application/ld+json">\n'
        '  ' + json.dumps(json_ld, ensure_ascii=False, indent=2) + '\n'
        '  </script>\n'
        '</head>\n'
        '<body>\n'
        '  <h1>' + name + '의 독서 리스트</h1>\n'
        '  <p>' + name + '이(가) 읽거나 추천한 책 ' + str(len(books)) + '권입니다.</p>\n'
        '  <table>\n'
        '    <thead><tr><th>#</th><th>도서명</th><th>저자</th><th>출판사</th></tr></thead>\n'
        '    <tbody>\n'
        + book_rows + '\n'
        '    </tbody>\n'
        '  </table>\n'
        '  <p><a href="' + redirect_url + '">최애의 독서에서 ' + name + ' 전체 목록 보기</a></p>\n'
        '  <script>\n'
        '    if (!/bot|crawl|spider/i.test(navigator.userAgent)) {\n'
        '      window.location.replace("' + redirect_url + '");\n'
        '    }\n'
        '  </script>\n'
        '</body>\n'
        '</html>'
    )

    with open('share/' + file_name + '.html', 'w', encoding='utf-8') as f:
        f.write(page)

print(f"✅ share 페이지 생성: {len(celebs)}개")

# ── 5. 책 역방향 페이지 (share/book/*.html) ─────────────────────────
os.makedirs('share/book', exist_ok=True)

# 책별로 읽은 셀럽 집계
book_celebs = {}  # { title: { 'celebs': [name,...], 'author': '', 'publisher': '', 'coverUrl': '' } }
for name, info in celebs.items():
    seen = set()
    for b in info['books']:
        t = b['title'].strip()
        if t in seen:
            continue
        seen.add(t)
        if t not in book_celebs:
            book_celebs[t] = {'celebs': [], 'author': b['author'], 'publisher': b['publisher'], 'coverUrl': b.get('coverUrl', '')}
        book_celebs[t]['celebs'].append(name)

book_pages = []
for title, binfo in book_celebs.items():
    if len(binfo['celebs']) < 2:
        continue  # 2명 이상이 읽은 책만 페이지 생성
    
    file_name = title.replace('/', '_').replace('\\', '_').replace(':', '_').replace('"', '_').replace('?', '_')
    page_url = BASE + 'share/book/' + quote(file_name, safe='') + '.html'
    celeb_count = len(binfo['celebs'])
    
    celeb_rows = '\n'.join(
        '      <li><a href="../' + quote(c.replace('/', '_').replace('\\', '_'), safe='') + '.html">' + c + '</a></li>'
        for c in sorted(binfo['celebs'])
    )
    
    json_ld = {
        '@context': 'https://schema.org',
        '@type': 'Book',
        'name': title,
        'author': {'@type': 'Person', 'name': binfo['author']} if binfo['author'] else None,
        'description': str(celeb_count) + '명의 셀럽이 읽은 책',
    }
    json_ld = {k: v for k, v in json_ld.items() if v is not None}
    
    page = (
        '<!DOCTYPE html>\n'
        '<html lang="ko">\n'
        '<head>\n'
        '  <meta charset="utf-8">\n'
        '  <title>' + title + ' - ' + str(celeb_count) + '명의 셀럽이 읽은 책 | 최애의 독서</title>\n'
        '  <meta name="description" content="' + title + '을(를) 읽은 셀럽 ' + str(celeb_count) + '명! '
        + ', '.join(binfo['celebs'][:5]) + ' 등이 읽은 책입니다. #책추천 #셀럽독서">\n'
        '  <meta property="og:title" content="' + title + ' | ' + str(celeb_count) + '명의 셀럽이 읽은 책">\n'
        '  <meta property="og:description" content="' + ', '.join(binfo['celebs'][:5]) + ' 등 ' + str(celeb_count) + '명이 읽은 책">\n'
        '  <meta property="og:url" content="' + page_url + '">\n'
        '  <meta property="og:type" content="book">\n'
        '  <meta name="twitter:card" content="summary">\n'
        '  <link rel="canonical" href="' + page_url + '">\n'
        '  <script type="application/ld+json">\n'
        '  ' + json.dumps(json_ld, ensure_ascii=False, indent=2) + '\n'
        '  </script>\n'
        '</head>\n'
        '<body>\n'
        '  <h1>' + title + '</h1>\n'
        '  <p>' + binfo['author'] + (' · ' + binfo['publisher'] if binfo['publisher'] else '') + '</p>\n'
        '  <h2>이 책을 읽은 셀럽 (' + str(celeb_count) + '명)</h2>\n'
        '  <ul>\n' + celeb_rows + '\n  </ul>\n'
        '  <p><a href="' + BASE + '">최애의 독서 홈으로</a></p>\n'
        '  <script>\n'
        '    if (!/bot|crawl|spider/i.test(navigator.userAgent)) {\n'
        '      window.location.replace("' + BASE + '?q=' + quote(title, safe='') + '");\n'
        '    }\n'
        '  </script>\n'
        '</body>\n'
        '</html>'
    )
    
    with open('share/book/' + file_name + '.html', 'w', encoding='utf-8') as f:
        f.write(page)
    book_pages.append((file_name, title))

print(f"✅ 책 역방향 페이지 생성: {len(book_pages)}개")

# ── 6. 랭킹 페이지 (share/ranking.html) ─────────────────────────────
top_books = sorted(book_celebs.items(), key=lambda x: len(x[1]['celebs']), reverse=True)[:30]
top_authors = {}
top_publishers = {}
for name, info in celebs.items():
    for b in info['books']:
        a = b['author'].strip()
        p = b['publisher'].strip()
        if a:
            top_authors[a] = top_authors.get(a, 0) + 1
        if p:
            top_publishers[p] = top_publishers.get(p, 0) + 1

top_authors_list = sorted(top_authors.items(), key=lambda x: x[1], reverse=True)[:20]
top_publishers_list = sorted(top_publishers.items(), key=lambda x: x[1], reverse=True)[:15]

ranking_books_html = '\n'.join(
    '      <tr><td>' + str(i+1) + '</td><td>' + t + '</td><td>' + str(len(bi['celebs'])) + '명</td>'
    '<td>' + ', '.join(bi['celebs'][:5]) + ('...' if len(bi['celebs']) > 5 else '') + '</td></tr>'
    for i, (t, bi) in enumerate(top_books)
)
ranking_authors_html = '\n'.join(
    '      <tr><td>' + str(i+1) + '</td><td>' + a + '</td><td>' + str(c) + '회</td></tr>'
    for i, (a, c) in enumerate(top_authors_list)
)
ranking_pub_html = '\n'.join(
    '      <tr><td>' + str(i+1) + '</td><td>' + p + '</td><td>' + str(c) + '회</td></tr>'
    for i, (p, c) in enumerate(top_publishers_list)
)

ranking_url = BASE + 'share/ranking.html'
ranking_page = (
    '<!DOCTYPE html>\n'
    '<html lang="ko">\n'
    '<head>\n'
    '  <meta charset="utf-8">\n'
    '  <title>셀럽이 가장 많이 읽은 책·저자·출판사 랭킹 | 최애의 독서</title>\n'
    '  <meta name="description" content="셀럽이 가장 많이 읽은 책 TOP 30, 저자 TOP 20, 출판사 TOP 15를 확인해 보세요. 아이돌·배우·뮤지션의 독서 트렌드!">\n'
    '  <meta property="og:title" content="셀럽 독서 랭킹 | 최애의 독서">\n'
    '  <meta property="og:description" content="셀럽이 가장 많이 읽은 책·저자·출판사 랭킹">\n'
    '  <meta property="og:url" content="' + ranking_url + '">\n'
    '  <link rel="canonical" href="' + ranking_url + '">\n'
    '</head>\n'
    '<body>\n'
    '  <h1>셀럽 독서 랭킹</h1>\n'
    '\n'
    '  <h2>가장 많이 읽힌 책 TOP 30</h2>\n'
    '  <table>\n'
    '    <thead><tr><th>#</th><th>도서명</th><th>읽은 셀럽</th><th>누가 읽었나</th></tr></thead>\n'
    '    <tbody>\n' + ranking_books_html + '\n    </tbody>\n'
    '  </table>\n'
    '\n'
    '  <h2>가장 많이 읽힌 저자 TOP 20</h2>\n'
    '  <table>\n'
    '    <thead><tr><th>#</th><th>저자</th><th>언급 횟수</th></tr></thead>\n'
    '    <tbody>\n' + ranking_authors_html + '\n    </tbody>\n'
    '  </table>\n'
    '\n'
    '  <h2>가장 많이 읽힌 출판사 TOP 15</h2>\n'
    '  <table>\n'
    '    <thead><tr><th>#</th><th>출판사</th><th>언급 횟수</th></tr></thead>\n'
    '    <tbody>\n' + ranking_pub_html + '\n    </tbody>\n'
    '  </table>\n'
    '\n'
    '  <p><a href="' + BASE + '">최애의 독서 홈으로</a></p>\n'
    '  <script>\n'
    '    if (!/bot|crawl|spider/i.test(navigator.userAgent)) {\n'
    '      window.location.replace("' + BASE + '");\n'
    '    }\n'
    '  </script>\n'
    '</body>\n'
    '</html>'
)

with open('share/ranking.html', 'w', encoding='utf-8') as f:
    f.write(ranking_page)
print("✅ 랭킹 페이지 생성: share/ranking.html")

# ── 7. sitemap.xml 생성 (책 역방향 + 랭킹 포함) ────────────────────
lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    '    <loc>' + BASE + '</loc>',
    '    <lastmod>' + TODAY + '</lastmod>',
    '    <changefreq>daily</changefreq>',
    '    <priority>1.0</priority>',
    '  </url>',
    '  <url>',
    '    <loc>' + ranking_url + '</loc>',
    '    <lastmod>' + TODAY + '</lastmod>',
    '    <changefreq>weekly</changefreq>',
    '    <priority>0.8</priority>',
    '  </url>',
]
for name in celebs:
    fn = name.replace('/', '_').replace('\\', '_')
    lines += [
        '  <url>',
        '    <loc>' + BASE + 'share/' + quote(fn, safe='') + '.html</loc>',
        '    <lastmod>' + TODAY + '</lastmod>',
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.7</priority>',
        '  </url>',
    ]
for fn, title in book_pages:
    lines += [
        '  <url>',
        '    <loc>' + BASE + 'share/book/' + quote(fn, safe='') + '.html</loc>',
        '    <lastmod>' + TODAY + '</lastmod>',
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.6</priority>',
        '  </url>',
    ]
lines.append('</urlset>')

with open('sitemap.xml', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')
total_urls = 1 + 1 + len(celebs) + len(book_pages)
print(f"✅ sitemap.xml 생성: {total_urls}개 URL")

# ── 8. feed.xml 자동 생성 ───────────────────────────────────────────
import email.utils, time

def rfc822(date_str):
    """YYYY-MM-DD → RFC 822 형식"""
    t = time.strptime(date_str, '%Y-%m-%d')
    return email.utils.formatdate(time.mktime(t), localtime=True)

pub_date = rfc822(TODAY)

feed_items = []
# 가장 많이 읽힌 책 TOP 5를 RSS 아이템으로
for title, binfo in top_books[:5]:
    fn = title.replace('/', '_').replace('\\', '_').replace(':', '_').replace('"', '_').replace('?', '_')
    book_url = BASE + 'share/book/' + quote(fn, safe='') + '.html'
    feed_items.append(
        '  <item>\n'
        '    <title>' + title + ' - ' + str(len(binfo['celebs'])) + '명의 셀럽이 읽은 책</title>\n'
        '    <link>' + book_url + '</link>\n'
        '    <description>' + ', '.join(binfo['celebs']) + '이(가) 읽은 책입니다.</description>\n'
        '    <pubDate>' + pub_date + '</pubDate>\n'
        '    <guid>' + book_url + '</guid>\n'
        '  </item>'
    )

# 가장 많은 책을 읽은 셀럽 TOP 3
top_celeb_list = sorted(celebs.items(), key=lambda x: len(x[1]['books']), reverse=True)[:3]
for name, info in top_celeb_list:
    fn = name.replace('/', '_').replace('\\', '_')
    celeb_url = BASE + 'share/' + quote(fn, safe='') + '.html'
    feed_items.append(
        '  <item>\n'
        '    <title>' + name + '의 독서 리스트 (' + str(len(info['books'])) + '권)</title>\n'
        '    <link>' + celeb_url + '</link>\n'
        '    <description>' + name + '이(가) 읽거나 추천한 책 ' + str(len(info['books'])) + '권을 확인해 보세요.</description>\n'
        '    <pubDate>' + pub_date + '</pubDate>\n'
        '    <guid>' + celeb_url + '</guid>\n'
        '  </item>'
    )

feed_xml = (
    '<?xml version="1.0" encoding="UTF-8" ?>\n'
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n'
    '<channel>\n'
    '  <title>최애의 독서 | 당신이 좋아하는, 그들이 읽은 책</title>\n'
    '  <link>' + BASE + '</link>\n'
    '  <description>아이돌, 셀럽, 연예인 나의 최애가 읽은 책, 추천 책, 인생책을 한곳에 모은 아카이브입니다.</description>\n'
    '  <language>ko-kr</language>\n'
    '  <lastBuildDate>' + pub_date + '</lastBuildDate>\n'
    '  <atom:link href="' + BASE + 'feed.xml" rel="self" type="application/rss+xml" />\n'
    '\n' + '\n\n'.join(feed_items) + '\n'
    '</channel>\n'
    '</rss>\n'
)

with open('feed.xml', 'w', encoding='utf-8') as f:
    f.write(feed_xml)
print(f"✅ feed.xml 자동 생성: {len(feed_items)}개 아이템")
