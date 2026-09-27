# Gilbeot 길벗 — 방한 외국인용 다국어 교통 안내

- `server.js` : 웹앱 제공 + 실시간 API 중계 (외부 패키지 없음, Node 18+)
- `public/index.html` : 앱 화면 (영어·일본어·중국어·베트남어·러시아어)

## 사용하는 API
| 기능 | API | Railway 변수 이름 |
|---|---|---|
| 대중교통 길찾기 (다국어 역명) | ODsay LAB | ODSAY_API_KEY |
| 지하철 실시간 도착 | 서울 열린데이터광장 | SEOUL_OPENAPI_KEY |
| 버스 실시간 도착 | 공공데이터포털 (서울특별시_정류소정보조회) | DATA_GO_KR_KEY |
| 장소 검색 | Kakao Developers 로컬 API | KAKAO_REST_KEY |
| 장소명 번역 | MyMemory (키 불필요) | MYMEMORY_EMAIL (선택) |

키가 없으면 해당 기능만 꺼지고, 오프라인 공항 가이드는 항상 작동합니다.
