export const messages = {
  ko: {
    link: (r) => `🎉 팔로우 감사합니다!\n\n📦 ${r.name}\n${r.url}`,
    ask: (r) => `안녕하세요! "${r.name}" 링크를 보내드릴게요.\n먼저 계정을 팔로우한 뒤 아래 버튼을 눌러주세요 👇`,
    retry: '아직 팔로우가 확인되지 않았어요 🥲\n팔로우 후 다시 버튼을 눌러주세요!',
    button: '✅ 팔로우했어요',
  },
  en: {
    link: (r) => `🎉 Thanks for following!\n\n📦 ${r.name}\n${r.url}`,
    ask: (r) => `Hi! I'll send you the "${r.name}" link.\nPlease follow this account first, then tap the button below 👇`,
    retry: "I can't see your follow yet 🥲\nPlease follow and tap the button again!",
    button: '✅ I followed',
  },
};
