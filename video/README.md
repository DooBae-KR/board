# video/ — 숏폼 영상 생성기

HTML 장면을 프레임 단위로 그려(`setT(t)`) ffmpeg로 1080x1920 mp4로 만든다. 무음이며 음성·음악은 넣지 않는다(저작권·목소리 선택은 업로드 도구에서).

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

필요: Node 22+, ffmpeg, Playwright + Chromium(`CHROMIUM_PATH`, `PLAYWRIGHT_MODULE`로 경로 지정 가능).

## 장면 구조 (40초)
훅 → 문제(복붙하면 표가 흩어짐) → 도구 소개 → 기능1(설치) → 기능2(실제 실행 결과) → 기능3(지원 형식) → 댓글 유도(팔로우 → 댓글 → DM)

- `markitdown/demo/`: 영상에 쓴 **실제 실행 결과**. `mkdoc.py`로 샘플 문서를 만들고 `markitdown`을 돌려 얻은 출력(`out_*.md`)과 평문 추출(`plain_*.txt`).
- 새 레포용 영상을 만들 때는 `index.html`의 `TX`(문구)와 `demo/`(실제 실행 결과)를 바꾼다. 확인하지 못한 수치(★ 수 등)는 영상에 넣지 않는다.
- 영상 안에 실제 사람 얼굴·실존 인물 이름·저작권 있는 캐릭터·음악을 넣지 않는다(`CLAUDE.md` 5장 6항).
