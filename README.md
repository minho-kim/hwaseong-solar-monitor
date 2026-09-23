# 화성 시민발전소 통합 모니터

화성시민재생에너지발전협동조합의 10개 발전소를 한 화면에서 보는 TV·아이패드용 정적 대시보드입니다.

## 구성

- GitHub Pages: 화면 배포
- Supabase 공개 RPC: 안전한 표시용 집계값만 읽기
- Supabase Edge Function: NREMS 2개소와 PVEYES 8개소의 로그인 세션을 서버에서 수집
- 수집 계정: 브라우저와 저장소에 두지 않고 Supabase Edge Function 보안 변수에만 보관

공급사 데이터 수집과 화면 조회를 모두 3분 주기로 맞췄으며, 화면을 처음 열거나 다시 활성화할 때는 즉시 최신 값을 읽습니다. PVEYES의 HTTP 로그인은 브라우저가 아니라 Supabase 서버에서만 수행하므로 아이패드 화면에 계정이나 쿠키가 노출되지 않습니다.

## 필요한 Edge Function 보안 변수

- `HWASEONG_MONITOR_SYNC_TOKEN`
- `HWASEONG_NREMS_USER`
- `HWASEONG_NREMS_PASSWORD`
- `HWASEONG_PVEYES_USER`
- `HWASEONG_PVEYES_PASSWORD`

Supabase publishable key는 공개 화면용 저권한 키이며, 정적 페이지에는 `sb_publishable_...` 형식만 사용합니다. 원격 사이트의 계정과 Supabase secret key는 이 저장소에 넣지 않습니다.

## 화면 동작

- 가로 화면: 전체 요약 4개와 발전소 카드 10개를 5열 × 2행으로 표시
- 4호기: 터치하면 카드에서 확대되는 전환 효과와 함께 설치 장소, 설비용량, 수집·통신 상태, 현재·오늘·누적 발전량을 상세 패널로 표시
- 야간 0 kW: 장애가 아니라 `발전 종료`로 표시
- 수집 실패: 이전 정상값을 유지하고 화면 상단에 점검 상태만 표시
