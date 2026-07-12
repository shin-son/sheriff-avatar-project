# Log

wiki 작업의 시간순 append-only 기록. 형식: `## [YYYY-MM-DD] op | detail`
(op: ingest | lint). `grep "^## \[" log.md`로 파싱 가능.
