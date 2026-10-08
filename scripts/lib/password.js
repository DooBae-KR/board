// 비밀번호 해시: scrypt + 사용자별 무작위 salt. 형식 `scrypt$N$r$p$salt(hex)$hash(hex)`
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 16384, R = 8, P = 1, LEN = 32;
const derive = (pw, salt, n, r, p, len) => new Promise((res, rej) => scrypt(pw, salt, len, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await derive(String(pw), salt, N, R, P, LEN);
  return ['scrypt', N, R, P, salt.toString('hex'), key.toString('hex')].join('$');
}

/** 형식이 깨졌거나 없는 계정이면 더미 해시와 비교해 시간 차이를 줄이고 false */
const DUMMY = `scrypt$${N}$${R}$${P}$${'00'.repeat(16)}$${'00'.repeat(LEN)}`;
export async function verifyPassword(pw, stored) {
  const ok = typeof stored === 'string' && /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/.test(stored);
  const [, n, r, p, salt, hash] = (ok ? stored : DUMMY).split('$');
  const want = Buffer.from(hash, 'hex');
  const got = await derive(String(pw ?? ''), Buffer.from(salt, 'hex'), Number(n), Number(r), Number(p), want.length);
  return timingSafeEqual(got, want) && ok;
}

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
