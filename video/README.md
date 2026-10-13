# video/ — 숏폼 영상 생성기

HTML 장면을 프레임 단위로 그려(`setT(t)`) ffmpeg로 1080x1920 mp4로 만든다. 렌더 결과는 무음이고, `make-audio.py`가 나레이션(gTTS)과 직접 합성한 배경음을 입힌다.

```bash
# 한글 폰트(Pretendard, SIL OFL)는 저장소에 넣지 않는다. 한 번만 받는다.
mkdir -p video/fonts && cd video/fonts
curl -LO https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Regular.otf
curl -LO https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Bold.otf
cd ../..
node video/markitdown/render.mjs ko out-ko.mp4      # 렌더 (약 1분)
node video/markitdown/render.mjs en out-en.mp4
node video/markitdown/render.mjs ko x.mp4 --stills 1,10,25   # 확인용 정지 화면 → video/markitdown/stills/
```

```bash
pip install gTTS numpy
python3 video/markitdown/make-audio.py ko out-ko.mp4 out-ko-voice.mp4   # 음성+배경음 입히기
```

필요: Node 22+, ffmpeg, Playwright + Chromium(`CHROMIUM_PATH`, `PLAYWRIGHT_MODULE`로 경로 지정 가능).

## 장면 구조 (40초)
훅 → 문제(복붙하면 표가 흩어짐) → 도구 소개 → 기능1(설치) → 기능2(실제 실행 결과) → 기능3(지원 형식) → 댓글 유도(팔로우 → 댓글 → DM)

- `markitdown/demo/`: 영상에 쓴 **실제 실행 결과**. `mkdoc.py`로 샘플 문서를 만들고 `markitdown`을 돌려 얻은 출력(`out_*.md`)과 평문 추출(`plain_*.txt`).
- 새 레포용 영상을 만들 때는 `index.html`의 `TX`(문구)와 `demo/`(실제 실행 결과)를 바꾼다. 확인하지 못한 수치(★ 수 등)는 영상에 넣지 않는다.
- 영상 안에 실제 사람 얼굴·실존 인물 이름·저작권 있는 캐릭터·음악을 넣지 않는다(`CLAUDE.md` 5장 6항).

## 음성(나레이션)
- `make-audio.py`의 `LINES`에 장면별 문장이 있다(시작 초, 말할 수 있는 최대 길이, 문장). 문장이 창보다 길면 최대 1.2배속까지 빠르게 하고, 그래도 넘으면 경고를 낸다. 화면 글자보다 **짧게** 쓴다(한국어는 초당 약 4음절).
- 배경음은 사인파로 합성한 잔잔한 코드 진행이라 저작권 문제가 없다. 음량은 약 -14 LUFS로 맞춘다.
- gTTS는 구글 번역의 **비공식** 음성이라 음질이 기계적이고, 수익화 채널에서는 약관을 확인해야 한다. 더 나은 목소리가 필요하면 업로드 앱(CapCut 등)이나 상용 TTS로 `LINES`의 문장을 읽혀 바꾼다.
