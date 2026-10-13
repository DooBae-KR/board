# 업로드 패키지: microsoft/markitdown (첫 영상)

대본은 `docs/script-markitdown.md`. 레포: https://github.com/microsoft/markitdown
키워드: KO `링크` / EN `link` (영상 CTA 자막과 `data/repos.json` 의 `keyword` 가 같아야 함)

> **`{N}` 표시**: 레포의 ★ 수는 대본 작성 때 확인하지 못했습니다. 영상 화면, 자막, 아래 캡션/설명에 `{N}` 이 남아 있으면 **업로드 직전에 레포에서 직접 확인해 채우세요.** 아래에서 `{N}` 이라고 쓴 곳은 모두 같은 규칙입니다. 숫자를 확인하지 못하면 문구를 빼도 됩니다.

---

## 인스타그램 한국어 (한국어 계정)

**캡션**

```
PDF 넣었더니 글자가 다 깨졌죠? 🤯
마이크로소프트 오픈소스 MarkItDown은 PDF·워드·PPT·엑셀 같은 파일을 LLM이 읽기 좋은 마크다운으로 바꿔줍니다.
설치는 pip install 'markitdown[all]' 한 줄.

🔗 깃허브 주소는 먼저 팔로우한 뒤 댓글에 '링크'라고 남겨 주세요. DM으로 보내드려요. (팔로우 전이면 DM이 '메시지 요청함'으로 갈 수 있어요)

#깃허브 #오픈소스 #개발자 #AI #markitdown #마크다운 #LLM #코딩
```

(★ {N} 를 넣고 싶다면 "깃허브 ★{N}" 형태로 업로드 직전에 확인 후 추가)

## 인스타그램 영어 (영어 계정)

**Caption**

```
Pasted a PDF into ChatGPT and it came out garbled? 🤯
MarkItDown is open source from Microsoft. It turns PDF, Word, PowerPoint, Excel and more into LLM-ready Markdown.
Install: pip install 'markitdown[all]'

🔗 Want the GitHub link? Comment "link" and follow, and I'll DM it to you.

#github #opensource #developer #ai #markitdown #markdown #llm #coding
```

---

## 유튜브 쇼츠 (유튜브에는 DM이 없으므로 링크를 직접 적는다)

**제목 (한국어)**: PDF를 LLM용 마크다운으로 바꿔주는 MS 오픈소스 #Shorts
**제목 (영어)**: Turn Any File into LLM-Ready Markdown (Microsoft Open Source) #Shorts

**설명 (한국어)**

```
파일을 LLM이 읽기 좋은 마크다운으로 바꿔주는 마이크로소프트 오픈소스 MarkItDown.
PDF, 워드, PPT, 엑셀, 이미지(OCR), 오디오(음성 인식), HTML, CSV, JSON, XML, ZIP, YouTube URL, EPub을 지원합니다.

설치: pip install 'markitdown[all]'
사용: markitdown file.pdf > document.md

GitHub: https://github.com/microsoft/markitdown

#깃허브 #오픈소스 #개발자 #AI #markitdown #Shorts
```

**설명 (영어, 영어 채널용)**

```
MarkItDown is Microsoft's open source tool that converts files into LLM-ready Markdown.
Supports PDF, Word, PowerPoint, Excel, images (OCR), audio (transcription), HTML, CSV, JSON, XML, ZIP, YouTube URLs and EPub.

Install: pip install 'markitdown[all]'
Usage: markitdown file.pdf > document.md

GitHub: https://github.com/microsoft/markitdown

#github #opensource #developer #ai #markitdown #Shorts
```

**고정 댓글 (한국어)**

```
깃허브 주소: https://github.com/microsoft/markitdown
설치는 pip install 'markitdown[all]' 한 줄이면 됩니다. 인스타그램에서는 '링크' 댓글 + 팔로우로 DM도 받을 수 있어요.
```

**고정 댓글 (영어)**

```
GitHub: https://github.com/microsoft/markitdown
Install with one line: pip install 'markitdown[all]'
```

(인스타 계정 주소를 넣을 경우: `{인스타 계정 링크}` 는 운영자가 채웁니다.)

---

## 업로드 전 체크리스트 (`docs/script-template.md` 3장 기준)

- [ ] 첫 3초에 결과물/문제를 보여줬는가 (자기소개 금지) — 비포/애프터 화면
- [ ] 자막은 화면 중앙 상단, 한 줄 5~8단어 이내
- [ ] 마지막 CTA에 **키워드**(KO `링크` / EN `link`)와 **"팔로우"** 문구가 모두 있는가
- [ ] 키워드가 `data/repos.json` 의 `keyword` 와 일치하는가 (한글/영문, 대소문자는 무시되지만 글자는 같아야 함)
- [ ] 영상·캡션·설명의 `{N}` (★ 수)을 레포에서 확인해 채웠거나 문구를 뺐는가
- [ ] 명령어가 실제로 동작하는지 한 번 실행해 봤는가 (`pip install 'markitdown[all]'`, `markitdown file.pdf > document.md`)
- [ ] 지원 포맷 문구가 레포 README와 일치하는가
- [ ] 한국어 영상은 한국어 계정, 영어 영상은 영어 계정에 올렸는가
- [ ] 업로드 후 미디어 ID를 찾아 `data/repos.json` 에 등록했는가 (계정별로 다름, 방법은 `docs/go-live.md` 9단계)
- [ ] `npm run bot:check` 에서 `placeholder mediaId` 경고가 사라졌는가
- [ ] 다른 계정으로 댓글을 달아 DM이 오는지 확인했는가 (팔로우 한 상태/안 한 상태)
- [ ] 유튜브 쇼츠는 설명란에 링크를 넣고 고정 댓글을 달았는가 (DM 불가)
