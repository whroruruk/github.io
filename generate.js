const fs = require('fs');

// CSV 파일 읽기
const csv = fs.readFileSync('./_data/list.csv', 'utf-8');
const rows = csv.split('\n').filter(line => line.trim() !== '');

// 첫 번째 줄(헤더)에서 '이름' 컬럼의 위치 찾기
const headers = rows[0].split(',');
const nameIdx = headers.findIndex(h => h.includes('이름'));

if (nameIdx === -1) {
  console.error('CSV 파일에서 이름 컬럼을 찾을 수 없습니다.');
  process.exit(1);
}

// 중복 없는 연예인 이름 추출
const celebs = new Set();
for (let i = 1; i < rows.length; i++) {
  const cols = rows[i].split(',');
  // 줄바꿈 기호나 따옴표를 제거하고 이름만 추출합니다.
  const name = cols[nameIdx]?.replace(/["\r]/g, '').trim();
  if (name) celebs.add(name);
}

// _celebs 폴더가 없으면 생성
if (!fs.existsSync('./_celebs')) {
  fs.mkdirSync('./_celebs');
}

// 각 이름별로 마크다운 파일 일괄 자동 생성
celebs.forEach(name => {
  const content = `---\ntitle: ${name}\nimage: ""\n---\n`;
  fs.writeFileSync(`./_celebs/${name}.md`, content, 'utf-8');
});

console.log(`${celebs.size}명의 개별 문서가 자동 생성되었습니다.`);
