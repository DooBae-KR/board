# video/ — 숏폼 영상 생성기

HTML 장면을 프레임 단위로 그려(`setT(t)`) ffmpeg로 1080x1920 mp4로 만든다. 렌더 결과는 무음이고, `make-audio.py`가 나레이션(gTTS)과 직접 합성한 배경음을 입힌다.

```bash
# 한글 폰트(Pretendard, SIL OFL)는 저장소에 넣지 않는다. 한 번만 받는다.
mkdir -p video/fonts && cd video/fonts
curl -LO https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Regular.otf
curl -LO https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Bold.otf
cd ../..
node video/story/render.mjs video/story/stories/<id>.json out.mp4          # 렌더
node video/story/render.mjs video/story/stories/<id>.json x.mp4 --stills 3,10,20   # 확인용 정지 화면 → video/story/stills/
```

```bash
pip install gTTS numpy
python3 video/story/make-audio.py video/story/stories/<id>.json out.mp4 final.mp4   # 음성+배경음+자막, 1.2배속
```

필요: Node 22+, ffmpeg, Playwright + Chromium(`CHROMIUM_PATH`, `PLAYWRIGHT_MODULE`로 경로 지정 가능).

## 규격
재생속도(1.2배)·TTS·5장면 기승전결·기본 대본은 `docs/video-spec.md`가 기준이다. 문구는 모두 `stories/<id>.json`(템플릿 `_template.json`)에서 읽으므로 레포가 달라도 같은 스토리로 만들어진다. 확인하지 못한 수치(★ 수 등)는 넣지 않는다.

- 영상 안에 실제 사람 얼굴·실존 인물 이름·저작권 있는 캐릭터·음악을 넣지 않는다(`CLAUDE.md` 5장 6항).
- 음성은 JSON의 `narration` 5문장을 장면 시작에 맞춰 읽힌다. 장면 창보다 길면 최대 1.35배까지 빠르게 하고, 그래도 넘으면 경고를 낸다.
- gTTS는 구글 번역의 **비공식** 음성이라 수익화 채널에서는 약관을 확인해야 한다.
