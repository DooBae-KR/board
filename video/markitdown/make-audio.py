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
SR, DUR = 44100, 40.0
# (시작 초, 말할 수 있는 최대 길이 초, 문장) — 장면 구간: 0-3.5 / 3.5-8 / 8-15 / 15-20 / 20-28 / 28-33 / 33-40
LINES = {
 'ko': [(0.3, 3.4, 'AI한테 넣었더니 다 깨졌죠?'),
        (4.3, 3.4, '표가 한 줄씩 흩어져요.'),
        (8.3, 6.6, '마이크로소프트 오픈소스, 마크잇다운. 파일을 AI가 읽게 바꿔줘요.'),
        (15.4, 4.2, '설치는 한 줄이면 끝!'),
        (20.4, 4.2, '워드, PDF, 엑셀도 한 줄!'),
        (25.2, 2.8, '표 구조가 그대로예요.'),
        (28.3, 4.4, '이미지, 음성, 유튜브 링크까지 지원해요.'),
        (33.3, 6.5, '먼저 팔로우하고, 링크라고 댓글 남겨 주세요. DM으로 보내드려요.')],
 'en': [(0.3, 3.4, 'Pasted a document into AI, and it broke?'),
        (4.3, 3.4, 'Tables fall apart when you paste.'),
        (8.3, 6.6, 'MarkItDown, open source from Microsoft. It turns your files into Markdown that AI can read.'),
        (15.4, 4.2, 'Install it with one command.'),
        (20.4, 4.2, 'Word, PDF, Excel. One line.'),
        (25.2, 2.8, 'And the table structure survives.'),
        (28.3, 4.4, 'Image OCR, audio transcription, even YouTube links.'),
        (33.3, 6.5, "Want the GitHub link? Follow first, then comment link on this video, and I'll DM it to you.")],
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
    d = dur(str(mp3)); tempo = max(1.0, min(1.2, d/maxd))
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
