# 화성 시민발전소 통합 모니터

화성시민재생에너지발전협동조합의 10개 발전소를 한 화면에서 보는 TV·아이패드용 정적 대시보드입니다.

## 구성

- GitHub Pages: 화면 배포
- Supabase 공개 RPC: 안전한 표시용 집계값만 읽기
- Supabase Edge Function: NREMS 2개소와 PVEYES 8개소의 로그인 세션을 서버에서 수집
- 수집 계정: 브라우저와 저장소에 두지 않고 Supabase Edge Function 보안 변수에만 보관

화면은 60초마다 Supabase 값을 다시 읽습니다. 실제 공급사 수집 주기는 서버 예약 작업에서 별도로 정합니다. PVEYES의 HTTP 로그인은 브라우저가 아니라 Supabase 서버에서만 수행하므로 아이패드 화면에 계정이나 쿠키가 노출되지 않습니다.

## 필요한 Edge Function 보안 변수

- `HWASEONG_MONITOR_SYNC_TOKEN`
- `HWASEONG_NREMS_USER`
- `HWASEONG_NREMS_PASSWORD`
- `HWASEONG_PVEYES_USER`
- `HWASEONG_PVEYES_PASSWORD`

Supabase publishable key는 공개 화면용 저권한 키이며, 정적 페이지에는 `sb_publishable_...` 형식만 사용합니다. 원격 사이트의 계정과 Supabase secret key는 이 저장소에 넣지 않습니다.

## 화면 동작

- 가로 화면: 전체 요약 4개와 발전소 카드 10개를 5열 × 2행으로 표시
- 4호기: 터치하면 발전소 개요, 현재 출력, 오늘 발전량, 누적 발전량을 상세 패널로 표시
- 야간 0 kW: 장애가 아니라 `발전 종료`로 표시
- 수집 실패: 이전 정상값을 유지하고 화면 상단에 점검 상태만 표시
