// agents/*.md의 frontmatter를 읽는 작은 파서 (외부 의존성 없음).
// 지원: `key: value`, 따옴표 문자열, true/false/숫자, 인라인 리스트 `[a, b]`, 블록 리스트(`- a`), `#` 주석.

const stripComment = (s) => {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
};

const scalar = (raw) => {
  const v = raw.trim();
  if (v === '') return '';
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(',').map((x) => scalar(x)).filter((x) => x !== '') : [];
  }
  return v;
};

export function parseFrontmatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error('frontmatter(--- ... ---)가 없습니다');
  const data = {};
  let listKey = null;
  const blockKeys = new Set();
  m[1].split(/\r?\n/).forEach((line, i) => {
    const l = stripComment(line).replace(/\s+$/, '');
    if (!l.trim()) return;
    const item = /^\s+-\s+(.*)$/.exec(l) || /^-\s+(.*)$/.exec(l);
    if (item && listKey) { data[listKey].push(scalar(item[1])); return; }
    const kv = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(l);
    if (!kv) throw new Error(`frontmatter ${i + 1}번째 줄을 읽을 수 없습니다: ${line}`);
    const [, key, rest = ''] = kv;
    if (rest.trim() === '') { data[key] = []; listKey = key; blockKeys.add(key); }
    else { data[key] = scalar(rest); listKey = null; }
  });
  // `key:` 뒤에 값도 리스트 항목도 없으면 빈 문자열로 본다
  for (const k of blockKeys) if (data[k].length === 0) data[k] = '';
  return { data, body: m[2] };
}
