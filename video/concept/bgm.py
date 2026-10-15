#!/usr/bin/env python3
"""배경음 후보를 직접 합성한다(저작권 없음). 사용: python3 video/concept/bgm.py <출력폴더> [길이초]  → 후보별 wav 샘플을 만든다.
make-audio.py가 --bgm <이름>으로 같은 함수를 쓴다. 이름: none, pluck, lofi, bounce, musicbox, pad(예전 지속음, 비추천)"""
import sys, wave
from pathlib import Path
import numpy as np

SR = 44100
NOTE = {n: 440.0 * 2 ** ((i - 9) / 12) for n, i in {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}.items()}
def hz(name, octave):  # 예: hz('C', 4)
    return NOTE[name] * 2 ** (octave - 4)

def env(n, a=.005, d=.2, floor=0.0):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * (floor + (1 - floor) * np.exp(-t / d))

def pluck(f, dur=.7, decay=.995):  # Karplus-Strong: 현을 튕기는 소리
    n = int(SR * dur); N = max(2, int(SR / f)); buf = np.random.RandomState(int(f)).uniform(-1, 1, N); out = np.zeros(n)
    for i in range(n):
        out[i] = buf[i % N]; buf[i % N] = decay * .5 * (buf[i % N] + buf[(i + 1) % N])
    return out * env(n, .002, dur * .5)

def marimba(f, dur=.45):
    t = np.arange(int(SR * dur)) / SR
    return (np.sin(2 * np.pi * f * t) + .35 * np.sin(2 * np.pi * f * 4 * t)) * np.exp(-t / .12)

def bell(f, dur=1.4):
    t = np.arange(int(SR * dur)) / SR
    return (np.sin(2 * np.pi * f * t) + .4 * np.sin(2 * np.pi * f * 2.76 * t) + .2 * np.sin(2 * np.pi * f * 5.4 * t)) * np.exp(-t / .5)

def epiano(f, dur=1.0):
    t = np.arange(int(SR * dur)) / SR
    return (np.sin(2 * np.pi * f * t) + .3 * np.sin(2 * np.pi * 2 * f * t)) * np.exp(-t / .5) * (1 + .15 * np.sin(2 * np.pi * 5 * t))

def kick(d=.22):
    t = np.arange(int(SR * d)) / SR
    return np.sin(2 * np.pi * np.cumsum(120 * np.exp(-t / .05) + 45) / SR) * np.exp(-t / .09)

def hat(d=.05, seed=1):
    n = int(SR * d); x = np.random.RandomState(seed).uniform(-1, 1, n); x = np.diff(x, prepend=0)
    return x * np.exp(-np.arange(n) / SR / .012)

def clap(d=.12):
    n = int(SR * d); return np.random.RandomState(3).uniform(-1, 1, n) * np.exp(-np.arange(n) / SR / .03)

class Mix:
    def __init__(self, dur): self.y = np.zeros(int(SR * dur) + SR); self.dur = dur
    def put(self, t, s, g=1.0):
        i = int(t * SR)
        if 0 <= i < len(self.y): m = min(len(s), len(self.y) - i); self.y[i:i + m] += s[:m] * g
    def out(self, gain):
        y = self.y[:int(SR * self.dur)]
        y = y / (np.max(np.abs(y)) or 1) * gain
        fade = int(SR * 1.2); y[:int(SR*.3)] *= np.linspace(0, 1, int(SR*.3)); y[-fade:] *= np.linspace(1, 0, fade)
        return np.stack([y, np.roll(y, 300)], 1)

CHORDS = [[('C', 4), ('E', 4), ('G', 4)], [('A', 3), ('C', 4), ('E', 4)], [('F', 3), ('A', 3), ('C', 4)], [('G', 3), ('B', 3), ('D', 4)]]

def render(style, dur, bpm=96):
    beat = 60 / bpm; m = Mix(dur)
    if style == 'none':
        return np.zeros((int(SR * dur), 2))
    bars = int(dur / (beat * 4)) + 1
    if style == 'pluck':      # 통통 튕기는 기타 아르페지오(밝고 가벼움)
        for b in range(bars):
            ch = CHORDS[b % 4]
            for k in range(8):
                nt = ch[[0, 1, 2, 1, 0, 1, 2, 1][k]]
                m.put(b * 4 * beat + k * beat / 2, pluck(hz(*nt) * (2 if k % 4 == 2 else 1)), .8 if k % 2 == 0 else .55)
        return m.out(.5)
    if style == 'lofi':       # 부드러운 전자 피아노 + 느린 킥·하이햇(차분한 로파이)
        for b in range(bars):
            t0 = b * 4 * beat
            for n_ in CHORDS[b % 4]: m.put(t0, epiano(hz(*n_)), .5); m.put(t0 + 2 * beat, epiano(hz(*n_)), .35)
            m.put(t0, kick(), 1.0); m.put(t0 + 2 * beat, kick(), .8)
            for k in range(8): m.put(t0 + k * beat / 2 + beat / 4, hat(seed=k), .18)
        return m.out(.55)
    if style == 'bounce':     # 마림바 + 박수 소리(경쾌하고 광고 느낌)
        pat = [0, None, 2, 1, None, 2, 0, 1]
        for b in range(bars):
            t0 = b * 4 * beat; ch = CHORDS[b % 4]
            for k, p in enumerate(pat):
                if p is not None: m.put(t0 + k * beat / 2, marimba(hz(*ch[p]) * 2), .7)
            m.put(t0 + beat, clap(), .35); m.put(t0 + 3 * beat, clap(), .35)
            for k in range(4): m.put(t0 + k * beat, kick(), .45)
        return m.out(.5)
    if style == 'musicbox':   # 오르골 같은 맑은 종소리(잔잔하고 귀여움)
        mel = [('E', 5), ('G', 5), ('A', 5), ('G', 5), ('E', 5), ('D', 5), ('C', 5), ('D', 5)]
        for b in range(bars):
            for k in range(4): m.put(b * 4 * beat + k * beat, bell(hz(*mel[(b * 4 + k) % len(mel)])), .7)
            m.put(b * 4 * beat, bell(hz(*CHORDS[b % 4][0]) / 2), .5)
        return m.out(.4)
    if style == 'pad':        # 예전 지속음(윙~ 소리). 비추천
        t = np.arange(int(SR * dur)) / SR; y = np.zeros_like(t)
        for f in (220.0, 261.63, 329.63): y += np.sin(2 * np.pi * f * t)
        return np.stack([y / 3 * .4, y / 3 * .4], 1)
    raise SystemExit('알 수 없는 배경음: ' + style)

def write_wav(path, st):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(st, -1, 1) * 32767).astype('<i2').tobytes())

if __name__ == '__main__':
    out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True); dur = float(sys.argv[2]) if len(sys.argv) > 2 else 14
    for s in ('pluck', 'lofi', 'bounce', 'musicbox'):
        write_wav(out / f'bgm-{s}.wav', render(s, dur)); print('만듦', s)
