#!/usr/bin/env python3
"""나레이션(gTTS) + 직접 합성한 배경음을 만들어 영상에 입힌다.
사용: python3 video/markitdown/make-audio.py <ko|en> <입력.mp4> <출력.mp4>
필요: pip install gTTS numpy, ffmpeg. 배경음은 사인파로 합성한 것이라 저작권 문제가 없다.
gTTS는 구글 번역의 비공식 음성이다. 수익화 채널에서는 약관과 음질을 확인하고, 필요하면 업로드 앱의 음성으로 바꾼다.
"""
import subprocess, sys, tempfile, wave
from pathlib import Path
import numpy as np
from gtts import gTTS

lang, src, dst = sys.argv[1:4]
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
inputs, filters, labels = [], [], []
for i, (start, maxd, text) in enumerate(LINES):
    mp3 = tmp/f'n{i}.mp3'
    gTTS(text, lang=lang).save(str(mp3))
    d = dur(str(mp3)); tempo = min(1.35, max(GLOBAL_TEMPO, d/maxd))
    if d/tempo > maxd + 0.4: print(f'경고: {i}번 문장이 {maxd}초를 넘어요 ({d/tempo:.1f}초)', file=sys.stderr)
    inputs += ['-i', str(mp3)]
    filters.append(f'[{i+2}:a]atempo={tempo:.3f},adelay={int(start*1000)}|{int(start*1000)},apad[v{i}]')
    labels.append(f'[v{i}]')
    print(f'{start:5.1f}s  {d:4.1f}s x{tempo:.2f}  {text}')
music = tmp/'pad.wav'; pad_music(str(music))
fc = ';'.join(filters) + f';{"".join(labels)}amix=inputs={len(LINES)}:normalize=0:duration=longest[voice];' \
     f'[1:a]volume=0.22[bg];[voice][bg]amix=inputs=2:normalize=0:duration=longest,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,loudnorm=I=-16:TP=-2:LRA=11,aresample=44100,alimiter=limit=0.85,apad=whole_dur={DUR},atrim=0:{DUR}[aout]'
subprocess.run(['ffmpeg','-y','-loglevel','error','-i',src,'-i',str(music),*inputs,'-filter_complex',fc,
  '-map','0:v','-map','[aout]','-c:v','copy','-c:a','aac','-b:a','160k','-shortest','-movflags','+faststart',dst], check=True)
print('완료:', dst)
