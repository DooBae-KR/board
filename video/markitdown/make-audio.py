#!/usr/bin/env python3
"""나레이션(gTTS) + 직접 합성한 배경음을 만들어 영상에 입힌다.
사용: python3 video/markitdown/make-audio.py <ko|en> <입력.mp4> <출력.mp4> [--no-subs]  (자막을 영상에 새기고 같은 이름의 .srt도 만든다)
필요: pip install gTTS numpy, ffmpeg. 배경음은 사인파로 합성한 것이라 저작권 문제가 없다.
gTTS는 구글 번역의 비공식 음성이다. 수익화 채널에서는 약관과 음질을 확인하고, 필요하면 업로드 앱의 음성으로 바꾼다.
"""
import subprocess, sys, tempfile, wave
from pathlib import Path
import numpy as np
from gtts import gTTS

lang, src, dst = sys.argv[1:4]
SUBS = '--no-subs' not in sys.argv   # 자막을 영상에 새기지 않으려면 --no-subs
SR, DUR = 44100, 50.5
GLOBAL_TEMPO = 1.22  # 기본 말하기 속도(gTTS는 느리다). 1.3을 넘기면 부자연스럽다
# (시작 초, 말할 수 있는 최대 길이 초, 문장) — 장면 구간: 0-6 / 6-12 / 12-22 / 22-28.5 / 28.5-37 / 37-42.5 / 42.5-50.5
LINES = {
 'ko': [(0.3, 5.4, 'AI한테 문서를 넣었더니 다 깨졌죠? 누구나 한 번쯤 겪어요.'),
        (6.3, 5.4, '붙여넣으면 표가 한 줄씩 흩어지고, 구조가 다 사라져요.'),
        (12.3, 9.4, '마이크로소프트가 만든 오픈소스, 마크잇다운이에요. 파일을 AI가 읽기 좋은 마크다운으로 바꿔줘요.'),
        (22.3, 5.8, '설치는 파이썬 명령어 한 줄이면 끝나요. 복잡한 설정은 필요 없어요.'),
        (28.8, 8.0, '워드, PDF, 엑셀도 한 줄로 변환하면, 제목은 제목, 표는 표 그대로 마크다운이 돼요.'),
        (37.3, 4.9, '이미지 속 글자, 음성, 유튜브 링크까지 지원해요.'),
        (42.8, 7.4, '깃허브 주소가 필요하면 먼저 팔로우하고, 링크라고 댓글 남겨 주세요. DM으로 보내드려요.')],
 'en': [(0.3, 5.4, 'Ever pasted a document into AI, and the text came out garbled? Almost everyone has.'),
        (6.3, 5.4, 'Paste a table, and it scatters line by line. The structure is gone.'),
        (12.3, 9.4, "That's where MarkItDown comes in. It's open source from Microsoft, and it turns your files into Markdown that AI can actually read."),
        (22.3, 5.8, 'Install it with one Python command. No complicated setup.'),
        (28.8, 8.0, 'Run it on Word, PDF, or Excel files, and headings stay headings, and tables stay tables.'),
        (37.3, 4.9, 'It even reads text in images, audio, and YouTube links.'),
        (42.8, 7.4, "Want the GitHub link? Follow first, then comment link on this video, and I'll DM it to you.")],
}[lang]


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
fc = ';'.join(filters) + f';{"".join(labels)}amix=inputs={len(LINES)}:normalize=0:duration=longest[voice];' \
     f'[1:a]volume=0.22[bg];[voice][bg]amix=inputs=2:normalize=0:duration=longest,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,loudnorm=I=-16:TP=-2:LRA=11,aresample=44100,alimiter=limit=0.85,apad=whole_dur={DUR},atrim=0:{DUR}[aout]'
ass, srt = tmp/'subs.ass', Path(dst).with_suffix('.srt')
write_subs(cues_all, ass, srt)
vcodec = ['-vf', f'ass={ass}:fontsdir={FONTS}', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium'] if SUBS else ['-c:v', 'copy']
subprocess.run(['ffmpeg','-y','-loglevel','error','-i',src,'-i',str(music),*inputs,'-filter_complex',fc,
  '-map','0:v','-map','[aout]',*vcodec,'-c:a','aac','-b:a','160k','-shortest','-movflags','+faststart',dst], check=True)
print(f'자막 {len(cues_all)}장 → {srt.name}')
print('완료:', dst)
