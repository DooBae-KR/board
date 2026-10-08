-- 같은 부서 안에서 위젯 제목은 하나씩만 (에이전트가 PUT /api/harness/widgets로 갱신할 때 기준)
create unique index harness_widgets_section_title_uq
  on public.harness_widgets (section_id, title);
