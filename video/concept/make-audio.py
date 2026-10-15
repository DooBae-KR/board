#!/usr/bin/env python3
"""나레이션(gTTS) + 직접 합성한 배경음을 만들어 영상에 입힌다.
사용: python3 video/concept/make-audio.py <stories/xxx.json> <입력.mp4> <출력.mp4> [--no-subs] [--speed 1.2]  (나레이션 + 합성 효과음 + 배경음 + 자막)  (자막을 영상에 새기고 같은 이름의 .srt도 만든다)
필요: pip install gTTS numpy, ffmpeg. 배경음은 사인파로 합성한 것이라 저작권 문제가 없다.
gTTS는 구글 번역의 비공식 음성이다. 수익화 채널에서는 약관과 음질을 확인하고, 필요하면 업로드 앱의 음성으로 바꾼다.
"""
import subprocess, sys, tempfile, wave
from pathlib import Path
import numpy as np
from gtts import gTTS

import json
story_path, src, dst = sys.argv[1:4]
STORY = json.loads(Path(story_path).read_text(encoding='utf-8'))
lang = STORY['lang']
SUBS = '--no-subs' not in sys.argv
SPEED = float(sys.argv[sys.argv.index('--speed') + 1]) if '--speed' in sys.argv else 1.2  # 최종 영상·음성·자막 배속
SR = 44100
CUTS = STORY['cuts']
DUR = float(CUTS[-1]['t1'])
GLOBAL_TEMPO = 1.22
# 컷마다 한 문장(say). 시작은 컷 시작 +0.2초, 길이는 컷 길이 -0.4초 안에 끝내야 한다
LINES = [(c['t0'] + 0.2, c['t1'] - c['t0'] - 0.4, c['say']) for c in CUTS]

def sfx_track(path):
    """연출 효과음(E9)을 직접 합성한다. 난수는 고정 시드라 매번 같다. 저작권 있는 음원은 쓰지 않는다."""
    rng = np.random.RandomState(7)
    out = np.zeros(int(SR * DUR) + SR)
    def put(t0, y):
        i = int(t0 * SR); out[i:i + len(y)] += y[:len(out) - i]
    def tone(f0, f1, d, a=1.0, decay=6.0):
        n = int(SR * d); t = np.arange(n) / SR
        f = f0 + (f1 - f0) * (t / d); ph = 2 * np.pi * np.cumsum(f) / SR
        return a * np.sin(ph) * np.exp(-decay * t / d)
    def noise(d, a=1.0, decay=8.0):
        n = int(SR * d); t = np.arange(n) / SR
        return a * rng.uniform(-1, 1, n) * np.exp(-decay * t / d)
    kinds = {
        'thud': lambda: tone(110, 48, .28, .9, 5) + noise(.05, .25, 12),
        'pop': lambda: tone(620, 980, .09, .6, 5),
        'tick': lambda: tone(1900, 1900, .035, .35, 6),
        'ding': lambda: tone(1320, 1320, .55, .5, 5) + tone(1980, 1980, .55, .25, 6),
        'crack': lambda: noise(.14, .6, 7) + tone(220, 90, .12, .4, 6),
        'riser': lambda: tone(300, 1300, .9, .5, -1.5),
    }
    for c in CUTS:
        for k, name in enumerate(c.get('sfx', [])):
            put(c['t0'] + 0.1 + k * 0.38, kinds[name]())
    out = np.clip(out[:int(SR * DUR)], -1, 1) * 0.8
    st = np.stack([out, out], 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((st * 32767).astype('<i2').tobytes())

import re
FONTS = Path(__file__).resolve().parent.parent/'fonts'
CUE_MAX = {'ko': 30, 'en': 60}  # 자막 한 장(2줄)의 최대 글자 수

def split_cues(text, lang):
    """문장을 쉼표·마침표 단위로 나눠 2줄 이내 자막 조각으로 만든다."""
    mx = CUE_MAX[lang]
    clauses = [c.strip() for c in re.split(r'(?<=[,.?!])\s+', text) if c.strip()]
    cues, cur = [], ''
    for c in clauses:
        if cur and len(cur) + 1 + len(c) > mx:
            cues.append(cur); cur = c
        else:
            cur = f'{cur} {c}'.strip()
    if cur: cues.append(cur)
    out = []
    for c in cues:                       # 한 조각이 너무 길면 단어 단위로 더 쪼갠다
        while len(c) > mx:
            cut = c.rfind(' ', 0, mx)
            cut = cut if cut > 0 else mx
            out.append(c[:cut].strip()); c = c[cut:].strip()
        out.append(c)
    return out

def wrap2(c):
    """2줄로 균형 있게 줄바꿈(단어 경계)."""
    if len(c) <= CUE_MAX[lang] // 2 + 2 or ' ' not in c: return c
    mid, best = len(c) / 2, None
    for m in re.finditer(' ', c):
        if best is None or abs(m.start() - mid) < abs(best - mid): best = m.start()
    return c[:best].strip() + '\\N' + c[best:].strip()

def build_cues(start, length, text):
    parts = split_cues(text, lang)
    weights = [max(1, len(p.replace(' ', ''))) for p in parts]
    total, t, out = sum(weights), start, []
    for p, w in zip(parts, weights):
        d = length * w / total
        out.append((t, t + d, p)); t += d
    return out

def ts_ass(x):
    cs = int(round(x * 100)); return f'{cs//360000}:{cs//6000%60:02d}:{cs//100%60:02d}.{cs%100:02d}'
def ts_srt(x):
    ms = int(round(x * 1000)); return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'

def write_subs(cues, ass_path, srt_path):
    size = 54 if lang == 'ko' else 50
    head = (f'[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\n\n[V4+ Styles]\n'
            'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n'
            # 하단 중앙, 반투명 검은 상자(BorderStyle 3). 하단 400px은 릴스 UI에 가려지므로 비워 둔다
            f'Style: Sub,Pretendard,{size},&H00FFFFFF,&H00FFFFFF,&H99000000,&H00000000,-1,0,0,0,100,100,0,0,3,16,0,2,90,90,400,1\n\n'
            '[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n')
    ass = head + ''.join(f'Dialogue: 0,{ts_ass(a)},{ts_ass(b)},Sub,,0,0,0,,{wrap2(t)}\n' for a, b, t in cues)
    Path(ass_path).write_text(ass, encoding='utf-8')
    srt = ''.join(f'{i}\n{ts_srt(a)} --> {ts_srt(b)}\n{wrap2(t).replace(chr(92)+"N", chr(10))}\n\n' for i, (a, b, t) in enumerate(cues, 1))
    Path(srt_path).write_text(srt, encoding='utf-8')

def dur(p):
    return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',p]).decode().strip())

def pad_music(path):
    # 잔잔한 코드 진행(Am-F-C-G)을 사인파로 합성: 느린 어택/릴리스 + 아주 느린 떨림
    t = np.arange(int(SR*DUR))/SR
    chords = [[220.00,261.63,329.63],[174.61,220.00,261.63],[261.63,329.63,392.00],[196.00,246.94,293.66]]
    out = np.zeros_like(t); seg = DUR/4
    for i, ch in enumerate(chords):
        a, b = i*seg, (i+1)*seg
        m = (t>=a)&(t<b); lt = t[m]-a
        env = np.minimum(1, lt/2.5) * np.minimum(1, (seg-lt)/2.5)
        for f in ch:
            out[m] += env*(np.sin(2*np.pi*f*lt) + .4*np.sin(2*np.pi*2*f*lt))
        out[m] += env*.5*np.sin(2*np.pi*(ch[0]/2)*lt)
    out *= (0.85 + 0.15*np.sin(2*np.pi*0.2*t))
    out *= np.minimum(1, t/2) * np.minimum(1, (DUR-t)/2)
    out = out/np.max(np.abs(out))*0.5
    st = np.stack([out, np.roll(out, 400)], 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((st*32767).astype('<i2').tobytes())

tmp = Path(tempfile.mkdtemp())
inputs, filters, labels, cues_all = [], [], [], []
for i, (start, maxd, text) in enumerate(LINES):
    mp3 = tmp/f'n{i}.mp3'
    gTTS(text, lang=lang).save(str(mp3))
    d = dur(str(mp3)); tempo = min(1.35, max(GLOBAL_TEMPO, d/maxd))
    if d/tempo > maxd + 0.4: print(f'경고: {i}번 문장이 {maxd}초를 넘어요 ({d/tempo:.1f}초)', file=sys.stderr)
    cues_all += build_cues(start, d / tempo, text)
    inputs += ['-i', str(mp3)]
    filters.append(f'[{i+2}:a]atempo={tempo:.3f},adelay={int(start*1000)}|{int(start*1000)},apad[v{i}]')
    labels.append(f'[v{i}]')
    print(f'{start:5.1f}s  {d:4.1f}s x{tempo:.2f}  {text}')
music = tmp/'pad.wav'; pad_music(str(music))
sfx = tmp/'sfx.wav'; sfx_track(str(sfx))
inputs += ['-i', str(sfx)]
fc = ';'.join(filters) + f';{"".join(labels)}amix=inputs={len(LINES)}:normalize=0:duration=longest[voice];' \
     f'[1:a]volume=0.22[bg];[{len(LINES)+2}:a]volume=0.55[sfx];[voice][bg][sfx]amix=inputs=3:normalize=0:duration=longest,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,loudnorm=I=-16:TP=-2:LRA=11,aresample=44100,alimiter=limit=0.85,apad=whole_dur={DUR},atrim=0:{DUR},atempo={SPEED}[aout]'
ass, srt = tmp/'subs.ass', Path(dst).with_suffix('.srt')
write_subs(cues_all, ass, srt)
# .srt는 최종 영상 속도에 맞춰 시간을 줄인다(영상에 새긴 자막은 setpts로 같이 빨라진다)
cues_srt = [(a / SPEED, b / SPEED, t) for a, b, t in cues_all]
write_subs(cues_srt, tmp/'unused.ass', srt)
vf = (f'ass={ass}:fontsdir={FONTS},' if SUBS else '') + f'setpts=PTS/{SPEED},fps=30'
vcodec = ['-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium']
subprocess.run(['ffmpeg','-y','-loglevel','error','-i',src,'-i',str(music),*inputs,'-filter_complex',fc,
  '-map','0:v','-map','[aout]',*vcodec,'-c:a','aac','-b:a','160k','-shortest','-movflags','+faststart',dst], check=True)
print(f'자막 {len(cues_all)}장 → {srt.name}')
print('완료:', dst)
